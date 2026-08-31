import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getExamEntryAvailability,
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

export type ExamEditProtectedGradeReconciliationResult = {
  convertedToExcused: number;
  restoredFromLeaveBackup: number;
  removedStaleMarkers: number;
  backedUpGrades: number;
};

/**
 * Reconciles only system-owned protected Grade rows after an exam definition
 * changes. Exam date/course/site edits can move an already stored exam into or
 * out of leave/grace/registration scope. Leaving the old placeholder behind
 * makes the database disagree with the current exam definition.
 *
 * Numeric/manual grades are never deleted here. If a changed exam now falls
 * inside a leave, the grade is backed up against that leave before the row is
 * converted to "مجاز", matching the normal leave-create workflow. If the exam
 * moves out of a leave, the original row is restored from its backup.
 */
export async function reconcileProtectedGradeMarkersForExamEdit(
  client: PrismaClientLike,
  examId: string,
  options: { studentIds?: string[] } = {},
): Promise<ExamEditProtectedGradeReconciliationResult> {
  const result: ExamEditProtectedGradeReconciliationResult = {
    convertedToExcused: 0,
    restoredFromLeaveBackup: 0,
    removedStaleMarkers: 0,
    backedUpGrades: 0,
  };
  const exam = await client.exam.findUnique({
    where: { id: examId },
    select: { id: true, courseIds: true, mainSite: true, date: true },
  });
  if (!exam) return result;

  const requestedStudentIds = Array.from(
    new Set((options.studentIds || []).map(String).filter(Boolean)),
  );
  const grades = await client.grade.findMany({
    where: {
      examId,
      ...(requestedStudentIds.length ? { studentId: { in: requestedStudentIds } } : {}),
    },
    select: {
      id: true,
      studentId: true,
      examId: true,
      status: true,
      score: true,
      notes: true,
      academicAccountingChecked: true,
      academicEffectExcluded: true,
      academicEffectExclusionReason: true,
      academicEffectExclusionSource: true,
      smartNoteId: true,
      createdAt: true,
      updatedAt: true,
      student: {
        select: {
          courseId: true,
          mainSite: true,
          subSite: true,
          locationScope: true,
          createdAt: true,
          accountingGraceDays: true,
          gracePeriodStartDate: true,
          gracePeriodEndedAt: true,
        },
      },
    },
  });
  if (!grades.length) return result;

  const studentIds = Array.from(new Set(grades.map((grade) => grade.studentId)));
  const [leaves, backups] = await Promise.all([
    client.studentLeave.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        id: true,
        studentId: true,
        examId: true,
        leaveType: true,
        date: true,
        dateFrom: true,
        dateTo: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.studentLeaveGradeBackup.findMany({
      where: { examId, studentId: { in: studentIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const leavesByStudent = new Map<string, typeof leaves>();
  for (const leave of leaves) {
    const rows = leavesByStudent.get(leave.studentId) || [];
    rows.push(leave);
    leavesByStudent.set(leave.studentId, rows);
  }
  const backupsByStudent = new Map<string, typeof backups>();
  for (const backup of backups) {
    const rows = backupsByStudent.get(backup.studentId) || [];
    rows.push(backup);
    backupsByStudent.set(backup.studentId, rows);
  }
  const courseIds = parseCourseIds(exam.courseIds);
  const selectedSites = splitSelection(String(exam.mainSite || ""));
  const protectedStatuses = new Set([
    "مجاز",
    "ضمن فترة السماح",
    "قبل تسجيل الطالب",
  ]);

  for (const grade of grades) {
    const eligible =
      courseIds.includes(grade.student.courseId) &&
      studentMatchesExamMainSites(grade.student, selectedSites);
    if (!eligible) {
      if (grade.status === "مجاز") {
        const backup = (backupsByStudent.get(grade.studentId) || [])[0];
        if (backup) {
          // The student left the exam scope (course/site), but a real grade may
          // have been hidden behind an exam leave. Restore that historical row
          // instead of deleting it; the academic engine/stats will ignore it
          // while the student remains outside the current exam scope.
          await client.grade.update({
            where: { id: grade.id },
            data: {
              status: backup.status,
              score: backup.status === "درجة" ? backup.score : null,
              notes: backup.notes,
              academicAccountingChecked: backup.academicAccountingChecked,
              academicEffectExcluded: backup.academicEffectExcluded,
              academicEffectExclusionReason: backup.academicEffectExclusionReason,
              academicEffectExclusionSource: backup.academicEffectExclusionSource,
              smartNoteId: backup.smartNoteId,
            },
          });
          result.restoredFromLeaveBackup += 1;
        } else {
          await client.grade.delete({ where: { id: grade.id } });
          result.removedStaleMarkers += 1;
        }
        await client.studentLeaveGradeBackup.deleteMany({
          where: { studentId: grade.studentId, examId },
        });
      } else if (protectedStatuses.has(grade.status)) {
        await client.grade.delete({ where: { id: grade.id } });
        result.removedStaleMarkers += 1;
      }
      continue;
    }

    const applicableLeaves = (leavesByStudent.get(grade.studentId) || []).filter(
      (leave) => studentLeaveAppliesToExam(leave, exam),
    );
    if (applicableLeaves.length > 0) {
      const applicableLeaveIds = new Set(applicableLeaves.map((leave) => leave.id));
      const studentBackups = backupsByStudent.get(grade.studentId) || [];
      const currentBackup = studentBackups.find((backup) =>
        applicableLeaveIds.has(backup.leaveId),
      );
      const historicalBackup = studentBackups[0];

      // When the exam date is moved from one period leave into another, keep
      // the original pre-leave grade backup attached to the leave that now
      // actually covers the exam. Otherwise deleting the old leave later can
      // restore a grade while the student is still excused by the new leave.
      if (grade.status === "مجاز" && !currentBackup && historicalBackup) {
        const leave = applicableLeaves[0];
        await client.studentLeaveGradeBackup.upsert({
          where: {
            leaveId_studentId_examId: {
              leaveId: leave.id,
              studentId: grade.studentId,
              examId,
            },
          },
          create: {
            leaveId: leave.id,
            studentId: grade.studentId,
            examId,
            status: historicalBackup.status,
            score: historicalBackup.score,
            notes: historicalBackup.notes,
            academicAccountingChecked: historicalBackup.academicAccountingChecked,
            academicEffectExcluded: historicalBackup.academicEffectExcluded,
            academicEffectExclusionReason: historicalBackup.academicEffectExclusionReason,
            academicEffectExclusionSource: historicalBackup.academicEffectExclusionSource,
            smartNoteId: historicalBackup.smartNoteId,
            gradeCreatedAt: historicalBackup.gradeCreatedAt,
            gradeUpdatedAt: historicalBackup.gradeUpdatedAt,
          },
          update: {},
        });
        await client.studentLeaveGradeBackup.deleteMany({
          where: {
            studentId: grade.studentId,
            examId,
            leaveId: { notIn: Array.from(applicableLeaveIds) },
          },
        });
      }
      if (grade.status !== "مجاز") {
        const leave = applicableLeaves[0];
        await client.studentLeaveGradeBackup.upsert({
          where: {
            leaveId_studentId_examId: {
              leaveId: leave.id,
              studentId: grade.studentId,
              examId,
            },
          },
          create: {
            leaveId: leave.id,
            studentId: grade.studentId,
            examId,
            status: grade.status,
            score: grade.score,
            notes: grade.notes,
            academicAccountingChecked: grade.academicAccountingChecked,
            academicEffectExcluded: grade.academicEffectExcluded,
            academicEffectExclusionReason: grade.academicEffectExclusionReason,
            academicEffectExclusionSource: grade.academicEffectExclusionSource,
            smartNoteId: grade.smartNoteId,
            gradeCreatedAt: grade.createdAt,
            gradeUpdatedAt: grade.updatedAt,
          },
          update: {},
        });
        result.backedUpGrades += 1;
        await client.grade.update({
          where: { id: grade.id },
          data: {
            status: "مجاز",
            score: null,
            notes: "تسجيل تلقائي: الطالب مجاز من هذا الامتحان",
            academicAccountingChecked: false,
          },
        });
        result.convertedToExcused += 1;
      }
      continue;
    }

    if (grade.status === "مجاز") {
      const backup = (backupsByStudent.get(grade.studentId) || [])[0];
      const backupIsProtectedPlaceholder =
        backup?.status === "قبل تسجيل الطالب" || backup?.status === "ضمن فترة السماح";
      const canRestoreAbsence =
        backup?.status !== "غائب" ||
        (isExamOnOrAfterStudentRegistration(grade.student, exam) &&
          !isExamWithinStudentGraceWindow(grade.student, exam));
      if (backup && !backupIsProtectedPlaceholder && canRestoreAbsence) {
        await client.grade.update({
          where: { id: grade.id },
          data: {
            status: backup.status,
            score: backup.status === "درجة" ? backup.score : null,
            notes: backup.notes,
            academicAccountingChecked: backup.academicAccountingChecked,
            academicEffectExcluded: backup.academicEffectExcluded,
            academicEffectExclusionReason: backup.academicEffectExclusionReason,
            academicEffectExclusionSource: backup.academicEffectExclusionSource,
            smartNoteId: backup.smartNoteId,
          },
        });
        result.restoredFromLeaveBackup += 1;
      } else {
        // Protected placeholders are derived state. Recreate the correct one
        // below via ensureProtectedGradeMarkers instead of reviving a stale
        // pre-registration/grace snapshot from before the exam date changed.
        await client.grade.delete({ where: { id: grade.id } });
        result.removedStaleMarkers += 1;
      }
      await client.studentLeaveGradeBackup.deleteMany({
        where: { studentId: grade.studentId, examId },
      });
      continue;
    }

    if (
      grade.status === "ضمن فترة السماح" &&
      !isExamWithinStudentGraceWindow(grade.student, exam)
    ) {
      await client.grade.delete({ where: { id: grade.id } });
      result.removedStaleMarkers += 1;
      continue;
    }
    if (
      grade.status === "قبل تسجيل الطالب" &&
      isExamOnOrAfterStudentRegistration(grade.student, exam)
    ) {
      await client.grade.delete({ where: { id: grade.id } });
      result.removedStaleMarkers += 1;
    }
  }

  return result;
}

export async function reconcileProtectedGradeMarkersForStudentAcademicEdit(
  client: PrismaClientLike,
  rawStudentIds: string[],
): Promise<ExamEditProtectedGradeReconciliationResult> {
  const studentIds = Array.from(
    new Set(rawStudentIds.map(String).map((value) => value.trim()).filter(Boolean)),
  );
  const aggregate: ExamEditProtectedGradeReconciliationResult = {
    convertedToExcused: 0,
    restoredFromLeaveBackup: 0,
    removedStaleMarkers: 0,
    backedUpGrades: 0,
  };
  if (!studentIds.length) return aggregate;

  const [gradeExamRows, backupExamRows] = await Promise.all([
    client.grade.findMany({
      where: { studentId: { in: studentIds } },
      distinct: ["examId"],
      select: { examId: true },
    }),
    client.studentLeaveGradeBackup.findMany({
      where: { studentId: { in: studentIds } },
      distinct: ["examId"],
      select: { examId: true },
    }),
  ]);
  const examIds = Array.from(
    new Set([...gradeExamRows, ...backupExamRows].map((row) => row.examId).filter(Boolean)),
  );

  for (const examId of examIds) {
    const result = await reconcileProtectedGradeMarkersForExamEdit(client, examId, {
      studentIds,
    });
    aggregate.convertedToExcused += result.convertedToExcused;
    aggregate.restoredFromLeaveBackup += result.restoredFromLeaveBackup;
    aggregate.removedStaleMarkers += result.removedStaleMarkers;
    aggregate.backedUpGrades += result.backedUpGrades;
  }
  return aggregate;
}

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
        gracePeriodEndedAt: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
      },
    }),
    client.exam.findMany({
      where: options.examIds ? { id: { in: requestedExamIds } } : undefined,
      select: { id: true, courseIds: true, mainSite: true, date: true, active: true, scheduledActivateAt: true },
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
      } else if (
        options.includeAbsent &&
        getExamEntryAvailability(exam).available &&
        baghdadDateKey(exam.date) < todayKey
      ) {
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
