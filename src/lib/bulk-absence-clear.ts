import type { Prisma } from "@prisma/client";
import { STUDENT_STATUS_ACTIVE } from "./student-scope";

type AbsenceRow = {
  id: string;
  studentId: string;
  examId: string;
  status: string;
  academicEffectExcluded?: boolean | null;
};

/** Bulk cancellation only concerns active students. Dismissed and archived
 * students keep their historical records, including the cause of dismissal. */
export function bulkAbsenceClearWhere(examId: string): Prisma.GradeWhereInput {
  return {
    examId,
    status: "غائب",
    academicEffectExcluded: false,
    student: { is: { status: STUDENT_STATUS_ACTIVE } },
  };
}

export function canBulkClearAbsence(
  grade: AbsenceRow,
  studentStatus?: string | null,
): boolean {
  return grade.status === "غائب" && !grade.academicEffectExcluded &&
    studentStatus === STUDENT_STATUS_ACTIVE;
}

/** Remove only acknowledged deletions. Older responses may provide student
 * IDs instead; an empty/unknown acknowledgement must never clear the sheet. */
export function retainUnremovedAbsences<T extends AbsenceRow>(
  grades: readonly T[],
  examId: string,
  acknowledgement: { deletedGradeIds?: string[]; studentIds?: string[] },
): T[] {
  const gradeIds = Array.isArray(acknowledgement.deletedGradeIds)
    ? new Set(acknowledgement.deletedGradeIds)
    : null;
  const studentIds = new Set(acknowledgement.studentIds || []);
  return grades.filter(grade => grade.examId !== examId || grade.status !== "غائب" ||
    !(gradeIds ? gradeIds.has(grade.id) : studentIds.has(grade.studentId)));
}
