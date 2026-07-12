export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import {
  isMissingDatabaseObjectError,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import {
  ensureTelegramSubmissionSchema,
  resetTelegramSubmissionSchemaEnsureCache,
  telegramSubmissionSchemaMessage,
} from "@/lib/telegram-submission-schema";
import { sanitizePhoneInput } from "@/lib/format";
import { sanitizeTelegramInput } from "@/lib/student-utils";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import {
  AcademicGradeWritebackError,
  hasAcademicGradeWritebackPayload,
  readAcademicGradeWritebackScore,
  readAcademicGradeWritebackStatus,
  syncAcademicGradeWriteback,
} from "@/lib/academic-grade-writeback-server";
import { writeRequestAuditLog, writeSystemAuditLog } from "@/lib/audit-log-server";
import { loadStudentExamEligibility } from "@/lib/student-exam-eligibility-server";
import { lockStudentsAcademicState } from "@/lib/academic-student-lock-server";

type IncomingPage = {
  [key: string]: unknown;
  pageNumber?: unknown;
  page_number?: unknown;
  page?: unknown;
  fileId?: unknown;
  file_id?: unknown;
  telegramFileId?: unknown;
  telegram_file_id?: unknown;
  fileUniqueId?: unknown;
  file_unique_id?: unknown;
  telegramFileUniqueId?: unknown;
  fileName?: unknown;
  file_name?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  mime_type?: unknown;
  contentType?: unknown;
  url?: unknown;
  fileUrl?: unknown;
  file_url?: unknown;
  dataUrl?: unknown;
  data_url?: unknown;
  localPath?: unknown;
  local_path?: unknown;
  path?: unknown;
  size?: unknown;
  fileSize?: unknown;
  file_size?: unknown;
  width?: unknown;
  height?: unknown;
  messageId?: unknown;
  message_id?: unknown;
  telegramMessageId?: unknown;
  caption?: unknown;
  downloadedAt?: unknown;
  downloaded_at?: unknown;
};

class TelegramSubmissionValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TelegramSubmissionValidationError";
    this.status = status;
  }
}

function readEnv(name: string): string | undefined {
  return (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name];
}

function readBotIngestToken(): string {
  return (readEnv("TEACHERPRO_BOT_INGEST_TOKEN") || "").trim();
}

