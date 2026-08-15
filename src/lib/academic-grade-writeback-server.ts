import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  recalculateStudentsAcademicState,
  type AcademicServerRecalculationResult,
} from "@/lib/academic-recalculate-server";
import { evaluateStudentExamEligibility } from "@/lib/student-exam-eligibility-server";
import { lockStudentsAcademicState } from "@/lib/academic-student-lock-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

export type AcademicGradeWritebackStatus = "درجة" | "غائب" | "غش";

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
}

export function normalizeAcademicGradeStatus(
  value: unknown,
  fallback: AcademicGradeWritebackStatus = "درجة",
): AcademicGradeWritebackStatus {
  const status = String(value ?? "").trim();
  return status === "غائب" || status === "غش" || status === "درجة"
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

  if (!input.tx) {
    return withSerializableTransaction((tx) =>
      syncAcademicGradeWriteback({ ...input, tx }),
    );
  }

  const client = input.tx;
  await lockStudentsAcademicState(input.tx, [studentId]);

  const [student, exam] = await Promise.all([
    client.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        courseId: true,
        status: true,
        createdAt: true,
        accountingGraceDays: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
      },
    }),
    client.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        date: true,
        fullMark: true,
        courseIds: true,
        mainSite: true,
        active: true,
        scheduledActivateAt: true,
        scheduledDeactivateAt: true,
        examCourses: { select: { courseId: true } },
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

  const eligibility = await evaluateStudentExamEligibility(client, student, exam, {
    requireActiveChapter: false,
    checkAvailability: input.enforceExamAvailability !== false,
    // A historical pre-registration grade may still be stored for documentation;
    // the academic engine and profile explain permanently why it is not counted.
    checkRegistration: false,
    checkLeave: input.blockOnLeave !== false,
    allowDismissed: Boolean(input.allowDismissedExistingGradeCorrection),
  });
  if (!eligibility.eligible) {
    throw new AcademicGradeWritebackError(eligibility.reason);
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

  const academicRecalculation = await recalculateStudentsAcademicState(
    [studentId],
    input.tx ? { tx: input.tx } : {},
  );

  return { grade, academicRecalculation };
}
