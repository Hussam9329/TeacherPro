import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createSessionToken,
  findUserByUsername,
  hasPermission,
  toAuthPrincipal,
  type AuthPrincipal,
} from "@/lib/server-auth";
import { writeAuditLog } from "@/lib/audit-log-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import {
  AcademicGradeWritebackError,
  syncAcademicGradeWriteback,
} from "@/lib/academic-grade-writeback-server";
import { isArchivedStudentError } from "@/lib/archived-student-guard";
import { BONUS_OPPORTUNITY_ACTION } from "@/lib/bonus-opportunity";

/**
 * The Correction app enters results as this TeacherPro account, so every
 * grade goes through the same code, rules and log lines as a grade typed on
 * the grade entry screen. It needs «إدخال درجات» (grades.add) and must not
 * be an administrator or supervisor; stopping the account stops the
 * integration.
 */
export const CORRECTION_ACCOUNT_USERNAME = "correction";

/** A Correction session lives just long enough for the one request it serves. */
const CORRECTION_SESSION_SECONDS = 120;

/** A claim older than this belongs to a request that died; a retry may take it over. */
const STALE_CLAIM_MS = 120_000;

export const MAX_CORRECTION_BODY_BYTES = 16_384;

function unavailable(error: string): { error: NextResponse } {
  return { error: NextResponse.json({ ok: false, error, code: "CORRECTION_ACCOUNT_UNAVAILABLE" }, { status: 503 }) };
}

export async function correctionServicePrincipal(): Promise<
  { principal: AuthPrincipal; userId: string } | { error: NextResponse }
> {
  const user = await findUserByUsername(CORRECTION_ACCOUNT_USERNAME);
  if (!user || !user.active) return unavailable(`حساب «${CORRECTION_ACCOUNT_USERNAME}» غير موجود أو موقوف في «الحسابات».`);
  const principal = toAuthPrincipal(user);
  if (principal.isAdmin || principal.permissions.includes("system.oversight")) {
    return unavailable(`حساب «${CORRECTION_ACCOUNT_USERNAME}» لازم يكون بصلاحية «إدخال درجات» بس، مو مدير ولا مشرف.`);
  }
  if (!hasPermission(principal, "grades.add")) return unavailable(`حساب «${CORRECTION_ACCOUNT_USERNAME}» يحتاج صلاحية «إدخال درجات».`);
  return { principal, userId: user.id };
}

export async function mintCorrectionSession(userId: string): Promise<string> {
  return createSessionToken(userId, CORRECTION_SESSION_SECONDS);
}

export function readText(value: unknown, max = 200): string {
  const text = String(value ?? "").trim();
  return text.length > max ? "" : text;
}

/** Larger bodies are refused before they are read. */
export function bodyTooLarge(req: Request): NextResponse | null {
  const length = Number(req.headers.get("content-length") || 0);
  return length > MAX_CORRECTION_BODY_BYTES
    ? NextResponse.json({ ok: false, error: "الطلب كبير أكثر من اللازم." }, { status: 413 })
    : null;
}

type Client = typeof db | Prisma.TransactionClient;

export interface CorrectionSnapshot {
  opportunities: number | null;
  studentStatus: string | null;
  dismissalReason: string;
  courseId: string | null;
  grade: { id: string; status: string; score: number | null } | null;
  bonusLogIds: string[];
}

/** What the student and the exam look like now: for the before/after the reply carries. */
export async function correctionSnapshot(client: Client, studentId: string, examId: string): Promise<CorrectionSnapshot> {
  const [student, grade, bonuses] = await Promise.all([
    client.student.findUnique({ where: { id: studentId }, select: { opportunities: true, status: true, dismissalReason: true, courseId: true } }),
    client.grade.findUnique({ where: { studentId_examId: { studentId, examId } }, select: { id: true, status: true, score: true } }),
    // Any exam: a pass can complete a pair whose bonus is recorded on the other exam.
    client.opportunityLog.findMany({ where: { studentId, action: BONUS_OPPORTUNITY_ACTION }, select: { id: true } }),
  ]);
  return {
    opportunities: student ? Number(student.opportunities ?? 0) : null,
    studentStatus: student?.status ?? null,
    dismissalReason: String(student?.dismissalReason || ""),
    courseId: student?.courseId ?? null,
    grade: grade ? { id: grade.id, status: grade.status, score: grade.score === null ? null : Number(grade.score) } : null,
    bonusLogIds: bonuses.map((log) => log.id),
  };
}