function readTelegramBotToken(): string {
  return (
    readEnv("TEACHERPRO_BOT_TOKEN") ||
    readEnv("TEACHERPRO_TELEGRAM_BOT_TOKEN") ||
    readEnv("TELEGRAM_BOT_TOKEN") ||
    readEnv("BOT_TOKEN") ||
    ""
  ).trim();
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1)
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function requireBotToken(req: NextRequest): NextResponse | null {
  const configuredToken = readBotIngestToken();
  if (!configuredToken) {
    return NextResponse.json(
      { error: "TEACHERPRO_BOT_INGEST_TOKEN غير مفعّل في إعدادات النظام." },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization") || "";
  const bearerToken = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const headerToken = req.headers.get("x-teacherpro-bot-token") || "";
  const token = bearerToken || headerToken;

  if (!constantTimeEqual(token, configuredToken)) {
    return NextResponse.json(
      { error: "توكن البوت غير صحيح." },
      { status: 401 },
    );
  }
  return null;
}

function resolveTeacherProApiUrl(req: NextRequest): string {
  const explicitUrl =
    readEnv("TEACHERPRO_API_URL") || readEnv("NEXT_PUBLIC_TEACHERPRO_API_URL");
  if (explicitUrl?.trim()) return explicitUrl.trim().replace(/\/$/, "");

  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const protocol =
    req.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}`.replace(/\/$/, "") : "";
}

function getBotIntegrationConfig(req: NextRequest) {
  const apiUrl = resolveTeacherProApiUrl(req);
  return {
    apiUrl,
    ingestUrl: apiUrl
      ? `${apiUrl}/api/telegram-exam-submissions`
      : "/api/telegram-exam-submissions",
    tokenConfigured: Boolean(readBotIngestToken()),
    telegramBotTokenConfigured: Boolean(readTelegramBotToken()),
    usingEmbeddedToken: false,
  };
}

function textValue(value: unknown, max = 2000): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
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
  if (Array.isArray(value))
    return value.map((item) => textValue(item, 200)).filter(Boolean);
  const raw = textValue(value, 3000);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => textValue(item, 200)).filter(Boolean)
      : [];
  } catch {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function firstPageValue(
  page: IncomingPage | undefined,
  keys: string[],
): unknown {
  if (!page) return undefined;
  for (const key of keys) {
    const value = page[key];
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return undefined;
}

function cleanPageText(
  page: IncomingPage | undefined,
  keys: string[],
  max = 2000,
): string {
  return textValue(firstPageValue(page, keys), max);
}

function cleanPageNumber(
  page: IncomingPage | undefined,
  fallback: number,
): number {
  const value = firstPageValue(page, [
    "pageNumber",
    "page_number",
    "page",
    "index",
  ]);
  return Math.max(1, Math.trunc(numberValue(value, fallback)));
}

function cleanPageNumeric(
  page: IncomingPage | undefined,
  keys: string[],
): number {
  return numberValue(firstPageValue(page, keys), NaN);
}

function sanitizePages(value: unknown): Array<Record<string, string | number>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((page: IncomingPage, index) => {
    const pageNumber = cleanPageNumber(page, index + 1);
    const cleaned: Record<string, string | number> = { pageNumber };

    // dataUrl is intentionally EXCLUDED — bots must send fileId/url/localPath
    // for the actual image content. dataUrl (base64 inline image) is rejected
    // to prevent payload bloat and abuse. The teacher-pro side fetches the
    // image from Telegram using fileId when needed for correction.
    const fieldAliases: Array<[string, string[]]> = [
      [
        "fileId",
        [
          "fileId",
          "file_id",
          "telegramFileId",
          "telegram_file_id",
          "telegram_fileid",
        ],
      ],
      [
        "fileUniqueId",
        ["fileUniqueId", "file_unique_id", "telegramFileUniqueId"],
      ],
      ["fileName", ["fileName", "file_name", "filename", "name"]],
      ["mimeType", ["mimeType", "mime_type", "contentType", "content_type"]],
      ["url", ["url", "fileUrl", "file_url", "publicUrl", "public_url"]],
      [
        "localPath",
        ["localPath", "local_path", "path", "filePath", "file_path"],
      ],
      [
        "messageId",
        ["messageId", "message_id", "telegramMessageId", "telegram_message_id"],
      ],
      ["caption", ["caption"]],
      ["downloadedAt", ["downloadedAt", "downloaded_at"]],
    ];

    for (const [field, aliases] of fieldAliases) {
      const cleanedValue = cleanPageText(page, aliases, 2000);
      if (cleanedValue) cleaned[field] = cleanedValue;
    }

    const numericAliases: Array<[string, string[]]> = [
      ["size", ["size", "fileSize", "file_size"]],
      ["width", ["width"]],
      ["height", ["height"]],
    ];
    for (const [field, aliases] of numericAliases) {
      const numeric = cleanPageNumeric(page, aliases);
      if (Number.isFinite(numeric))
        cleaned[field] = Math.max(0, Math.trunc(numeric));
    }

    return cleaned;
  });
}

function hasUsablePageReference(page: Record<string, string | number>): boolean {
  return [page.fileId, page.url, page.localPath, page.messageId].some(
    (value) => String(value ?? "").trim().length > 0,
  );
}

function safeJsonStringify(value: unknown, fallback = "[]"): string {
  try {
    return JSON.stringify(value ?? []);
  } catch {
    return fallback;
  }
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type SubmissionMatchInfo = {
  matchType: "code" | "telegram" | "phone" | "manual_review";
  matchSource: string;
  matchDetails: string;
};

function firstBodyValue(
  body: Record<string, unknown>,
  keys: string[],
  max = 200,
): string {
  for (const key of keys) {
    const raw = body[key];
    if (raw && typeof raw === "object") continue;
    const value = textValue(raw, max);
    if (value) return value;
  }
  return "";
}


function nestedBodyValue(
  body: Record<string, unknown>,
  objectKeys: string[],
  valueKeys: string[],
  max = 200,
): string {
  for (const objectKey of objectKeys) {
    const candidate = body[objectKey];
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    for (const valueKey of valueKeys) {
      const value = textValue(record[valueKey], max);
      if (value) return value;
    }
  }
  return "";
}

function readIncomingTelegramUserId(body: Record<string, unknown>): string {
  return firstBodyValue(
    body,
    ["telegramUserId", "telegram_user_id", "telegramId", "telegram_id"],
    80,
  ) || nestedBodyValue(body, ["telegram", "telegramData", "telegram_data"], ["id", "userId", "user_id"], 80);
}

function readIncomingTelegramUsername(body: Record<string, unknown>): string {
  return sanitizeTelegramInput(
    firstBodyValue(
      body,
      ["telegramUsername", "telegram_username", "telegram", "username"],
      120,
    ) || nestedBodyValue(body, ["telegram", "telegramData", "telegram_data"], ["username", "userName", "user_name"], 120),
  );
}

function readIncomingTelegramChatId(body: Record<string, unknown>): string {
  return firstBodyValue(
    body,
    ["telegramChatId", "telegram_chat_id", "chatId", "chat_id"],
    80,
  ) || nestedBodyValue(body, ["telegram", "telegramData", "telegram_data"], ["chatId", "chat_id"], 80);
}

function normalizeTelegramForMatch(value: unknown): string {
  return sanitizeTelegramInput(textValue(value, 200))
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function resolveSubmissionMatchInfo(
  body: Record<string, unknown>,
  student: {
    code?: string | null;
    phone?: string | null;
    parentPhone?: string | null;
    telegram?: string | null;
    telegramKey?: string | null;
  },
): SubmissionMatchInfo {
  const incomingCode = firstBodyValue(
    body,
    ["studentCode", "student_code", "code"],
    120,
  ).toLowerCase();
  const studentCode = textValue(student.code, 120).toLowerCase();
  if (incomingCode && studentCode && incomingCode === studentCode) {
    return {
      matchType: "code",
      matchSource: incomingCode,
      matchDetails: `مطابق بالكود: ${incomingCode}`,
    };
  }

  const incomingTelegram = normalizeTelegramForMatch(
    readIncomingTelegramUserId(body) || readIncomingTelegramUsername(body),
  );
  const studentTelegram = normalizeTelegramForMatch(
    student.telegram || student.telegramKey || "",
  );
  if (
    incomingTelegram &&
    studentTelegram &&
    incomingTelegram === studentTelegram
  ) {
    return {
      matchType: "telegram",
      matchSource: incomingTelegram,
      matchDetails: `مطابق بالتيليجرام: ${incomingTelegram}`,
    };
  }

  const incomingPhone = sanitizePhoneInput(
    firstBodyValue(
      body,
      ["studentPhone", "student_phone", "phone", "parentPhone", "parent_phone"],
      120,
    ),
  );
  const studentPhones = [student.phone, student.parentPhone]
    .map((item) => sanitizePhoneInput(item || ""))
    .filter(Boolean);
  if (incomingPhone && studentPhones.includes(incomingPhone)) {
    return {
      matchType: "phone",
      matchSource: incomingPhone,
      matchDetails: `مطابق بالهاتف: ${incomingPhone}`,
    };
  }

  return {
    matchType: "manual_review",
    matchSource: "",
    matchDetails:
      "يحتاج مراجعة يدوية: تم ربط المستلم بالطالب بدون قيمة كود/تيليجرام/هاتف مؤكدة في طلب البوت.",
  };
}

function normalizeSubmission(item: Record<string, unknown>) {
  const versions = Array.isArray(item.versions)
    ? item.versions.map((version) => {
        const row = version as Record<string, unknown>;
        return {
          ...row,
          pages: parseJsonArray(String(row.pages || "[]")),
          sourceMessageIds: parseJsonArray(String(row.sourceMessageIds || "[]")),
        };
      })
    : [];
  return {
    ...item,
    pages: parseJsonArray(String(item.pages || "[]")),
    sourceMessageIds: parseJsonArray(String(item.sourceMessageIds || "[]")),
    versions,
  };
}

function isManualReviewMatch(value: unknown): boolean {
  return String(value || "").trim() === "manual_review";
}

function isTruthyConfirmation(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "correction.view");
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
    const examId = textValue(searchParams.get("examId"), 120);
    const studentId = textValue(searchParams.get("studentId"), 120);
    const status = textValue(searchParams.get("status"), 120);

    const submissions = await db.telegramExamSubmission.findMany({
      where: {
        ...(examId ? { examId } : {}),
        ...(studentId ? { studentId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { receivedAt: "desc" },
      include: {
        student: true,
        exam: true,
        versions: { orderBy: [{ version: "desc" }, { createdAt: "desc" }] },
      },
    });

    return NextResponse.json({
      submissions: submissions.map((item) =>
        normalizeSubmission(item as unknown as Record<string, unknown>),
      ),
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
    return routeErrorResponse(
      error,
      "تعذر تحميل مستلمات البوت حالياً. تأكد من تشغيل migration الخاصة بها.",
    );
  }
}

const MAX_REQUEST_BYTES = 1 * 1024 * 1024; // 1 MB hard cap (metadata only, no dataUrl allowed)

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req);
  if (tokenError) return tokenError;

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_REQUEST_BYTES) {
      return validationError(`حجم الطلب كبير جداً. الحد الأقصى 1 MB للبيانات الوصفية.`);
    }
    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json({ error: telegramSubmissionSchemaMessage }, { status: 503 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const studentId = textValue(body.studentId, 120);
    const examId = textValue(body.examId, 120);
    if (!studentId) return validationError("studentId مطلوب من البوت.");
    if (!examId) return validationError("examId مطلوب من البوت.");

    const incomingPages = Array.isArray(body.pages) ? body.pages
      : Array.isArray(body.images) ? body.images
        : Array.isArray(body.files) ? body.files
          : Array.isArray(body.photos) ? body.photos : [];
    const pages = sanitizePages(incomingPages).filter(hasUsablePageReference);
    const pageCount = pages.length;
    if (pageCount <= 0) {
      return validationError(
        "لا يمكن إنشاء مستلم فارغ. يجب أن تحتوي صفحة واحدة على الأقل على fileId أو رابط أو مسار ملف أو messageId حقيقي.",
      );
    }

    const eligibilityData = await loadStudentExamEligibility(db, studentId, examId, {
      requireActiveChapter: true,
      checkAvailability: true,
      checkRegistration: true,
      checkLeave: true,
    });
    if (!eligibilityData.student) return validationError("الطالب غير موجود.", 404);
    if (!eligibilityData.exam) return validationError("الامتحان غير موجود.", 404);
    if (!eligibilityData.eligibility?.eligible) {
      return validationError(eligibilityData.eligibility?.reason || "الطالب غير مؤهل لهذا الامتحان.", 409);
    }
    const sourceMessageIds = readStringArray(body.sourceMessageIds || body.messageIds || body.message_ids);
    const derivedSourceMessageIds = sourceMessageIds.length ? sourceMessageIds : pages.map((page) => String(page.messageId || "").trim()).filter(Boolean);
    const incomingTelegramUserId = readIncomingTelegramUserId(body);
    const incomingTelegramUsername = readIncomingTelegramUsername(body);
    const incomingTelegramChatId = readIncomingTelegramChatId(body);
    const submittedAt = parseDateValue(body.submittedAt) || new Date();
    const requestedStatus = textValue(body.status, 120) || "بانتظار التصحيح";

    const result = await db.$transaction(async (tx) => {
      await lockStudentsAcademicState(tx, [studentId]);
      const freshEligibilityData = await loadStudentExamEligibility(tx, studentId, examId, {
        requireActiveChapter: true,
        checkAvailability: true,
        checkRegistration: true,
        checkLeave: true,
      });
      if (!freshEligibilityData.student) {
        throw new TelegramSubmissionValidationError("الطالب غير موجود.", 404);
      }
      if (!freshEligibilityData.exam) {
        throw new TelegramSubmissionValidationError("الامتحان غير موجود.", 404);
      }
      if (!freshEligibilityData.eligibility?.eligible) {
        throw new TelegramSubmissionValidationError(
          freshEligibilityData.eligibility?.reason || "الطالب غير مؤهل لهذا الامتحان.",
          409,
        );
      }
      const freshStudent = await tx.student.findUniqueOrThrow({ where: { id: studentId } });
      const matchInfo = resolveSubmissionMatchInfo(body, freshStudent);
      const submissionStatus =
        requestedStatus === "مكتمل" && isManualReviewMatch(matchInfo.matchType)
          ? "بانتظار التصحيح"
          : requestedStatus;

      const existing = await tx.telegramExamSubmission.findUnique({
        where: { studentId_examId: { studentId, examId } },
        select: { id: true, gradeId: true, _count: { select: { versions: true } } },
      });
      // Remove only the legacy blank Telegram placeholder; never touch an approved grade.
      if (existing?.gradeId) {
        const linkedGrade = await tx.grade.findUnique({ where: { id: existing.gradeId }, select: { id: true, status: true, score: true, notes: true } });
        if (linkedGrade?.status === "درجة" && linkedGrade.score === null && /تيليجرام|بانتظار التصحيح|مستلم بوت/i.test(linkedGrade.notes || "")) {
          await tx.telegramExamSubmission.update({ where: { id: existing.id }, data: { gradeId: null } });
          await tx.grade.delete({ where: { id: linkedGrade.id } });
        }
      }

      const data = {
        gradeId: null,
        telegramUserId: incomingTelegramUserId,
        telegramUsername: incomingTelegramUsername,
        telegramChatId: incomingTelegramChatId,
        matchType: matchInfo.matchType,
        matchSource: matchInfo.matchSource,
        matchDetails: matchInfo.matchDetails,
        sourceMessageIds: safeJsonStringify(derivedSourceMessageIds),
        pages: safeJsonStringify(pages),
        pageCount,
        status: submissionStatus,
        notes: textValue(body.notes, 4000),
        submittedAt,
        receivedAt: new Date(),
      };
      const submission = existing
        ? await tx.telegramExamSubmission.update({ where: { id: existing.id }, data, include: { student: true, exam: true } })
        : await tx.telegramExamSubmission.create({ data: { studentId, examId, ...data }, include: { student: true, exam: true } });
      const version = (existing?._count.versions || 0) + 1;
      await tx.telegramExamSubmissionVersion.create({
        data: {
          id: `tgver_${randomUUID()}`,
          submissionId: submission.id,
          version,
          sourceMessageIds: data.sourceMessageIds,
          pages: data.pages,
          pageCount,
          status: submissionStatus,
          notes: data.notes,
          telegramUserId: incomingTelegramUserId,
          telegramUsername: incomingTelegramUsername,
          telegramChatId: incomingTelegramChatId,
          submittedAt,
          receivedAt: data.receivedAt,
        },
      });
      const academicRecalculation = await recalculateStudentsAcademicState([studentId], { tx });
      return { submission, version, academicRecalculation };
    }, { isolationLevel: "Serializable" });

    await writeSystemAuditLog("التصحيح الإلكتروني", "حفظ إصدار مستلم تيليجرام بدون درجة فارغة", {
      submissionId: result.submission.id, studentId, examId, version: result.version,
      matchType: result.submission.matchType, pageCount: result.submission.pageCount,
    }, { userName: "Telegram Bot" });
    return NextResponse.json({
      ok: true,
      submission: normalizeSubmission(result.submission as unknown as Record<string, unknown>),
      version: result.version,
      grade: null,
      academicRecalculation: result.academicRecalculation,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof TelegramSubmissionValidationError) {
      return validationError(error.message, error.status);
    }
    return routeErrorResponse(error, "تعذر استقبال تسليم البوت حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "correction.manage");
  if (authError) return authError;

  try {
    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json(
        { error: telegramSubmissionSchemaMessage },
        { status: 503 },
      );
    }

    const body = await req.json();
    const id = textValue(body.id, 120);
    if (!id) return validationError("تعذر تحديد مستلم البوت المطلوب.");

    const result = await db.$transaction(async (tx) => {
      const initial = await tx.telegramExamSubmission.findUnique({
        where: { id },
        select: { studentId: true },
      });
      if (!initial) {
        throw new TelegramSubmissionValidationError(
          "مستلم البوت غير موجود أو تم حذفه.",
          404,
        );
      }

      await lockStudentsAcademicState(tx, [initial.studentId]);
      const current = await tx.telegramExamSubmission.findUnique({
        where: { id },
        select: {
          id: true,
          studentId: true,
          examId: true,
          gradeId: true,
          matchType: true,
          status: true,
        },
      });
      if (!current) {
        throw new TelegramSubmissionValidationError(
          "مستلم البوت غير موجود أو تم حذفه.",
          404,
        );
      }

      const nextStatus =
        body.status !== undefined
          ? textValue(body.status, 120) || "بانتظار التصحيح"
          : current.status;
      if (
        nextStatus === "مكتمل" &&
        isManualReviewMatch(current.matchType) &&
        !isTruthyConfirmation(body.confirmManualReview)
      ) {
        throw new TelegramSubmissionValidationError(
          "هذا المستلم يحتاج مراجعة يدوية قبل اعتماده كمكتمل. أكد المراجعة اليدوية ثم أعد المحاولة.",
        );
      }

      const data: Record<string, string> = {};
      if (body.status !== undefined) data.status = nextStatus;
      if (body.notes !== undefined) data.notes = textValue(body.notes, 4000);

      const gradeWriteback = hasAcademicGradeWritebackPayload(
        body as Record<string, unknown>,
      )
        ? await syncAcademicGradeWriteback({
            tx,
            studentId: current.studentId,
            examId: current.examId,
            status: readAcademicGradeWritebackStatus(
              body as Record<string, unknown>,
              "درجة",
            ),
            score: readAcademicGradeWritebackScore(
              body as Record<string, unknown>,
            ),
            notes:
              textValue(body.gradeNotes ?? body.grade_notes, 1000) ||
              `تم اعتماد الدرجة من مستلم بوت تيليجرام (${nextStatus}).`,
            academicAccountingChecked:
              body.academicAccountingChecked ??
              body.academic_accounting_checked,
            sourceLabel: "مستلم بوت تيليجرام",
            allowBlankGrade: false,
            blockOnLeave: true,
          })
        : null;

      const academicRecalculation =
        gradeWriteback?.academicRecalculation ||
        (nextStatus === "مكتمل"
          ? await recalculateStudentsAcademicState([current.studentId], { tx })
          : null);

      const submission = await tx.telegramExamSubmission.update({
        where: { id },
        data: {
          ...data,
          ...(gradeWriteback?.grade
            ? { gradeId: gradeWriteback.grade.id }
            : {}),
        },
        include: { student: true, exam: true },
      });

      return {
        submission,
        grade: gradeWriteback?.grade || null,
        academicRecalculation,
      };
    }, { isolationLevel: "Serializable" });

    await writeRequestAuditLog(req, "التصحيح الإلكتروني", "تحديث مستلم تيليجرام وربط الدرجة", {
      submissionId: result.submission.id,
      studentId: result.submission.studentId,
      examId: result.submission.examId,
      gradeId: result.grade?.id,
      wroteGrade: Boolean(result.grade),
      status: result.submission.status,
      matchType: result.submission.matchType,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });
    return NextResponse.json({
      submission: normalizeSubmission(
        result.submission as unknown as Record<string, unknown>,
      ),
      grade: result.grade,
      academicRecalculation: result.academicRecalculation,
    });
  } catch (error) {
    if (error instanceof TelegramSubmissionValidationError) {
      return validationError(error.message, error.status);
    }
    if (error instanceof AcademicGradeWritebackError) {
      return validationError(error.message, error.status);
    }
    return routeErrorResponse(error, "تعذر تحديث مستلم البوت حالياً.");
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, "correction.manage");
  if (authError) return authError;
  try {
    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) return NextResponse.json({ error: telegramSubmissionSchemaMessage }, { status: 503 });
    const id = textValue(new URL(req.url).searchParams.get("id"), 120);
    if (!id) return validationError("تعذر تحديد مستلم البوت المطلوب.");

    const result = await db.$transaction(async (tx) => {
      const current = await tx.telegramExamSubmission.findUnique({
        where: { id },
        select: { id: true, studentId: true, examId: true, gradeId: true, status: true, matchType: true },
      });
      if (!current) throw new Error("مستلم البوت غير موجود أو تم حذفه.");
      await lockStudentsAcademicState(tx, [current.studentId]);
      let deletedPlaceholderGradeId: string | null = null;
      if (current.gradeId) {
        const grade = await tx.grade.findUnique({ where: { id: current.gradeId }, select: { id: true, status: true, score: true, notes: true } });
        if (grade?.status === "درجة" && grade.score === null && /تيليجرام|بانتظار التصحيح|مستلم بوت/i.test(grade.notes || "")) {
          await tx.telegramExamSubmission.update({ where: { id }, data: { gradeId: null } });
          await tx.grade.delete({ where: { id: grade.id } });
          deletedPlaceholderGradeId = grade.id;
        }
      }
      await tx.telegramExamSubmission.delete({ where: { id } });
      const academicRecalculation = await recalculateStudentsAcademicState([current.studentId], { tx });
      return { ...current, deletedPlaceholderGradeId, academicRecalculation };
    }, { isolationLevel: "Serializable" });
    await writeRequestAuditLog(req, "التصحيح الإلكتروني", "حذف مستلم تيليجرام وتنظيف الدرجة الفارغة وإعادة الاحتساب", {
      submissionId: result.id, studentId: result.studentId, examId: result.examId,
      gradeId: result.gradeId, deletedPlaceholderGradeId: result.deletedPlaceholderGradeId,
      recalculatedStudents: result.academicRecalculation.students.length,
    });
    return NextResponse.json({ ok: true, examAvailableAgain: true, deletedPlaceholderGradeId: result.deletedPlaceholderGradeId, academicRecalculation: result.academicRecalculation });
  } catch (error) {
    return routeErrorResponse(error, error instanceof Error ? error.message : "تعذر حذف مستلم البوت حالياً.");
  }
}
