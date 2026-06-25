export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/server-auth';
import { isMissingDatabaseObjectError, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { ensureTelegramSubmissionSchema, resetTelegramSubmissionSchemaEnsureCache, telegramSubmissionSchemaMessage } from '@/lib/telegram-submission-schema';

const READY_BOT_INGEST_TOKEN = 'e535b28843c00d13b937bcc9c496f9f636b7a7dbc8999811104081b22f9bae6e';

type IncomingPage = {
  pageNumber?: unknown;
  fileId?: unknown;
  fileUniqueId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  url?: unknown;
  dataUrl?: unknown;
  localPath?: unknown;
  size?: unknown;
  width?: unknown;
  height?: unknown;
  messageId?: unknown;
  caption?: unknown;
  downloadedAt?: unknown;
};

function readEnv(name: string): string | undefined {
  return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

function readBotIngestToken(): string {
  return (readEnv('TEACHERPRO_BOT_INGEST_TOKEN') || '').trim() || READY_BOT_INGEST_TOKEN;
}

function isUsingEmbeddedBotIngestToken(): boolean {
  return !(readEnv('TEACHERPRO_BOT_INGEST_TOKEN') || '').trim();
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function requireBotToken(req: NextRequest): NextResponse | null {
  const configuredToken = readBotIngestToken();
  if (!configuredToken) {
    return NextResponse.json(
      { error: 'TEACHERPRO_BOT_INGEST_TOKEN غير مفعّل في إعدادات السيرفر.' },
      { status: 503 },
    );
  }

  const auth = req.headers.get('authorization') || '';
  const bearerToken = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const headerToken = req.headers.get('x-teacherpro-bot-token') || '';
  const token = bearerToken || headerToken;

  if (!constantTimeEqual(token, configuredToken)) {
    return NextResponse.json({ error: 'توكن البوت غير صحيح.' }, { status: 401 });
  }
  return null;
}

function resolveTeacherProApiUrl(req: NextRequest): string {
  const explicitUrl = readEnv('TEACHERPRO_API_URL') || readEnv('NEXT_PUBLIC_TEACHERPRO_API_URL');
  if (explicitUrl?.trim()) return explicitUrl.trim().replace(/\/$/, '');

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const protocol = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  return host ? `${protocol}://${host}`.replace(/\/$/, '') : '';
}

function getBotIntegrationConfig(req: NextRequest) {
  const apiUrl = resolveTeacherProApiUrl(req);
  return {
    apiUrl,
    ingestUrl: apiUrl ? `${apiUrl}/api/telegram-exam-submissions` : '/api/telegram-exam-submissions',
    tokenConfigured: Boolean(readBotIngestToken()),
    usingEmbeddedToken: isUsingEmbeddedBotIngestToken(),
  };
}

function textValue(value: unknown, max = 2000): string {
  return String(value ?? '').trim().slice(0, max);
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseDateValue(value: unknown): Date | undefined {
  const raw = textValue(value, 100);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => textValue(item, 200)).filter(Boolean);
  const raw = textValue(value, 3000);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => textValue(item, 200)).filter(Boolean) : [];
  } catch {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function sanitizePages(value: unknown): Array<Record<string, string | number>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map((page: IncomingPage, index) => {
    const pageNumber = Math.max(1, Math.trunc(numberValue(page?.pageNumber, index + 1)));
    const cleaned: Record<string, string | number> = { pageNumber };

    const stringFields: Array<keyof IncomingPage> = [
      'fileId', 'fileUniqueId', 'fileName', 'mimeType', 'url', 'dataUrl',
      'localPath', 'messageId', 'caption', 'downloadedAt',
    ];
    for (const field of stringFields) {
      const max = field === 'dataUrl' ? 2_000_000 : 2000;
      const cleanedValue = textValue(page?.[field], max);
      if (cleanedValue) cleaned[field] = cleanedValue;
    }

    for (const field of ['size', 'width', 'height'] as const) {
      const numeric = numberValue(page?.[field], NaN);
      if (Number.isFinite(numeric)) cleaned[field] = Math.max(0, Math.trunc(numeric));
    }

    return cleaned;
  });
}

function safeJsonStringify(value: unknown, fallback = '[]'): string {
  try {
    return JSON.stringify(value ?? []);
  } catch {
    return fallback;
  }
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeSubmission(item: Record<string, unknown>) {
  return {
    ...item,
    pages: parseJsonArray(String(item.pages || '[]')),
    sourceMessageIds: parseJsonArray(String(item.sourceMessageIds || '[]')),
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'correction.view');
  if (authError) return authError;

  try {
    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json({
        submissions: [],
        migrationRequired: true,
        message: telegramSubmissionSchemaMessage,
        config: getBotIntegrationConfig(req),
      });
    }

    const { searchParams } = new URL(req.url);
    const examId = textValue(searchParams.get('examId'), 120);
    const studentId = textValue(searchParams.get('studentId'), 120);
    const status = textValue(searchParams.get('status'), 120);

    const submissions = await db.telegramExamSubmission.findMany({
      where: {
        ...(examId ? { examId } : {}),
        ...(studentId ? { studentId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      include: {
        student: true,
        exam: true,
      },
    });

    return NextResponse.json({
      submissions: submissions.map((item) => normalizeSubmission(item as unknown as Record<string, unknown>)),
      config: getBotIntegrationConfig(req),
    });
  } catch (error) {
    if (isMissingDatabaseObjectError(error)) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json({
        submissions: [],
        migrationRequired: true,
        message: telegramSubmissionSchemaMessage,
        config: getBotIntegrationConfig(req),
      });
    }
    return routeErrorResponse(error, 'تعذر تحميل مستلمات البوت حالياً. تأكد من تشغيل migration الخاصة بها.');
  }
}

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req);
  if (tokenError) return tokenError;

  try {
    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json({ error: telegramSubmissionSchemaMessage }, { status: 503 });
    }

    const body = await req.json();
    const studentId = textValue(body.studentId, 120);
    const examId = textValue(body.examId, 120);
    if (!studentId) return validationError('studentId مطلوب من البوت.');
    if (!examId) return validationError('examId مطلوب من البوت.');

    const [student, exam] = await Promise.all([
      db.student.findUnique({ where: { id: studentId } }),
      db.exam.findUnique({ where: { id: examId } }),
    ]);
    if (!student) return validationError('الطالب المرسل من البوت غير موجود في TeacherPro.', 404);
    if (!exam) return validationError('الامتحان المرسل من البوت غير موجود في TeacherPro.', 404);

    const pages = sanitizePages(body.pages);
    const sourceMessageIds = readStringArray(body.sourceMessageIds);
    const submittedAt = parseDateValue(body.submittedAt) || new Date();

    const grade = await db.grade.upsert({
      where: { studentId_examId: { studentId, examId } },
      update: {
        status: 'درجة',
        updatedAt: new Date(),
      },
      create: {
        studentId,
        examId,
        status: 'درجة',
        score: null,
        notes: 'تم استلام التسليم من بوت التليغرام وينتظر التصحيح الإلكتروني.',
      },
    });

    const submission = await db.telegramExamSubmission.upsert({
      where: { studentId_examId: { studentId, examId } },
      update: {
        gradeId: grade.id,
        telegramUserId: textValue(body.telegramUserId, 80),
        telegramUsername: textValue(body.telegramUsername, 120),
        telegramChatId: textValue(body.telegramChatId, 80),
        sourceMessageIds: safeJsonStringify(sourceMessageIds),
        pages: safeJsonStringify(pages),
        pageCount: pages.length || Math.max(0, Math.trunc(numberValue(body.pageCount, 0))),
        status: textValue(body.status, 120) || 'بانتظار التصحيح',
        notes: textValue(body.notes, 4000),
        submittedAt,
        receivedAt: new Date(),
      },
      create: {
        studentId,
        examId,
        gradeId: grade.id,
        telegramUserId: textValue(body.telegramUserId, 80),
        telegramUsername: textValue(body.telegramUsername, 120),
        telegramChatId: textValue(body.telegramChatId, 80),
        sourceMessageIds: safeJsonStringify(sourceMessageIds),
        pages: safeJsonStringify(pages),
        pageCount: pages.length || Math.max(0, Math.trunc(numberValue(body.pageCount, 0))),
        status: textValue(body.status, 120) || 'بانتظار التصحيح',
        notes: textValue(body.notes, 4000),
        submittedAt,
      },
      include: { student: true, exam: true },
    });

    return NextResponse.json({
      ok: true,
      submission: normalizeSubmission(submission as unknown as Record<string, unknown>),
    }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر استقبال تسليم البوت حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'correction.manage');
  if (authError) return authError;

  try {
    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json({ error: telegramSubmissionSchemaMessage }, { status: 503 });
    }

    const body = await req.json();
    const id = textValue(body.id, 120);
    if (!id) return validationError('تعذر تحديد مستلم البوت المطلوب.');

    const data: Record<string, string> = {};
    if (body.status !== undefined) data.status = textValue(body.status, 120) || 'بانتظار التصحيح';
    if (body.notes !== undefined) data.notes = textValue(body.notes, 4000);

    const submission = await db.telegramExamSubmission.update({
      where: { id },
      data,
      include: { student: true, exam: true },
    });
    return NextResponse.json({ submission: normalizeSubmission(submission as unknown as Record<string, unknown>) });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث مستلم البوت حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'correction.manage');
  if (authError) return authError;

  try {
    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json({ error: telegramSubmissionSchemaMessage }, { status: 503 });
    }

    const { searchParams } = new URL(req.url);
    const id = textValue(searchParams.get('id'), 120);
    if (!id) return validationError('تعذر تحديد مستلم البوت المطلوب.');
    await db.telegramExamSubmission.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف مستلم البوت حالياً.');
  }
}
