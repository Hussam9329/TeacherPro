import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getExamEntryAvailability, isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";
import {
  recalculateStudentsAcademicState,
  type AcademicServerRecalculationResult,
} from "@/lib/academic-recalculate-server";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";
import { baghdadDateKey } from "@/lib/baghdad-time";

export type AcademicGradeWritebackStatus =
  | "درجة"
  | "غائب"
  | "غش"
  | "ضمن فترة السماح";

type PrismaClientLike = typeof db | Prisma.TransactionClient;

export class AcademicGradeWritebackError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AcademicGradeWritebackError";
    this.status = status;
  }
}

export interface AcademicGradeWritebackResult {
  grade: {
    id: string;
    studentId: string;
    examId: string;
    status: string;
    score: number | null;
    notes: string | null;
    academicAccountingChecked: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  academicRecalculation: AcademicServerRecalculationResult;
}

export interface AcademicGradeWritebackInput {
  studentId: string;
  examId: string;
  status?: unknown;
  score?: unknown;
  notes?: unknown;
  academicAccountingChecked?: unknown;
  sourceLabel?: string;
  tx?: Prisma.TransactionClient;
  allowBlankGrade?: boolean;
  preserveExistingScoreWhenBlank?: boolean;
  blockOnLeave?: boolean;
  enforceExamAvailability?: boolean;
  allowDismissedExistingGradeCorrection?: boolean;
  deferAcademicRecalculation?: boolean;
}

export function normalizeAcademicGradeStatus(
  value: unknown,
  fallback: AcademicGradeWritebackStatus = "درجة",
): AcademicGradeWritebackStatus {
  const status = String(value ?? "").trim();
  return status === "غائب" ||
    status === "غش" ||
    status === "درجة" ||
    status === "ضمن فترة السماح"
    ? status
    : fallback;
}

function parseNumericScore(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new AcademicGradeWritebackError("يجب إدخال درجة رقمية صحيحة.");
  }
  if (!Number.isInteger(numeric)) {
    throw new AcademicGradeWritebackError(
      "الدرجات الكسرية غير مدعومة. أدخل عدداً صحيحاً بدون أجزاء عشرية.",
    );
  }
  return numeric;
}

export function hasAcademicGradeWritebackPayload(
  body: Record<string, unknown>,
): boolean {
  return [
    "gradeStatus",
    "grade_status",
    "gradeScore",
    "grade_score",
    "score",
    "finalScore",
    "final_score",
    "academicAccountingChecked",
    "academic_accounting_checked",
  ].some((key) => body[key] !== undefined);
}

export function readAcademicGradeWritebackStatus(
  body: Record<string, unknown>,
  fallback: AcademicGradeWritebackStatus = "درجة",
): AcademicGradeWritebackStatus {
  return normalizeAcademicGradeStatus(
    body.gradeStatus ??
      body.grade_status ??
      body.gradeState ??
      body.grade_state,
    fallback,
  );
}

export function readAcademicGradeWritebackScore(
  body: Record<string, unknown>,
): unknown {
  if (body.gradeScore !== undefined) return body.gradeScore;
  if (body.grade_score !== undefined) return body.grade_score;
  if (body.finalScore !== undefined) return body.finalScore;
  if (body.final_score !== undefined) return body.final_score;
  if (body.score !== undefined) return body.score;
  return undefined;
}

