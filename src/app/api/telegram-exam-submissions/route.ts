export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      { error: "TEACHERPRO_BOT_INGEST_TOKEN غير مفعّل في إعدادات السيرفر." },
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
    const value = textValue(body[key], max);
    if (value) return value;
  }
  return "";
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
    firstBodyValue(
      body,
      ["telegramUsername", "telegram_username", "telegram", "username"],
      200,
    ) || firstBodyValue(body, ["telegramUserId", "telegram_user_id"], 120),
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
      matchDetails: `مطابق بالتليكرام: ${incomingTelegram}`,
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
      "يحتاج مراجعة يدوية: تم ربط المستلم بالطالب بدون قيمة كود/تليكرام/هاتف مؤكدة في طلب البوت.",
  };
}

function normalizeSubmission(item: Record<string, unknown>) {
  return {
    ...item,
    pages: parseJsonArray(String(item.pages || "[]")),
    sourceMessageIds: parseJsonArray(String(item.sourceMessageIds || "[]")),
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
      return validationError(
        `حجم الطلب كبير جداً (${Math.round(contentLength / 1024 / 1024)} MB). الحد الأقصى 1 MB.`,
      );
    }

    const schemaReady = await ensureTelegramSubmissionSchema();
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json(
        { error: telegramSubmissionSchemaMessage },
        { status: 503 },
      );
    }

    const body = await req.json();
    const studentId = textValue(body.studentId, 120);
    const examId = textValue(body.examId, 120);
    if (!studentId) return validationError("studentId مطلوب من البوت.");
    if (!examId) return validationError("examId مطلوب من البوت.");

    const [student, exam] = await Promise.all([
      db.student.findUnique({ where: { id: studentId } }),
      db.exam.findUnique({ where: { id: examId } }),
    ]);
    if (!student)
      return validationError(
        "الطالب المرسل من البوت غير موجود في TeacherPro.",
        404,
      );
    if (!exam)
      return validationError(
        "الامتحان المرسل من البوت غير موجود في TeacherPro.",
        404,
      );

    const incomingPages = Array.isArray(body.pages)
      ? body.pages
      : Array.isArray(body.images)
        ? body.images
        : Array.isArray(body.files)
          ? body.files
          : Array.isArray(body.photos)
            ? body.photos
            : [];
    const pages = sanitizePages(incomingPages);
    const sourceMessageIds = readStringArray(
      body.sourceMessageIds || body.messageIds || body.message_ids,
    );
    const submittedAt = parseDateValue(body.submittedAt) || new Date();

    const matchInfo = resolveSubmissionMatchInfo(
      body as Record<string, unknown>,
      student,
    );
    const requestedSubmissionStatus =
      textValue(body.status, 120) || "بانتظار التصحيح";
    const submissionStatus =
      requestedSubmissionStatus === "مكتمل" &&
      isManualReviewMatch(matchInfo.matchType)
        ? "بانتظار التصحيح"
        : requestedSubmissionStatus;

    const result = await db.$transaction(async (tx) => {
      const gradeWriteback = await syncAcademicGradeWriteback({
        tx,
        studentId,
        examId,
        status: "درجة",
        score: null,
        sourceLabel: "مستلم بوت التليغرام",
        notes: "تم استلام التسليم من بوت التليغرام وينتظر التصحيح الإلكتروني.",
        allowBlankGrade: true,
        preserveExistingScoreWhenBlank: true,
        blockOnLeave: false,
      });
      if (!gradeWriteback) {
        throw new AcademicGradeWritebackError(
          "تعذر إنشاء درجة انتظار مرتبطة بمستلم البوت.",
        );
      }
      const grade = gradeWriteback.grade;

      const submission = await tx.telegramExamSubmission.upsert({
        where: { studentId_examId: { studentId, examId } },
        update: {
          gradeId: grade.id,
          telegramUserId: textValue(body.telegramUserId, 80),
          telegramUsername: textValue(body.telegramUsername, 120),
          telegramChatId: textValue(body.telegramChatId, 80),
          matchType: matchInfo.matchType,
          matchSource: matchInfo.matchSource,
          matchDetails: matchInfo.matchDetails,
          sourceMessageIds: safeJsonStringify(sourceMessageIds),
          pages: safeJsonStringify(pages),
          pageCount:
            pages.length ||
            Math.max(0, Math.trunc(numberValue(body.pageCount, 0))),
          status: submissionStatus,
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
          matchType: matchInfo.matchType,
          matchSource: matchInfo.matchSource,
          matchDetails: matchInfo.matchDetails,
          sourceMessageIds: safeJsonStringify(sourceMessageIds),
          pages: safeJsonStringify(pages),
          pageCount:
            pages.length ||
            Math.max(0, Math.trunc(numberValue(body.pageCount, 0))),
          status: submissionStatus,
          notes: textValue(body.notes, 4000),
          submittedAt,
        },
        include: { student: true, exam: true },
      });

      return {
        submission,
        grade,
        academicRecalculation: gradeWriteback?.academicRecalculation || null,
      };
    });

    await writeSystemAuditLog("التصحيح الإلكتروني", "استلام مستلم تليكرام وربطه بدرجة", {
      submissionId: result.submission.id,
      studentId: result.submission.studentId,
      examId: result.submission.examId,
      gradeId: result.grade.id,
      matchType: result.submission.matchType,
      status: result.submission.status,
      pageCount: result.submission.pageCount,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    }, { userName: "Telegram Bot" });

    return NextResponse.json(
      {
        ok: true,
        submission: normalizeSubmission(
          result.submission as unknown as Record<string, unknown>,
        ),
        grade: result.grade,
        academicRecalculation: result.academicRecalculation,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AcademicGradeWritebackError) {
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

    const current = await db.telegramExamSubmission.findUnique({
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
    if (!current)
      return validationError("مستلم البوت غير موجود أو تم حذفه.", 404);

    const nextStatus =
      body.status !== undefined
        ? textValue(body.status, 120) || "بانتظار التصحيح"
        : current.status;
    if (
      nextStatus === "مكتمل" &&
      isManualReviewMatch(current.matchType) &&
      !isTruthyConfirmation(body.confirmManualReview)
    ) {
      return validationError(
        "هذا المستلم يحتاج مراجعة يدوية قبل اعتماده كمكتمل. أكد المراجعة اليدوية ثم أعد المحاولة.",
      );
    }

    const result = await db.$transaction(async (tx) => {
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
              `تم اعتماد الدرجة من مستلم بوت التليغرام (${nextStatus}).`,
            academicAccountingChecked:
              body.academicAccountingChecked ??
              body.academic_accounting_checked,
            sourceLabel: "مستلم بوت التليغرام",
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
    });

    await writeRequestAuditLog(req, "التصحيح الإلكتروني", "تحديث مستلم تليكرام وربط الدرجة", {
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
    if (!schemaReady.ok) {
      resetTelegramSubmissionSchemaEnsureCache();
      return NextResponse.json(
        { error: telegramSubmissionSchemaMessage },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(req.url);
    const id = textValue(searchParams.get("id"), 120);
    if (!id) return validationError("تعذر تحديد مستلم البوت المطلوب.");
    const deleted = await db.telegramExamSubmission.delete({
      where: { id },
      select: {
        id: true,
        studentId: true,
        examId: true,
        gradeId: true,
        status: true,
        matchType: true,
      },
    });
    await writeRequestAuditLog(req, "التصحيح الإلكتروني", "حذف مستلم تليكرام", {
      submissionId: deleted.id,
      studentId: deleted.studentId,
      examId: deleted.examId,
      gradeId: deleted.gradeId,
      status: deleted.status,
      matchType: deleted.matchType,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف مستلم البوت حالياً.");
  }
}
