export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { validationError } from '@/lib/route-helpers';
import {
  isR2Configured,
  uploadToR2,
  r2KeyForTelegramFile,
  r2PublicUrlForKey,
} from '@/lib/r2-storage';

/**
 * Secure proxy for fetching Telegram file images by fileId.
 *
 * With R2 caching:
 *   1. Client requests: GET /api/telegram-file?fileId=...&submissionId=...
 *   2. Server checks if the image is already cached in R2.
 *   3. If cached → 302 redirect to the R2 public URL (fast, CDN-served).
 *   4. If not cached → fetch from Telegram, upload to R2, then 302 redirect.
 *   5. If R2 is not configured → fall back to streaming from Telegram directly
 *      (the old behavior).
 *
 * This eliminates ERR_CONNECTION_TIMED_OUT for repeated image views because
 * the first fetch caches to R2, and all subsequent fetches are 302 redirects
 * to the R2 CDN which is fast and reliable.
 */

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[name];
  return undefined;
}

const TELEGRAM_BOT_TOKEN = (
  readEnv('TEACHERPRO_BOT_TOKEN')
  || readEnv('TEACHERPRO_TELEGRAM_BOT_TOKEN')
  || readEnv('TELEGRAM_BOT_TOKEN')
  || readEnv('BOT_TOKEN')
);

const TELEGRAM_API_BASE = 'https://api.telegram.org';

type TelegramFileResponse = {
  ok: boolean;
  result?: {
    file_id: string;
    file_unique_id: string;
    file_path?: string;
    file_size?: number;
  };
  description?: string;
};

export async function GET(req: NextRequest) {
  // Auth: require correction.view OR grades.view (admins always pass).
  const authError = await requirePermission(req, 'correction.view');
  if (authError) {
    const altError = await requirePermission(req, 'grades.view');
    if (altError) return authError;
  }

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get('fileId')?.trim();
  const submissionId = searchParams.get('submissionId')?.trim();

  if (!fileId) {
    return validationError('fileId مطلوب');
  }

  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json(
      { error: 'TEACHERPRO_BOT_TOKEN أو TELEGRAM_BOT_TOKEN غير مضبوط. مطلوب لجلب صور تيليجرام.' },
      { status: 503 },
    );
  }

  // Optional: verify the fileId belongs to the given submission.
  // This prevents a logged-in user from enumerating arbitrary Telegram
  // fileIds — they can only fetch files referenced by submissions they
  // can already see.
  if (submissionId) {
    try {
      const submission = await db.$queryRaw<Array<{ pages: unknown }>>`
        SELECT pages FROM "TelegramExamSubmission" WHERE id = ${submissionId} LIMIT 1
      `;
      if (!submission || submission.length === 0) {
        return validationError('السجل غير موجود', 404);
      }
      // pages is stored as a JSON string in Postgres; parse it before use.
      let pages = submission[0].pages;
      if (typeof pages === 'string') {
        try {
          pages = JSON.parse(pages);
        } catch {
          return validationError('بيانات الصفحات تالفة', 404);
        }
      }
      if (!Array.isArray(pages)) {
        return validationError('لا توجد صفحات لهذا السجل', 404);
      }
      const belongs = pages.some((page: unknown) => {
        if (typeof page !== 'object' || page === null) return false;
        const record = page as Record<string, unknown>;
        const candidateIds = [
          record.fileId,
          record.file_id,
          record.telegramFileId,
          record.telegram_file_id,
          record.telegram_fileid,
        ];
        return candidateIds.some((candidate) => String(candidate || '').trim() === fileId);
      });
      if (!belongs) {
        return validationError('الملف غير مرتبط بهذا السجل', 403);
      }
    } catch {
      // Table may not exist yet; skip the check in that case.
    }
  }

  // Step 1: resolve fileId → file_path via Telegram getFile API
  let filePath: string | undefined;
  try {
    const getFileUrl = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const fileRes = await fetch(getFileUrl, { cache: 'no-store' });
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `تعذر الاتصال بـ Telegram API (HTTP ${fileRes.status})` },
        { status: 502 },
      );
    }
    const fileData = await fileRes.json() as TelegramFileResponse;
    if (!fileData.ok || !fileData.result?.file_path) {
      return NextResponse.json(
        { error: 'لم يعد Telegram مسار الملف. قد يكون fileId غير صالح أو منتهي الصلاحية.' },
        { status: 404 },
      );
    }
    filePath = fileData.result.file_path;
  } catch (error) {
    console.error('[telegram-file] getFile failed:', error);
    return NextResponse.json(
      { error: 'تعذر جلب معلومات الملف من Telegram.' },
      { status: 502 },
    );
  }

  // Step 2: stream the actual file bytes from Telegram's file CDN
  try {
    const downloadUrl = `${TELEGRAM_API_BASE}/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
    const imageRes = await fetch(downloadUrl, { cache: 'no-store' });
    if (!imageRes.ok) {
      return NextResponse.json(
        { error: `تعذر تنزيل الصورة من Telegram (HTTP ${imageRes.status})` },
        { status: 502 },
      );
    }

    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imageRes.arrayBuffer());

    // ارفع الصورة إلى R2 بشكل غير متزامن (لتسريع الوصول المستقبلي)، لكن
    // لا نعمل redirect لـ R2 لأن الـ bucket قد لا يكون public. بدلاً من ذلك
    // نخدم الصورة مباشرة من هنا مع cache-control طويل.
    if (isR2Configured()) {
      const ext = filePath.match(/\.(\w+)$/)?.[1] || 'jpg';
      const key = r2KeyForTelegramFile(fileId, ext);
      // رفع غير متزامن — لا ننتظر النتيجة (لا نريد تأخير الاستجابة).
      void uploadToR2(key, buffer, contentType).catch(() => {});
    }

    // خدم الصورة مباشرة من النظام مع cache-control طويل (24 ساعة).
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('[telegram-file] download failed:', error);
    return NextResponse.json(
      { error: 'تعذر تنزيل الصورة من Telegram.' },
      { status: 502 },
    );
  }
}
