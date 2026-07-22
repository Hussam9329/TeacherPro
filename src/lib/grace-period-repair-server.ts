import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";

type PrismaClientLike = typeof db | Prisma.TransactionClient;

type ProtectedGradeCandidate = {
  id: string;
  studentId: string;
  examId: string;
  status: string;
  student: {
    createdAt: Date;
    accountingGraceDays: number;
    gracePeriodStartDate: Date | null;
  };
  exam: { date: Date };
};

export type GracePeriodRepairResult = {
  studentIds: string[];
  convertedGrades: number;
  convertedBeforeRegistration: number;
  deletedGrades: number;
  deletedCalls: number;
};

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

/**
 * Converts grace-protected absences to an explicit scoreless grace marker,
 * removes impossible pre-registration absences, and removes related call rows.
 * Call this inside the
 * same transaction as grace/registration changes, before academic
 * recalculation, so no request can observe a protected student as absent.
 */
export async function repairProtectedAbsencesForStudents(
  client: PrismaClientLike,
  rawStudentIds: Array<string | null | undefined>,
  options: { deleteCalls?: boolean; onlyAbsences?: boolean } = {},
): Promise<GracePeriodRepairResult> {
  const requestedStudentIds = uniqueIds(rawStudentIds);
  if (requestedStudentIds.length === 0) {
    return { studentIds: [], convertedGrades: 0, convertedBeforeRegistration: 0, deletedGrades: 0, deletedCalls: 0 };
  }

  const candidates = (await client.grade.findMany({
    where: {
      studentId: { in: requestedStudentIds },
      status: { not: "قبل تسجيل الطالب" },
    },
    select: {
      id: true,
      studentId: true,
      examId: true,
      status: true,
      student: {
        select: {
          createdAt: true,
          accountingGraceDays: true,
          gracePeriodStartDate: true,
        },
      },
      exam: { select: { date: true } },
    },
  })) as ProtectedGradeCandidate[];
  const beforeRegistration = candidates.filter(
    (grade) =>
      (!options.onlyAbsences || grade.status === "غائب") &&
      !isExamOnOrAfterStudentRegistration(grade.student, grade.exam),
  );
  const withinGrace = candidates.filter(
    (grade) =>
      grade.status === "غائب" &&
      isExamOnOrAfterStudentRegistration(grade.student, grade.exam) &&
      isExamWithinStudentGraceWindow(grade.student, grade.exam),
  );
  const protectedAbsences = [...beforeRegistration, ...withinGrace];
  if (protectedAbsences.length === 0) {
    return { studentIds: [], convertedGrades: 0, convertedBeforeRegistration: 0, deletedGrades: 0, deletedCalls: 0 };
  }

  const affectedStudentIds = uniqueIds(protectedAbsences.map((grade) => grade.studentId));
  const callResult = options.deleteCalls === false
    ? { count: 0 }
    : await client.studentCall.deleteMany({
        where: {
          OR: protectedAbsences.map((grade) => ({
            studentId: grade.studentId,
            examId: grade.examId,
          })),
        },
      });
  const graceGradeIds = withinGrace.map((grade) => grade.id);
  const convertedResult = graceGradeIds.length
    ? await client.grade.updateMany({
        where: { id: { in: graceGradeIds } },
        data: {
          status: "ضمن فترة السماح",
          score: null,
        },
      })
    : { count: 0 };
  if (graceGradeIds.length) {
    await client.grade.updateMany({
      where: {
        id: { in: graceGradeIds },
        OR: [
          { notes: null },
          { notes: "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم" },
        ],
      },
      data: { notes: "تصحيح تلقائي: كان الامتحان ضمن فترة السماح" },
    });
  }
  const beforeRegistrationGradeIds = beforeRegistration.map((grade) => grade.id);
  const beforeRegistrationResult = beforeRegistrationGradeIds.length
    ? await client.grade.updateMany({
        where: { id: { in: beforeRegistrationGradeIds } },
        data: {
          status: "قبل تسجيل الطالب",
          score: null,
        },
      })
    : { count: 0 };
  if (beforeRegistrationGradeIds.length) {
    await client.grade.updateMany({
      where: {
        id: { in: beforeRegistrationGradeIds },
        OR: [
          { notes: null },
          { notes: "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم" },
        ],
      },
      data: { notes: "تصحيح تلقائي: الامتحان يسبق تاريخ تسجيل الطالب" },
    });
  }

  return {
    studentIds: affectedStudentIds,
    convertedGrades: convertedResult.count,
    convertedBeforeRegistration: beforeRegistrationResult.count,
    deletedGrades: 0,
    deletedCalls: callResult.count,
  };
}
