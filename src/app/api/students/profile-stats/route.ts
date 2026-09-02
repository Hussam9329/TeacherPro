export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireAnyPermissionPrincipal } from "@/lib/server-auth";
import { attachStudentOpportunitySnapshotsWithClient } from "@/lib/student-opportunity-snapshot-server";
import { classifyGradeAcademicImpact } from "@/lib/grade-classification";
import { RETIRED_FOLLOWUP_NOTE_KIND } from "@/lib/retired-followup-compat";
import {
  buildStudentProfileDataVersion,
  loadStudentProfileAuditLogs,
  STUDENT_PROFILE_ACCESS_PERMISSIONS,
  STUDENT_PROFILE_STUDENT_SELECT,
  studentProfileSectionAccess,
  studentProfileStudentForAccess,
  summarizeStudentProfileActivity,
} from "@/lib/student-profile-server";

const GRADE_SELECT = {
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
  exam: {
    select: {
      id: true,
      name: true,
      type: true,
      date: true,
      fullMark: true,
      passMark: true,
      discountMark: true,
      opportunitiesPenalty: true,
      dismissalGrade: true,
      noDiscount: true,
      active: true,
      scheduledActivateAt: true,
    },
  },
} as const;

const OPPORTUNITY_LOG_SELECT = {
  id: true,
  studentId: true,
  examId: true,
  action: true,
  amount: true,
  reason: true,
  date: true,
  chapterId: true,
  chapterNameSnapshot: true,
} as const;

const LEAVE_SELECT = {
  id: true,
  studentId: true,
  examId: true,
  leaveType: true,
  reason: true,
  studyType: true,
  date: true,
  dateFrom: true,
  dateTo: true,
  notes: true,
  createdAt: true,
} as const;

const CALL_SELECT = {
  id: true,
  studentId: true,
  examId: true,
  category: true,
  target: true,
  phone: true,
  status: true,
  completed: true,
  completedAt: true,
  notes: true,
  createdAt: true,
} as const;

const NOTE_SELECT = {
  id: true,
  studentId: true,
  kind: true,
  text: true,
  date: true,
  sourceType: true,
  sourceId: true,
  dismissalKey: true,
  dismissalReason: true,
  dismissalDate: true,
} as const;

/**
 * إحصائيات ملف الطالب من لقطة قراءة واحدة. التصنيف هنا يستعمل نفس المصنف
 * المستخدم في سجل الدرجات، بما في ذلك الإجازات والسماح وقبل التسجيل.
 */
