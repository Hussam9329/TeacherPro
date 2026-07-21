import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  isExamOnOrAfterStudentRegistration,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import { parseCourseIds } from "@/lib/exam-course-links";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";

type PrismaClientLike = typeof db | Prisma.TransactionClient;

export type ProtectedGradeMarkerSyncResult = {
  createdBeforeRegistration: number;
  createdGrace: number;
};

export async function ensureProtectedGradeMarkers(
  client: PrismaClientLike,
  options: { studentIds?: string[]; examIds?: string[] } = {},
): Promise<ProtectedGradeMarkerSyncResult> {
  const requestedStudentIds = Array.from(
    new Set((options.studentIds || []).map(String).filter(Boolean)),
  );
  const requestedExamIds = Array.from(
    new Set((options.examIds || []).map(String).filter(Boolean)),
  );
  if (options.studentIds && requestedStudentIds.length === 0) {
    return { createdBeforeRegistration: 0, createdGrace: 0 };
  }
  if (options.examIds && requestedExamIds.length === 0) {
    return { createdBeforeRegistration: 0, createdGrace: 0 };
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
    return { createdBeforeRegistration: 0, createdGrace: 0 };
  }

  const existingGrades = await client.grade.findMany({
    where: {
      studentId: { in: students.map((student) => student.id) },
      examId: { in: exams.map((exam) => exam.id) },
    },
    select: { studentId: true, examId: true },
  });
  const existingKeys = new Set(
    existingGrades.map((grade) => `${grade.studentId}:${grade.examId}`),
  );
  const beforeRegistrationRows: Prisma.GradeCreateManyInput[] = [];
  const graceRows: Prisma.GradeCreateManyInput[] = [];

  for (const student of students) {
    for (const exam of exams) {
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

      if (!isExamOnOrAfterStudentRegistration(student, exam)) {
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

  return {
    createdBeforeRegistration: beforeRegistration.count,
    createdGrace: grace.count,
  };
}
