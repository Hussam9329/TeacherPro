import type { Prisma } from "@prisma/client";
import { parseCourseIds } from "@/lib/exam-course-links";
import {
  isExamOnOrAfterStudentRegistration,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";

/**
 * Grade-override leave termination.
 *
 * Unified rule: entering a numeric grade (zero included) for a student whose
 * leave covers that exam ends the covering leave(s) inside the same database
 * transaction and the grade is stored counted. Absence/cheating attempts
 * during a leave keep their existing coercion to "مجاز".
 *
 * The semantics mirror the official leave-deletion path in
 * /api/student-leaves: مجاز markers are cleared, backed-up grades are
 * restored for every exam the leave covered, backups are removed, and the
 * leave row is deleted. The teacher's typed grade is written afterwards, so
 * it wins over whatever was restored for this exam.
 */

type LeaveRow = {
  id: string;
  studentId: string;
  examId: string | null;
  leaveType: string;
  reason: string;
  date: Date;
  dateFrom: Date | null;
  dateTo: Date | null;
};

type LeaveGradeBackupRow = {
  studentId: string;
  examId: string;
  status: string;
  score: number | null;
  notes: string | null;
  academicAccountingChecked: boolean;
  academicEffectExcluded: boolean;
  academicEffectExclusionReason: string | null;
  academicEffectExclusionSource: string | null;
  smartNoteId: string | null;
  gradeCreatedAt: Date | null;
};

function dayAfter(value: Date): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function findLeavesCoveringExam(
  client: Prisma.TransactionClient,
  studentId: string,
  exam: { id: string; date: Date },
): Promise<LeaveRow[]> {
  const examDayStart = new Date(
    Date.UTC(
      exam.date.getUTCFullYear(),
      exam.date.getUTCMonth(),
      exam.date.getUTCDate(),
    ),
  );
  const examDayEnd = dayAfter(examDayStart);
  return client.studentLeave.findMany({
    where: {
      studentId,
      OR: [
        { examId: exam.id },
        {
          leaveType: "period",
          dateFrom: { lt: examDayEnd },
          dateTo: { gte: examDayStart },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}

async function affectedExamIdsForLeave(
  client: Prisma.TransactionClient,
  leave: LeaveRow,
): Promise<string[]> {
  if (leave.leaveType !== "period") {
    return leave.examId ? [leave.examId] : [];
  }
  const dateFrom = leave.dateFrom || leave.date;
  const dateTo = leave.dateTo || leave.dateFrom || leave.date;
  const [student, exams] = await Promise.all([
    client.student.findUnique({
      where: { id: leave.studentId },
      select: {
        courseId: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
      },
    }),
    client.exam.findMany({
      where: { date: { gte: dateFrom, lt: dayAfter(dateTo) } },
      select: { id: true, courseIds: true, mainSite: true },
    }),
  ]);
  if (!student) return [];
  return exams
    .filter(
      (exam) =>
        parseCourseIds(exam.courseIds).includes(student.courseId) &&
        studentMatchesExamMainSites(
          student,
          splitSelection(String(exam.mainSite || "")),
        ),
    )
    .map((exam) => exam.id);
}

async function restoreLeaveBackups(
  client: Prisma.TransactionClient,
  leave: LeaveRow,
  examIds: string[],
): Promise<number> {
  if (examIds.length) {
    await client.grade.deleteMany({
      where: {
        studentId: leave.studentId,
        examId: { in: examIds },
        status: "مجاز",
      },
    });
  }

  const backups = await client.$queryRaw<LeaveGradeBackupRow[]>`
    SELECT
      "studentId",
      "examId",
      "status",
      "score",
      "notes",
      "academicAccountingChecked",
      "academicEffectExcluded",
      "academicEffectExclusionReason",
      "academicEffectExclusionSource",
      "smartNoteId",
      "gradeCreatedAt"
    FROM "StudentLeaveGradeBackup"
    WHERE "leaveId" = ${leave.id}
    ORDER BY "createdAt" ASC
  `;
  if (!backups.length) return 0;

  const [students, exams] = await Promise.all([
    client.student.findMany({
      where: { id: { in: backups.map((backup) => backup.studentId) } },
      select: {
        id: true,
        createdAt: true,
        accountingGraceDays: true,
        gracePeriodStartDate: true,
        gracePeriodEndedAt: true,
      },
    }),
    client.exam.findMany({
      where: { id: { in: backups.map((backup) => backup.examId) } },
      select: { id: true, date: true },
    }),
  ]);
  const studentById = new Map(students.map((row) => [row.id, row] as const));
  const examById = new Map(exams.map((row) => [row.id, row] as const));

  let restored = 0;
  for (const backup of backups) {
    const student = studentById.get(backup.studentId);
    const exam = examById.get(backup.examId);
    // Same guard as the official deletion path: never restore an absence that
    // was invalid in the first place (before registration or inside grace).
    if (
      backup.status === "غائب" &&
      student &&
      exam &&
      (!isExamOnOrAfterStudentRegistration(student, exam) ||
        isExamWithinStudentGraceWindow(student, exam))
    ) {
      continue;
    }
    await client.grade.upsert({
      where: {
        studentId_examId: {
          studentId: backup.studentId,
          examId: backup.examId,
        },
      },
      update: {
        status: backup.status,
        score: backup.status === "درجة" ? backup.score : null,
        notes: backup.notes,
        academicAccountingChecked: backup.academicAccountingChecked,
        academicEffectExcluded: backup.academicEffectExcluded,
        academicEffectExclusionReason: backup.academicEffectExclusionReason,
        academicEffectExclusionSource: backup.academicEffectExclusionSource,
        smartNoteId: backup.smartNoteId,
      },
      create: {
        studentId: backup.studentId,
        examId: backup.examId,
        status: backup.status,
        score: backup.status === "درجة" ? backup.score : null,
        notes: backup.notes,
        academicAccountingChecked: backup.academicAccountingChecked,
        academicEffectExcluded: backup.academicEffectExcluded,
        academicEffectExclusionReason: backup.academicEffectExclusionReason,
        academicEffectExclusionSource: backup.academicEffectExclusionSource,
        smartNoteId: backup.smartNoteId,
        ...(backup.gradeCreatedAt ? { createdAt: backup.gradeCreatedAt } : {}),
      },
    });
    restored += 1;
  }

  await client.$executeRaw`DELETE FROM "StudentLeaveGradeBackup" WHERE "leaveId" = ${leave.id}`;
  return restored;
}

/**
 * Retires legacy pending LEAVE_PENDING smart notes for the exams a leave
 * covered, so no stale "pending grade because of leave" alert survives after
 * the leave itself is gone.
 */
export async function rejectPendingLeaveNotesForExams(
  client: Prisma.TransactionClient,
  studentId: string,
  examIds: string[],
  resolution: string,
): Promise<number> {
  if (!examIds.length) return 0;
  const rejected = await client.gradeSmartNote.updateMany({
    where: {
      studentId,
      category: "LEAVE_PENDING",
      status: "PENDING",
      examId: { in: examIds },
    },
    data: {
      status: "REJECTED",
      resolution,
      resolvedAt: new Date(),
    },
  });
  return rejected.count;
}

export type LeaveOverrideResult = {
  endedLeaves: number;
  restoredGrades: number;
  retiredPendingNotes: number;
  endedLeaveReasons: string[];
};

/**
 * Ends every leave covering this exam for the student and restores the
 * pre-leave grade state, mirroring the official leave-deletion semantics.
 * Legacy pending LEAVE_PENDING notes for the covered exams are retired too.
 * Runs inside the caller's transaction; the caller writes the typed grade
 * afterwards so it overrides whatever was restored for this exam.
 */
export async function endLeavesCoveringExamForGrade(
  client: Prisma.TransactionClient,
  studentId: string,
  exam: { id: string; date: Date },
): Promise<LeaveOverrideResult> {
  const leaves = await findLeavesCoveringExam(client, studentId, exam);
  let restoredGrades = 0;
  let retiredPendingNotes = 0;
  const endedLeaveReasons: string[] = [];
  for (const leave of leaves) {
    const examIds = await affectedExamIdsForLeave(client, leave);
    restoredGrades += await restoreLeaveBackups(client, leave, examIds);
    retiredPendingNotes += await rejectPendingLeaveNotesForExams(
      client,
      studentId,
      examIds,
      "أُلغي التعليق لأن إدخال درجة رسمية أنهى إجازة الطالب واعتُمد الدرجة محتسبة في سجله.",
    );
    await client.studentLeave.delete({ where: { id: leave.id } });
    endedLeaveReasons.push(leave.reason);
  }
  return {
    endedLeaves: leaves.length,
    restoredGrades,
    retiredPendingNotes,
    endedLeaveReasons,
  };
}
