import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  isExamOnOrAfterStudentRegistration,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import { parseCourseIds } from "@/lib/exam-course-links";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import { studentLeaveAppliesToExam } from "@/lib/grade-classification";

type PrismaClientLike = typeof db | Prisma.TransactionClient;

export type ProtectedGradeMarkerSyncResult = {
  createdBeforeRegistration: number;
  createdGrace: number;
  createdAbsent: number;
  createdExcused: number;
};

export async function ensureProtectedGradeMarkers(
  client: PrismaClientLike,
  options: {
    studentIds?: string[];
    examIds?: string[];
    includeAbsent?: boolean;
    excludeExamIds?: string[];
    historicalNoEffect?: boolean;
  } = {},
): Promise<ProtectedGradeMarkerSyncResult> {
  const requestedStudentIds = Array.from(
    new Set((options.studentIds || []).map(String).filter(Boolean)),
  );
  const requestedExamIds = Array.from(
    new Set((options.examIds || []).map(String).filter(Boolean)),
  );
  const excludedExamIds = new Set(
    (options.excludeExamIds || []).map(String).filter(Boolean),
  );
  if (options.studentIds && requestedStudentIds.length === 0) {
    return { createdBeforeRegistration: 0, createdGrace: 0, createdAbsent: 0, createdExcused: 0 };
  }
  if (options.examIds && requestedExamIds.length === 0) {
    return { createdBeforeRegistration: 0, createdGrace: 0, createdAbsent: 0, createdExcused: 0 };
  }

  const [students, exams] = await Promise.all([
    client.student.findMany({
      where: {
        ...(options.studentIds ? { id: { in: requestedStudentIds } } : {}),
        status: { not: "مؤرشف" },
      },
      select: {
        id: true,
        courseId: true,
        createdAt: true,
        accountingGraceDays: true,
        gracePeriodStartDate: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
      },
    }),
    client.exam.findMany({
      where: options.examIds ? { id: { in: requestedExamIds } } : undefined,
      select: { id: true, courseIds: true, mainSite: true, date: true },
    }),
  ]);
  if (students.length === 0 || exams.length === 0) {
    return { createdBeforeRegistration: 0, createdGrace: 0, createdAbsent: 0, createdExcused: 0 };
  }

  const [existingGrades, studentLeaves] = await Promise.all([
    client.grade.findMany({
      where: {
        studentId: { in: students.map((student) => student.id) },
        examId: { in: exams.map((exam) => exam.id) },
      },
      select: { studentId: true, examId: true },
    }),
    client.studentLeave.findMany({
      where: { studentId: { in: students.map((student) => student.id) } },
      select: {
        studentId: true,
        examId: true,
        leaveType: true,
        date: true,
        dateFrom: true,
        dateTo: true,
      },
    }),
  ]);
  const existingKeys = new Set(
    existingGrades.map((grade) => `${grade.studentId}:${grade.examId}`),
  );
  const leavesByStudent = new Map<string, typeof studentLeaves>();
  for (const leave of studentLeaves) {
    const rows = leavesByStudent.get(leave.studentId) || [];
    rows.push(leave);
    leavesByStudent.set(leave.studentId, rows);
  }
  const beforeRegistrationRows: Prisma.GradeCreateManyInput[] = [];
  const graceRows: Prisma.GradeCreateManyInput[] = [];
  const absentRows: Prisma.GradeCreateManyInput[] = [];
  const excusedRows: Prisma.GradeCreateManyInput[] = [];
  const todayKey = baghdadTodayKey();

  for (const student of students) {
    for (const exam of exams) {
      if (excludedExamIds.has(exam.id)) continue;
      if (!parseCourseIds(exam.courseIds).includes(student.courseId)) continue;
      if (
        !studentMatchesExamMainSites(
          student,
          splitSelection(String(exam.mainSite || "")),
        )
      ) {
        continue;
      }
      if (existingKeys.has(`${student.id}:${exam.id}`)) continue;
      const hasLeave =
        (leavesByStudent.get(student.id) || []).some((leave) =>
          studentLeaveAppliesToExam(leave, exam),
        );

      if (hasLeave) {
        excusedRows.push({
          studentId: student.id,
          examId: exam.id,
          status: "مجاز",
          score: null,
          notes: "تسجيل تلقائي: الطالب مجاز من هذا الامتحان",
        });
      } else if (!isExamOnOrAfterStudentRegistration(student, exam)) {
        beforeRegistrationRows.push({
          studentId: student.id,
          examId: exam.id,
          status: "قبل تسجيل الطالب",
          score: null,
          notes: "تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب",
        });
      } else if (isExamWithinStudentGraceWindow(student, exam)) {
        graceRows.push({
          studentId: student.id,
          examId: exam.id,
          status: "ضمن فترة السماح",
          score: null,
          notes: "تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان",
        });
      } else if (options.includeAbsent && baghdadDateKey(exam.date) < todayKey) {
        absentRows.push({
          studentId: student.id,
          examId: exam.id,
          status: "غائب",
          score: null,
          notes: options.historicalNoEffect
            ? "تسوية تاريخية بلا أثر: إكمال حالة امتحان سابق"
            : "تسجيل تلقائي: لم تُدخل درجة الطالب في امتحان سابق",
        });
      }
    }
  }

  const beforeRegistration = beforeRegistrationRows.length
    ? await client.grade.createMany({
        data: beforeRegistrationRows,
        skipDuplicates: true,
      })
    : { count: 0 };
  const grace = graceRows.length
    ? await client.grade.createMany({ data: graceRows, skipDuplicates: true })
    : { count: 0 };
  const absent = absentRows.length
    ? await client.grade.createMany({ data: absentRows, skipDuplicates: true })
    : { count: 0 };
  const excused = excusedRows.length
    ? await client.grade.createMany({ data: excusedRows, skipDuplicates: true })
    : { count: 0 };

  return {
    createdBeforeRegistration: beforeRegistration.count,
    createdGrace: grace.count,
    createdAbsent: absent.count,
    createdExcused: excused.count,
  };
}
