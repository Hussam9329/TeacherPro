import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { gradeMatchesStatusFilterUnified, type GradeStatusFilter } from "@/lib/grade-classification";
import { annotateGradeSettlementEffects } from "@/lib/grade-settlement-server";
import { loadActiveGracePeriodsByStudent } from "@/lib/grace-periods-server";

/**
 * «سجل الدرجات» filters that depend on the academic classification (leaves,
 * grace periods, registration date, exam rules, settlements). They are decided
 * by the same shared classifier over lean rows, so a filter never loads every
 * grade with its full student, leaves and exam; only the requested page does.
 */
export const CLASSIFIED_GRADE_FILTERS = new Set<GradeStatusFilter>([
  "excused",
  "grace-period",
  "discounted",
  "failed",
  "academic-accounting",
  "passed",
  "full-mark",
  "has-grade",
]);

/** The only fields the classifier reads, per row kind. */
export const CLASSIFIER_GRADE_SELECT = {
  id: true,
  studentId: true,
  examId: true,
  status: true,
  score: true,
  notes: true,
  academicEffectExcluded: true,
  updatedAt: true,
} as const satisfies Prisma.GradeSelect;
export const CLASSIFIER_STUDENT_SELECT = { id: true, courseId: true, createdAt: true } as const satisfies Prisma.StudentSelect;
export const CLASSIFIER_LEAVE_SELECT = {
  studentId: true,
  examId: true,
  leaveType: true,
  date: true,
  dateFrom: true,
  dateTo: true,
} as const satisfies Prisma.StudentLeaveSelect;

const ENTERED_GRADE_WHERE: Prisma.GradeWhereInput = {
  OR: [
    { status: "درجة", score: { not: null } },
    { status: { in: ["غائب", "غش", "مجاز", "قبل تسجيل الطالب"] } },
  ],
};

/**
 * The part of a filter the database can apply. "has-grade" depends only on the
 * status and score, so it is exact; the score-based results can only come from
 * a numeric grade, so the rest of their rows are never read.
 */
export function gradeStatusFilterWhere(filter: GradeStatusFilter): Prisma.GradeWhereInput | null {
  switch (filter) {
    case "has-grade":
      return ENTERED_GRADE_WHERE;
    case "passed":
    case "full-mark":
    case "failed":
    case "discounted":
    case "academic-accounting":
      return { status: "درجة", score: { not: null } };
    default:
      return null;
  }
}

/** True when the database where alone decides the filter. */
export function gradeStatusFilterIsExact(filter: GradeStatusFilter): boolean {
  return filter === "has-grade";
}

function chunks<T>(items: T[], size = 5000): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/**
 * Grades under `where` that match a classified filter, newest change first,
 * as lean `{ id, studentId }` rows. `withSettlements` applies the settlement
 * exclusions first, as the per-grade list does; the per-student cards do not.
 */
export async function findGradesMatchingStatusFilter(
  where: Prisma.GradeWhereInput,
  filter: GradeStatusFilter,
  { withSettlements }: { withSettlements: boolean },
): Promise<Array<{ id: string; studentId: string }>> {
  const narrowing = gradeStatusFilterWhere(filter);
  const grades = await db.grade.findMany({
    where: narrowing ? { AND: [where, narrowing] } : where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: CLASSIFIER_GRADE_SELECT,
  });
  if (!grades.length || gradeStatusFilterIsExact(filter)) return grades;

  const studentIds = [...new Set(grades.map((grade) => grade.studentId))];
  const examIds = [...new Set(grades.map((grade) => grade.examId))];
  const [exams, students, leaves, gracePeriods] = await Promise.all([
    db.exam.findMany({ where: { id: { in: examIds } } }),
    Promise.all(chunks(studentIds).map((ids) =>
      db.student.findMany({ where: { id: { in: ids } }, select: CLASSIFIER_STUDENT_SELECT }))).then((parts) => parts.flat()),
    Promise.all(chunks(studentIds).map((ids) =>
      db.studentLeave.findMany({ where: { studentId: { in: ids } }, select: CLASSIFIER_LEAVE_SELECT }))).then((parts) => parts.flat()),
    loadActiveGracePeriodsByStudent(db, studentIds),
    withSettlements ? annotateGradeSettlementEffects(grades) : undefined,
  ]);

  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const studentById = new Map(students.map((student) => [student.id, student]));
  const leavesByStudent = new Map<string, typeof leaves>();
  for (const leave of leaves) {
    const list = leavesByStudent.get(leave.studentId) || [];
    list.push(leave);
    leavesByStudent.set(leave.studentId, list);
  }

  return grades.filter((grade) => {
    const exam = examById.get(grade.examId);
    const student = studentById.get(grade.studentId);
    if (!exam || !student) return false;
    return gradeMatchesStatusFilterUnified(filter, grade, exam, {
      student: { ...student, gracePeriods: gracePeriods.get(student.id) || [] },
      leaves: leavesByStudent.get(student.id) || [],
    });
  });
}
