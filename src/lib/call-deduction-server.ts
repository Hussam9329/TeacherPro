import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { loadActiveGracePeriodsByStudent } from "@/lib/grace-periods-server";
import {
  classifyGradeAcademicImpact,
  type GradeClassificationKind,
} from "@/lib/grade-classification";
import { studentCourseScopeWhere } from "@/lib/student-scope";
import {
  buildImplicitCallAbsenceGrade,
  resolveCallAbsenceSource,
} from "@/lib/call-absence";

/**
 * «المخصومين» as the calls count them: an absence with no leave or grace
 * period (entered or never entered, dismissed students included), cheating,
 * and a grade at or below the deduction or dismissal mark. «سجل الدرجات»
 * reads the same rule so both pages give the same students.
 */
export function isCallDeductedImpact(kind: GradeClassificationKind): boolean {
  return (
    kind === "absent-deducted" ||
    kind === "absent-dismissal" ||
    kind === "discounted" ||
    kind === "dismissal" ||
    kind === "cheating"
  );
}

const EXAM_SELECT = {
  id: true,
  name: true,
  type: true,
  date: true,
  courseIds: true,
  mainSite: true,
  fullMark: true,
  passMark: true,
  discountMark: true,
  opportunitiesPenalty: true,
  dismissalGrade: true,
  noDiscount: true,
  active: true,
  scheduledActivateAt: true,
} as const satisfies Prisma.ExamSelect;

function parseCourseIds(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** The calls' rule: an exam with no course list belongs to every course. */
function examIncludesCourse(courseIds: string, courseId: string) {
  const ids = parseCourseIds(courseIds);
  return ids.length === 0 || ids.includes(courseId);
}

type LeaveRow = {
  studentId: string;
  examId: string | null;
  leaveType: string;
  date: Date;
  dateFrom: Date | null;
  dateTo: Date | null;
};

function leavesForExam(leaves: LeaveRow[], exam: { id: string; date: Date }): LeaveRow[] {
  const examDay = baghdadDateKey(exam.date);
  return leaves.filter((leave) => {
    if ((leave.leaveType || "exam") === "period") {
      const from = baghdadDateKey(leave.dateFrom || leave.date);
      const to = baghdadDateKey(leave.dateTo || leave.dateFrom || leave.date);
      return Boolean(examDay && from && to && examDay >= from && examDay <= to);
    }
    return leave.examId === exam.id;
  });
}

/**
 * Every (student, exam) the calls page lists under «المخصومين», for the given
 * course (or every course) and exam (or every exam of each course). A student
 * without a grade who counts as absent comes with `grade: null`.
 */
export async function loadCallDeductedCases(options: { courseId?: string; examId?: string }) {
  const [courses, exams] = await Promise.all([
    options.courseId
      ? Promise.resolve([{ id: options.courseId }])
      : db.course.findMany({ select: { id: true } }),
    db.exam.findMany({
      where: options.examId ? { id: options.examId } : {},
      select: EXAM_SELECT,
      orderBy: [{ date: "desc" }, { name: "asc" }],
    }),
  ]);

  const cases: Array<{
    studentId: string;
    examId: string;
    grade: { id: string; status: string; score: number | null } | null;
    impactKind: GradeClassificationKind;
  }> = [];

  for (const course of courses) {
    const courseExams = exams.filter((exam) => examIncludesCourse(exam.courseIds, course.id));
    if (courseExams.length === 0) continue;
    const scope = studentCourseScopeWhere(course.id, "followup");
    const examIds = courseExams.map((exam) => exam.id);
    const students = await db.student.findMany({
      where: scope,
      select: {
        id: true, status: true, createdAt: true, courseId: true,
        mainSite: true, subSite: true, locationScope: true,
      },
    });
    if (students.length === 0) continue;
    const studentIds = students.map((student) => student.id);
    const [grades, attempts, leaves, graceByStudent] = await Promise.all([
      db.grade.findMany({
        where: { examId: { in: examIds }, student: { is: scope } },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true, studentId: true, examId: true, status: true, score: true, notes: true,
          academicAccountingChecked: true, academicEffectExcluded: true,
          academicEffectExclusionReason: true, academicEffectExclusionSource: true,
          createdAt: true, updatedAt: true,
        },
      }),
      db.gradeSmartNote.findMany({
        where: { examId: { in: examIds }, score: { not: null }, student: { is: scope } },
        select: { studentId: true, examId: true },
      }),
      db.studentLeave.findMany({
        where: { studentId: { in: studentIds } },
        select: { studentId: true, examId: true, leaveType: true, date: true, dateFrom: true, dateTo: true },
      }),
      loadActiveGracePeriodsByStudent(db, studentIds),
    ]);

    const gradeByKey = new Map<string, (typeof grades)[number]>();
    for (const grade of grades) {
      const key = `${grade.studentId}:${grade.examId}`;
      if (!gradeByKey.has(key)) gradeByKey.set(key, grade);
    }
    const attempted = new Set(attempts.map((note) => `${note.studentId}:${note.examId}`));
    const leavesByStudent = new Map<string, LeaveRow[]>();
    for (const leave of leaves) {
      const list = leavesByStudent.get(leave.studentId) || [];
      list.push(leave);
      leavesByStudent.set(leave.studentId, list);
    }

    for (const exam of courseExams) {
      for (const stored of students) {
        const student = { ...stored, gracePeriods: graceByStudent.get(stored.id) || [] };
        const key = `${student.id}:${exam.id}`;
        const storedGrade = gradeByKey.get(key);
        const examLeaves = leavesForExam(leavesByStudent.get(student.id) || [], exam);
        const absenceSource = resolveCallAbsenceSource({
          grade: storedGrade,
          exam,
          student,
          leaves: examLeaves,
          hasAttemptEvidence: attempted.has(key),
        });
        const grade = storedGrade || (absenceSource === "missing"
          ? buildImplicitCallAbsenceGrade({ studentId: student.id, examId: exam.id, examDate: exam.date })
          : undefined);
        if (!grade) continue;
        const impactKind = classifyGradeAcademicImpact(grade, exam, { student, leaves: examLeaves });
        if (!isCallDeductedImpact(impactKind)) continue;
        cases.push({
          studentId: student.id,
          examId: exam.id,
          grade: storedGrade ? { id: storedGrade.id, status: storedGrade.status, score: storedGrade.score } : null,
          impactKind,
        });
      }
    }
  }
  return cases;
}