/**
 * Like the grade entry sheet, which lists only students whose course has an
 * active chapter: no result is entered for a student outside one.
 */
export async function noActiveChapter(studentId: string, examId: string, courseId: string | null): Promise<NextResponse | null> {
  if (!courseId) return null;
  const link = await db.courseChapter.findFirst({ where: { courseId, active: true, archived: false }, select: { id: true } });
  if (link) return null;
  return NextResponse.json({
    ok: false, studentId, examId, code: "NO_ACTIVE_CHAPTER",
    error: "الطالب ليس ضمن فصل فعّال، فما ينحفظ له شي من Correction (مثل ورقة الإدخال).",
  }, { status: 409 });
}

type Receipt = { status: number; body: Record<string, unknown> };
type Claim = { before: CorrectionSnapshot; claimedAt: number; pending: true };

/**
 * Reserve the idempotency key before any write, so a retry or a duplicate
 * delivery never runs the save twice:
 * - a finished key returns its stored reply;
 * - a key used for a different request is refused;
 * - a key whose request is still running is «in progress» (retry later),
 *   unless that request died (older than STALE_CLAIM_MS): then this one
 *   takes it over, keeping the original «before».
 */
export async function claimCorrectionKey(input: {
  key: string; kind: string; studentId: string; examId: string; request: string; before: CorrectionSnapshot;
}): Promise<{ claimed: true; before: CorrectionSnapshot; takeover: boolean } | { claimed: false; reply: NextResponse }> {
  const claim: Claim = { before: input.before, claimedAt: Date.now(), pending: true };
  try {
    await db.correctionReceipt.create({
      data: { key: input.key, kind: input.kind, studentId: input.studentId, examId: input.examId, request: input.request, response: JSON.stringify(claim) },
    });
    return { claimed: true, before: input.before, takeover: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
  const stored = await db.correctionReceipt.findUnique({ where: { key: input.key } });
  if (!stored) return { claimed: false, reply: inProgress(input.key) };
  if (stored.request !== input.request) {
    return { claimed: false, reply: NextResponse.json({ ok: false, code: "KEY_REUSED", error: "نفس المفتاح انبعث قبل لطلب مختلف." }, { status: 409 }) };
  }
  const parsed = JSON.parse(stored.response) as Partial<Claim> & Partial<Receipt>;
  if (!parsed.pending) {
    return { claimed: false, reply: NextResponse.json({ ...(parsed.body || {}), replay: true }, { status: parsed.status || 200 }) };
  }
  if (Date.now() - Number(parsed.claimedAt || 0) < STALE_CLAIM_MS) return { claimed: false, reply: inProgress(input.key) };
  const takeover: Claim = { before: parsed.before as CorrectionSnapshot, claimedAt: Date.now(), pending: true };
  const taken = await db.correctionReceipt.updateMany({
    where: { key: input.key, response: stored.response },
    data: { response: JSON.stringify(takeover) },
  });
  if (taken.count !== 1) return { claimed: false, reply: inProgress(input.key) };
  return { claimed: true, before: takeover.before, takeover: true };
}

function inProgress(key: string): NextResponse {
  return NextResponse.json({ ok: false, code: "IN_PROGRESS", retryable: true, key, error: "نفس الطلب قيد التنفيذ؛ أعد المحاولة بعد شوية بنفس المفتاح." }, { status: 409 });
}

/** The reply is kept under its key; the same key again returns it. */
export async function finishCorrectionKey(key: string, receipt: Receipt): Promise<NextResponse> {
  await db.correctionReceipt.update({ where: { key }, data: { response: JSON.stringify(receipt) } });
  return NextResponse.json(receipt.body, { status: receipt.status });
}

/** Nothing was written (a rule refused it): the key is free for a later retry. */
export async function releaseCorrectionKey(key: string): Promise<void> {
  await db.correctionReceipt.deleteMany({ where: { key, response: { contains: "\"pending\":true" } } });
}

/** Bonus records this request added for the student. */
export function earnedBonus(before: CorrectionSnapshot, bonusIdsAfter: string[]): boolean {
  const known = new Set(before.bonusLogIds);
  return bonusIdsAfter.some((id) => !known.has(id));
}

export async function auditCorrection(principal: AuthPrincipal, action: string, details: Record<string, unknown>): Promise<void> {
  await writeAuditLog(principal, "الدرجات", action, details);
}

const KEEP_STATUSES = new Set(["مجاز", "غش", "قبل تسجيل الطالب"]);

type SubmissionOutcome =
  | { kept: true; status: "already-graded" | "already-received" | "kept"; grade: { id: string; status: string } }
  | { kept: false; gradeId: string | null };

/**
 * «استلام الورقة»: the student handed in the paper, the grade comes later.
 * Recorded as a result with no score yet — through the same save as the
 * grade entry screen, with its rules: an open exam, the student in its
 * course and site, not archived, not dismissed, leave handled — so the
 * student is never counted absent for it, and an absence already recorded
 * for it is removed and the student recalculated. A score, a leave, cheating
 * or a pre-registration status already there is kept: the decision is made
 * inside the same transaction as the write, so a grade saved meanwhile is
 * never wiped. Grace periods and pending notes are never touched: those are
 * TeacherPro's own screens.
 */
export async function receiveCorrectionSubmission(input: {
  studentId: string;
  examId: string;
  submissionId: string;
  before: CorrectionSnapshot;
}): Promise<Receipt> {
  const base = { studentId: input.studentId, examId: input.examId, submissionId: input.submissionId };
  try {
    const outcome = await withSerializableTransaction(async (tx): Promise<SubmissionOutcome> => {
      const current = await tx.grade.findUnique({
        where: { studentId_examId: { studentId: input.studentId, examId: input.examId } },
        select: { id: true, status: true, score: true },
      });
      if (current && (current.score !== null || KEEP_STATUSES.has(current.status) || current.status === "درجة")) {
        const status = current.score !== null ? "already-graded" : current.status === "درجة" ? "already-received" : "kept";
        return { kept: true, status, grade: current };
      }
      const writeback = await syncAcademicGradeWriteback({
        tx,
        studentId: input.studentId,
        examId: input.examId,
        status: "درجة",
        score: null,
        sourceLabel: "استلام ورقة من Correction",
        allowBlankGrade: true,
        preserveExistingScoreWhenBlank: true,
        blockOnLeave: true,
        enforceExamAvailability: true,
        allowDismissedExistingGradeCorrection: false,
      });
      return { kept: false, gradeId: writeback?.grade.id ?? null };
    });
    const after = await correctionSnapshot(db, input.studentId, input.examId);
    if (outcome.kept) {
      return {
        status: 200,
        body: {
          ok: true, ...base, status: outcome.status, gradeId: outcome.grade.id, gradeStatus: outcome.grade.status,
          previousStatus: outcome.grade.status, opportunitiesBefore: input.before.opportunities, opportunitiesAfter: after.opportunities,
        },
      };
    }
    return {
      status: 200,
      body: {
        ok: true, ...base, status: "received", gradeId: outcome.gradeId ?? after.grade?.id ?? null,
        gradeStatus: after.grade?.status ?? null, previousStatus: input.before.grade?.status ?? null,
        opportunitiesBefore: input.before.opportunities, opportunitiesAfter: after.opportunities,
      },
    };
  } catch (error) {
    if (error instanceof AcademicGradeWritebackError) {
      return { status: error.status || 400, body: { ok: false, ...base, error: error.message, ...(error.code ? { code: error.code } : {}) } };
    }
    if (isArchivedStudentError(error)) {
      return { status: 423, body: { ok: false, ...base, code: "ARCHIVED", error: "الطالب مؤرشف ولا تنحفظ له أوراق." } };
    }
    throw error;
  }
}
