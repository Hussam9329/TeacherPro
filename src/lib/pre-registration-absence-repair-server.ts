import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";

type PrismaClientLike = typeof db | Prisma.TransactionClient;

export type PreRegistrationAbsenceRepairResult = {
  studentIds: string[];
  convertedBeforeRegistration: number;
};

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

/**
 * Converts impossible absences for exams that predate the student's
 * registration into the scoreless "قبل تسجيل الطالب" marker. Grace periods
 * are never involved: an absence inside a grace period is a real fact that
 * stays stored as "غائب" and is excused by the accounting engine by exam date.
 * Call inside the same transaction as a registration-date change, before
 * academic recalculation.
 */
export async function repairPreRegistrationAbsencesForStudents(
  client: PrismaClientLike,
  rawStudentIds: Array<string | null | undefined>,
  options: { examIds?: string[] } = {},
): Promise<PreRegistrationAbsenceRepairResult> {
  const requestedStudentIds = uniqueIds(rawStudentIds);
  if (requestedStudentIds.length === 0) {
    return { studentIds: [], convertedBeforeRegistration: 0 };
  }

  const candidates = await client.grade.findMany({
    where: {
      studentId: { in: requestedStudentIds },
      ...(options.examIds ? { examId: { in: uniqueIds(options.examIds) } } : {}),
      status: "غائب",
    },
    select: {
      id: true,
      studentId: true,
      student: { select: { createdAt: true } },
      exam: { select: { date: true } },
    },
  });
  const beforeRegistration = candidates.filter(
    (grade) => !isExamOnOrAfterStudentRegistration(grade.student, grade.exam),
  );
  if (beforeRegistration.length === 0) {
    return { studentIds: [], convertedBeforeRegistration: 0 };
  }

  const gradeIds = beforeRegistration.map((grade) => grade.id);
  const converted = await client.grade.updateMany({
    where: { id: { in: gradeIds } },
    data: { status: "قبل تسجيل الطالب", score: null },
  });
  await client.grade.updateMany({
    where: {
      id: { in: gradeIds },
      OR: [
        { notes: null },
        { notes: "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم" },
      ],
    },
    data: { notes: "قبل تسجيل الطالب" },
  });

  return {
    studentIds: uniqueIds(beforeRegistration.map((grade) => grade.studentId)),
    convertedBeforeRegistration: converted.count,
  };
}
