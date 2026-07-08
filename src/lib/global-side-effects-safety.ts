import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type DbClient = typeof db | Prisma.TransactionClient;

export interface ExamDeleteImpact {
  gradeCount: number;
  correctionSheetCount: number;
  opportunityLogCount: number;
  studentLeaveCount: number;
  studentCallCount: number;
  telegramSubmissionCount: number;
  gradeEntryMissingNoteCount: number;
  leaveGradeBackupCount: number;
}

export interface ChapterDeleteImpact {
  activeCourseLinks: number;
  totalCourseLinks: number;
  opportunityLogCount: number;
  linkedCourseNames: string[];
  linkedStudents: number;
}

export const GLOBAL_SIDE_EFFECT_CONFIRM_PARAM = "confirmImpact";

export function isConfirmedImpact(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1 || value === "yes";
}

export function globalImpactConfirmationResponse(
  message: string,
  details: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      error: message,
      requiresConfirmation: true,
      confirmationParam: GLOBAL_SIDE_EFFECT_CONFIRM_PARAM,
      details,
    },
    { status: 409 },
  );
}

export function sumExamDeleteImpact(impact: ExamDeleteImpact): number {
  return (
    impact.gradeCount +
    impact.correctionSheetCount +
    impact.opportunityLogCount +
    impact.studentLeaveCount +
    impact.studentCallCount +
    impact.telegramSubmissionCount +
    impact.gradeEntryMissingNoteCount +
    impact.leaveGradeBackupCount
  );
}

export function nonGradeExamDeleteImpact(impact: ExamDeleteImpact): number {
  return sumExamDeleteImpact(impact) - impact.gradeCount;
}

export async function getExamDeleteImpact(
  client: DbClient,
  examId: string,
): Promise<ExamDeleteImpact> {
  const [
    gradeCount,
    correctionSheetCount,
    opportunityLogCount,
    studentLeaveCount,
    studentCallCount,
    telegramSubmissionCount,
    gradeEntryMissingNoteCount,
    leaveGradeBackupCount,
  ] = await Promise.all([
    client.grade.count({ where: { examId } }),
    client.correctionSheet.count({ where: { examId } }),
    client.opportunityLog.count({ where: { examId } }),
    client.studentLeave.count({ where: { examId } }),
    client.studentCall.count({ where: { examId } }),
    client.telegramExamSubmission.count({ where: { examId } }),
    client.gradeEntryMissingNote.count({ where: { examId } }),
    client.studentLeaveGradeBackup.count({ where: { examId } }),
  ]);

  return {
    gradeCount,
    correctionSheetCount,
    opportunityLogCount,
    studentLeaveCount,
    studentCallCount,
    telegramSubmissionCount,
    gradeEntryMissingNoteCount,
    leaveGradeBackupCount,
  };
}

export async function getChapterDeleteImpact(
  client: DbClient,
  chapterId: string,
): Promise<ChapterDeleteImpact> {
  const [courseLinks, opportunityLogCount] = await Promise.all([
    client.courseChapter.findMany({
      where: { chapterId },
      select: {
        active: true,
        courseId: true,
        course: { select: { name: true } },
      },
    }),
    client.opportunityLog.count({ where: { chapterId } }),
  ]);

  const courseIds = Array.from(new Set(courseLinks.map((link) => link.courseId)));
  const linkedStudents = courseIds.length
    ? await client.student.count({ where: { courseId: { in: courseIds } } })
    : 0;

  return {
    activeCourseLinks: courseLinks.filter((link) => link.active).length,
    totalCourseLinks: courseLinks.length,
    opportunityLogCount,
    linkedCourseNames: Array.from(
      new Set(courseLinks.map((link) => link.course?.name || link.courseId)),
    ),
    linkedStudents,
  };
}

export function chapterDeleteNeedsConfirmation(impact: ChapterDeleteImpact): boolean {
  return impact.totalCourseLinks > 0 || impact.opportunityLogCount > 0;
}

export function riskyBulkOpportunityTargetCount(count: number): boolean {
  return Number(count || 0) >= 25;
}
