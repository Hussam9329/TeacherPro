import { NextResponse } from "next/server";

export interface ExamDeleteImpact {
  gradeCount: number;
  opportunityLogCount: number;
  studentLeaveCount: number;
  studentCallCount: number;
  gradeSmartNoteCount: number;
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
    impact.opportunityLogCount +
    impact.studentLeaveCount +
    impact.studentCallCount +
    impact.gradeSmartNoteCount +
    impact.leaveGradeBackupCount
  );
}

export function riskyBulkOpportunityTargetCount(count: number): boolean {
  return Number(count || 0) >= 25;
}