function parseCourseIds(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function dayStart(value: Date | string | null | undefined): Date | null {
  const key = baghdadDateKey(value);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dayEndExclusive(value: Date | string | null | undefined): Date | null {
  const start = dayStart(value);
  if (!start) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

async function hasBlockingLeave(
  client: PrismaClientLike,
  studentId: string,
  exam: { id: string; date: Date },
): Promise<boolean> {
  const examDayStart = dayStart(exam.date);
  const examDayEnd = dayEndExclusive(exam.date);
  const periodWhere: Prisma.StudentLeaveWhereInput[] = [];
  if (examDayStart && examDayEnd) {
    periodWhere.push({
      leaveType: "period",
      dateFrom: { lt: examDayEnd },
      dateTo: { gte: examDayStart },
    });
  }

  const leave = await client.studentLeave.findFirst({
    where: {
      studentId,
      OR: [{ examId: exam.id }, ...periodWhere],
    },
    select: { id: true },
  });
  return Boolean(leave);
}

export async function syncAcademicGradeWriteback(
  input: AcademicGradeWritebackInput,
): Promise<AcademicGradeWritebackResult | null> {
  const studentId = String(input.studentId || "").trim();
  const examId = String(input.examId || "").trim();
  if (!studentId || !examId) {
    throw new AcademicGradeWritebackError(
      "تعذر تحديد الطالب أو الامتحان لحفظ الدرجة.",
    );
  }

  const status = normalizeAcademicGradeStatus(input.status);
  const scoreWasProvided = input.score !== undefined;
  // Non-numeric states never consume or validate a stale numeric value from the client.
  const score = status === "درجة" ? parseNumericScore(input.score) : null;

  if (status === "درجة" && score === undefined && !input.allowBlankGrade) {
    return null;
  }

  const client = input.tx || db;
  const [student, exam] = await Promise.all([
    client.student.findUnique({
      where: { id: studentId },
      select: { id: true, courseId: true, status: true, createdAt: true, accountingGraceDays: true, gracePeriodStartDate: true },
    }),
    client.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        date: true,
        fullMark: true,
        courseIds: true,
        active: true,
        scheduledActivateAt: true,
        scheduledDeactivateAt: true,
      },
    }),
  ]);

  if (!student)
    throw new AcademicGradeWritebackError(
      "الطالب المرتبط بالدرجة غير موجود.",
      404,
    );
  if (!exam)
    throw new AcademicGradeWritebackError(
      "الامتحان المرتبط بالدرجة غير موجود.",
      404,
    );

  if (student.status === "مفصول" && !input.allowDismissedExistingGradeCorrection) {
    throw new AcademicGradeWritebackError(
      "الطالب مفصول ولا يمكن اعتماد درجة جديدة له. أعد تفعيله أولاً من الإجراء المخصص.",
    );
  }
  if (student.status === "مؤرشف") {
    throw new AcademicGradeWritebackError(
      "الطالب مؤرشف ولا يمكن اعتماد درجات على ملفه المقروء فقط.",
    );
  }

  if (input.enforceExamAvailability !== false) {
    const availability = getExamEntryAvailability(exam);
    if (!availability.available) {
      throw new AcademicGradeWritebackError(
        `لا يمكن اعتماد الدرجة: ${availability.reason}`,
      );
    }
  }

  const courseIds = parseCourseIds(exam.courseIds);
  if (courseIds.length > 0 && !courseIds.includes(student.courseId)) {
    throw new AcademicGradeWritebackError("الطالب ليس ضمن دورات هذا الامتحان.");
  }

  if (status === "درجة") {
    if (score === null && !input.allowBlankGrade) {
      throw new AcademicGradeWritebackError(
        "يجب إدخال درجة رقمية صالحة قبل اعتماد الدرجة.",
      );
    }
    if (score !== null && score !== undefined) {
      const fullMark = Number(exam.fullMark || 0);
      if (score < 0 || score > fullMark) {
        throw new AcademicGradeWritebackError(
          `الدرجة يجب أن تكون رقماً بين 0 و ${fullMark}`,
        );
      }
    }
  }

  if (
    input.blockOnLeave !== false &&
    (score !== undefined || status !== "درجة")
  ) {
    const blockedByLeave = await hasBlockingLeave(client, studentId, exam);
    if (blockedByLeave) {
      throw new AcademicGradeWritebackError(
        "لا يمكن اعتماد درجة لطالب مجاز من هذا الامتحان.",
      );
    }
  }

  // GRACE PERIOD & PRE-REGISTRATION PROTECTION:
  //
  // 1. PRE-REGISTRATION: If the exam date is BEFORE the student's
  //    registration date (createdAt), block ALL grade entries (درجة,
  //    غائب, غش). The student wasn't enrolled when the exam happened,
  //    so no grade should exist.
  //
  // 2. GRACE PERIOD: If the exam falls within the student's grace
  //    period, block "غائب" and allow the server-generated
  //    "ضمن فترة السماح" marker instead. That marker is a real grade
  //    record but has no score and no academic accounting effect.
  //
  // "درجة" (actual score) and "غش" (cheating) are still allowed during
  // grace period.
  const studentCreatedAtStr = student.createdAt.toISOString();
  const examDateStr = exam.date.toISOString();
  const studentGraceStartStr = student.gracePeriodStartDate ? student.gracePeriodStartDate.toISOString() : null;

  if (
    (status === "غائب" || status === "ضمن فترة السماح") &&
    !isExamOnOrAfterStudentRegistration(
      { createdAt: studentCreatedAtStr },
      { date: examDateStr },
    )
  ) {
    throw new AcademicGradeWritebackError(
      "لا يمكن تسجيل غياب لهذا الطالب في هذا الامتحان لأن الامتحان أقدم من تاريخ تسجيل الطالب. " +
      "الطالب لم يكن مسجلاً في النظام عند إجراء هذا الامتحان.",
      409,
    );
  }

  if (
    status === "غائب" &&
    isExamWithinStudentGraceWindow(
      { createdAt: studentCreatedAtStr, accountingGraceDays: student.accountingGraceDays, gracePeriodStartDate: studentGraceStartStr },
      { date: examDateStr },
    )
  ) {
    throw new AcademicGradeWritebackError(
      "لا يمكن تسجيل غياب لهذا الطالب في هذا الامتحان لأنه ضمن فترة السماح. " +
      "فترة السماح تحمي الطالب من المحاسبة على الامتحانات خلالها.",
      409,
    );
  }

  if (
    status === "ضمن فترة السماح" &&
    !isExamWithinStudentGraceWindow(
      { createdAt: studentCreatedAtStr, accountingGraceDays: student.accountingGraceDays, gracePeriodStartDate: studentGraceStartStr },
      { date: examDateStr },
    )
  ) {
    throw new AcademicGradeWritebackError(
      "لا يمكن تسجيل حالة ضمن فترة السماح لأن الامتحان خارج فترة سماح الطالب.",
      409,
    );
  }

  const notes =
    input.notes === undefined
      ? input.sourceLabel
        ? `تم تحديث الدرجة من ${input.sourceLabel}.`
        : undefined
      : String(input.notes || "");

  const shouldWriteScore =
    status !== "درجة" ||
    (scoreWasProvided &&
      !(
        input.preserveExistingScoreWhenBlank &&
        status === "درجة" &&
        score === null
      ));

  const grade = await client.grade.upsert({
    where: { studentId_examId: { studentId, examId } },
    update: {
      status,
      ...(shouldWriteScore ? { score: status === "درجة" ? score : null } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(input.academicAccountingChecked !== undefined
        ? {
            academicAccountingChecked: Boolean(input.academicAccountingChecked),
          }
        : {}),
    },
    create: {
      studentId,
      examId,
      status,
      score: status === "درجة" ? (score ?? null) : null,
      notes: notes || null,
      academicAccountingChecked: Boolean(input.academicAccountingChecked),
    },
  });

  const academicRecalculation = input.deferAcademicRecalculation
    ? {
        studentIds: [studentId],
        students: [],
        opportunityLogs: [],
        automaticOpportunityLogs: [],
      }
    : await recalculateStudentsAcademicState(
        [studentId],
        input.tx ? { tx: input.tx } : {},
      );

  return { grade, academicRecalculation };
}
