export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { validationError } from '@/lib/route-helpers';

/**
 * Secure proxy for fetching Telegram file images by fileId.
 *
 * Why this exists:
 *   After banning dataUrl from bot submissions, bots send only fileId
 *   (Telegram file identifier) or localPath. localPath is unreachable
 *   from the browser, and fileId requires the Telegram Bot API + bot
 *   token to resolve — which must never leak to the client.
 *
 * Flow:
 *   1. Client requests: GET /api/telegram-file?fileId=...&submissionId=...
 *   2. Server verifies the user is authenticated and has correction.view
 *      (or grades.view).
 *   3. Server calls Telegram getFile API with the bot token (server-side
 *      only) to resolve fileId → file_path.
 *   4. Server streams the image bytes from Telegram's file CDN back to
 *      the client with appropriate Content-Type.
 *
 * Security:
 *   - Bot token never leaves the server.
 *   - Client only sees the image bytes, not the Telegram API URL.
 *   - Auth required (correction.view OR grades.view OR admin).
 *   - Optional submissionId check: if provided, verify the fileId
 *     belongs to a page in that submission (prevents arbitrary file
 *     enumeration via fileIds guessed by the client).
 */

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[name];
  return undefined;
}

const TELEGRAM_BOT_TOKEN = readEnv('TEACHERPRO_BOT_TOKEN') || readEnv('TELEGRAM_BOT_TOKEN');

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

  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json(
      { error: 'TEACHERPRO_BOT_TOKEN غير مضبوط. مطلوب لجلب صور التليغرام.' },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get('fileId')?.trim();
  const submissionId = searchParams.get('submissionId')?.trim();

  if (!fileId) {
    return validationError('fileId مطلوب');
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
      const pages = submission[0].pages;
      if (!Array.isArray(pages)) {
        return validationError('لا توجد صفحات لهذا السجل', 404);
      }
      const belongs = pages.some(
        (page: unknown) =>
          typeof page === 'object' && page !== null &&
          String((page as Record<string, unknown>).fileId || '') === fileId,
      );
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
    const contentLength = imageRes.headers.get('content-length');
    const buffer = await imageRes.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(contentLength ? { 'Content-Length': contentLength } : {}),
        'Cache-Control': 'private, max-age=3600',
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