export async function GET(req: NextRequest) {
  const principalOrError = await requireAnyPermissionPrincipal(
    req,
    [...STUDENT_PROFILE_ACCESS_PERMISSIONS],
  );
  if (principalOrError instanceof NextResponse) return principalOrError;
  const access = studentProfileSectionAccess(principalOrError);

  try {
    const { searchParams } = new URL(req.url);
    const studentId = String(searchParams.get("studentId") || "").trim();
    if (!studentId) return validationError("studentId مطلوب");

    const snapshot = await db.$transaction(
      async (tx) => {
        const student = await tx.student.findUnique({
          where: { id: studentId },
          select: STUDENT_PROFILE_STUDENT_SELECT,
        });
        if (!student) return null;

        const enrollmentArchives = await tx.studentEnrollmentArchive.findMany({
          where: { studentId },
          select: {
            id: true,
            fromCourseId: true,
            toCourseId: true,
            resetKind: true,
            reason: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        const currentEnrollmentStartedAt = enrollmentArchives[0]?.createdAt || null;

        const [grades, opportunityLogs, studentLeaves, studentCalls, studentNotes] =
          await Promise.all([
            tx.grade.findMany({ where: { studentId }, select: GRADE_SELECT }),
            tx.opportunityLog.findMany({
              where: { studentId },
              select: OPPORTUNITY_LOG_SELECT,
              orderBy: [{ date: "desc" }, { id: "desc" }],
            }),
            tx.studentLeave.findMany({ where: { studentId }, select: LEAVE_SELECT }),
            tx.studentCall.findMany({ where: { studentId }, select: CALL_SELECT }),
            tx.studentNote.findMany({
              where: {
                studentId,
                kind: { not: RETIRED_FOLLOWUP_NOTE_KIND },
              },
              select: NOTE_SELECT,
            }),
          ]);

        const [studentWithOpportunity] =
          await attachStudentOpportunitySnapshotsWithClient(tx, [student]);
        const auditResult = access.logs
          ? await loadStudentProfileAuditLogs(tx, student, {
              from: currentEnrollmentStartedAt,
            })
          : {
              logs: [],
              metadata: {
                limit: 0,
                returned: 0,
                truncated: false,
                matchSource: "redacted" as const,
              },
            };

        return {
          student,
          studentWithOpportunity,
          grades,
          opportunityLogs,
          studentLeaves,
          studentCalls,
          studentNotes,
          enrollmentArchives,
          auditResult,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );

    if (!snapshot) return validationError("الطالب غير موجود", 404);

    const {
      student,
      studentWithOpportunity,
      grades,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      enrollmentArchives,
      auditResult,
    } = snapshot;

    const classifiedGrades = grades.map((grade) => ({
      grade,
      kind: classifyGradeAcademicImpact(grade, grade.exam, {
        student,
        leaves: studentLeaves,
      }),
    }));
    const countKinds = (...kinds: string[]) =>
      classifiedGrades.filter((entry) => kinds.includes(entry.kind)).length;

    const gradeStats = access.grades
      ? {
          grades: grades.length,
          exams: new Set(grades.map((grade) => grade.examId)).size,
          absent: countKinds("absent-deducted", "absent-dismissal"),
          success: countKinds("passed", "full-mark"),
          failed: classifiedGrades.filter(({ grade, kind }) =>
            grade.status === "درجة" &&
            grade.score !== null &&
            grade.score !== undefined &&
            ["failed", "academic-accounting", "no-discount-protected"].includes(kind),
          ).length,
          graceGrades: countKinds("grace-period"),
          beforeRegistrationGrades: countKinds("before-registration"),
          excusedGrades: countKinds("excused"),
          cheatingGrades: countKinds("cheating"),
          noDiscountGrades: classifiedGrades.filter(
            ({ grade, kind }) =>
              grade.exam.noDiscount &&
              (kind === "no-discount-protected" ||
                kind === "passed" ||
                kind === "full-mark"),
          ).length,
        }
      : {
          grades: 0,
          exams: 0,
          absent: 0,
          success: 0,
          failed: 0,
          graceGrades: 0,
          beforeRegistrationGrades: 0,
          excusedGrades: 0,
          cheatingGrades: 0,
          noDiscountGrades: 0,
        };

    const visibleOpportunityLogs = access.opportunities ? opportunityLogs : [];
    const visibleNotes = access.followUp ? studentNotes : [];
    const callsCount = access.followUp ? studentCalls.length : 0;
    const leavesCount = access.followUp ? studentLeaves.length : 0;
    const notesCount = visibleNotes.filter(
      (note) => note.kind !== "إجراء",
    ).length;
    const activityStats = summarizeStudentProfileActivity({
      gradeCount: gradeStats.grades,
      opportunityLogs: visibleOpportunityLogs,
      studentNotes: visibleNotes,
      callsCount,
      leavesCount,
      auditCount: auditResult.logs.length,
    });
    const generatedAt = new Date().toISOString();
    const snapshotVersion = buildStudentProfileDataVersion({
      student: student as unknown as Record<string, unknown>,
      opportunitySnapshot:
        studentWithOpportunity as unknown as Record<string, unknown>,
      grades: grades as unknown as Array<Record<string, unknown>>,
      opportunityLogs:
        opportunityLogs as unknown as Array<Record<string, unknown>>,
      studentLeaves:
        studentLeaves as unknown as Array<Record<string, unknown>>,
      studentCalls: studentCalls as unknown as Array<Record<string, unknown>>,
      studentNotes: studentNotes as unknown as Array<Record<string, unknown>>,
      enrollmentArchives:
        enrollmentArchives as unknown as Array<Record<string, unknown>>,
      auditLogs: auditResult.logs as unknown as Array<Record<string, unknown>>,
    });
    const freshStudent = {
      ...studentWithOpportunity,
      hasActiveChapter: Boolean(studentWithOpportunity.activeChapter),
    };

    return NextResponse.json({
      studentId,
      student: studentProfileStudentForAccess(
        freshStudent as unknown as Record<string, unknown>,
        access,
      ),
      ...gradeStats,
      absences: gradeStats.absent,
      opportunities: studentWithOpportunity.opportunities,
      baseOpportunities: studentWithOpportunity.baseOpportunities,
      opportunityLimit: studentWithOpportunity.opportunityLimit,
      opportunitySource: studentWithOpportunity.opportunitySource,
      opportunityLimitSource: studentWithOpportunity.opportunityLimitSource,
      opportunityHealth: studentWithOpportunity.opportunityHealth,
      hasActiveChapter: Boolean(studentWithOpportunity.activeChapter),
      activeChapterConflictCount:
        studentWithOpportunity.activeChapterConflictCount,
      activeChapter: studentWithOpportunity.activeChapter,
      isOpportunityFull: studentWithOpportunity.isOpportunityFull,
      isOpportunityOverLimit: studentWithOpportunity.isOpportunityOverLimit,
      deductedMovements: activityStats.deductedMovements,
      deductions: activityStats.deductedMovements,
      addedMovements: activityStats.addedMovements,
      calls: callsCount,
      leaves: leavesCount,
      notes: notesCount,
      dismissals: activityStats.dismissals,
      reactivations: activityStats.reactivations,
      timeline: activityStats.timeline,
      timelineTruncated: auditResult.metadata.truncated,
      actions: activityStats.actions,
      audit: auditResult.metadata,
      sections: access,
      snapshotVersion,
      source: "database" as const,
      generatedAt,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات ملف الطالب من بيانات النظام.",
    );
  }
}
