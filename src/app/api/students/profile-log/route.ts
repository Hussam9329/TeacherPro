export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireAnyPermissionPrincipal } from "@/lib/server-auth";
import { attachStudentOpportunitySnapshotsWithClient } from "@/lib/student-opportunity-snapshot-server";
import { parseStudentEnrollmentArchiveSnapshot } from "@/lib/student-enrollment-archive-server";
import {
  buildStudentProfileDataVersion,
  loadStudentProfileAuditLogs,
  sanitizeEnrollmentArchiveSnapshot,
  STUDENT_PROFILE_ACCESS_PERMISSIONS,
  STUDENT_PROFILE_STUDENT_SELECT,
  studentProfileSectionAccess,
  studentProfileStudentForAccess,
} from "@/lib/student-profile-server";

const GRADE_SELECT = {
  id: true,
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
  studentId: true,
  examId: true,
} as const;

const OPPORTUNITY_LOG_SELECT = {
  id: true,
  action: true,
  amount: true,
  reason: true,
  date: true,
  chapterId: true,
  chapterNameSnapshot: true,
  studentId: true,
  examId: true,
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

const EXAM_SELECT = {
  id: true,
  name: true,
  type: true,
  courseIds: true,
  mainSite: true,
  date: true,
  fullMark: true,
  passMark: true,
  discountMark: true,
  opportunitiesPenalty: true,
  dismissalGrade: true,
  noDiscount: true,
  active: true,
  scheduledActivateAt: true,
} as const;

/**
 * يعيد بيانات ملف الطالب من لقطة قراءة واحدة. البيانات الحساسة تُحجب بحسب
 * صلاحية كل قسم، ولا تعتمد مطابقة سجل التدقيق على الاسم أو أرقام الهاتف.
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
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        const currentEnrollmentStartedAt = enrollmentArchives[0]?.createdAt || null;

        const [grades, opportunityLogs, studentLeaves, studentCalls, studentNotes] =
          await Promise.all([
            tx.grade.findMany({
              where: { studentId },
              select: GRADE_SELECT,
              orderBy: [
                { updatedAt: "desc" },
                { createdAt: "desc" },
                { id: "desc" },
              ],
            }),
            tx.opportunityLog.findMany({
              where: { studentId },
              select: OPPORTUNITY_LOG_SELECT,
              orderBy: [{ date: "desc" }, { id: "desc" }],
            }),
            tx.studentLeave.findMany({
              where: { studentId },
              select: LEAVE_SELECT,
              orderBy: [
                { date: "desc" },
                { createdAt: "desc" },
                { id: "desc" },
              ],
            }),
            tx.studentCall.findMany({
              where: { studentId },
              select: CALL_SELECT,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            }),
            tx.studentNote.findMany({
              where: { studentId },
              select: NOTE_SELECT,
              orderBy: [{ date: "desc" }, { id: "desc" }],
            }),
          ]);

        const examIds = Array.from(
          new Set(
            [
              ...grades.map((grade) => grade.examId),
              ...opportunityLogs.map((log) => log.examId),
              ...studentLeaves.map((leave) => leave.examId),
              ...studentCalls.map((call) => call.examId),
            ]
              .map((id) => String(id || "").trim())
              .filter(Boolean),
          ),
        );
        const exams = examIds.length
          ? await tx.exam.findMany({
              where: { id: { in: examIds } },
              select: EXAM_SELECT,
              orderBy: [{ date: "desc" }, { id: "desc" }],
            })
          : [];
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
          exams,
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
      exams,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      enrollmentArchives,
      auditResult,
    } = snapshot;
    const examById = new Map(exams.map((exam) => [exam.id, exam]));
    const gradesForVersion = grades.map((grade) => ({
      ...grade,
      exam: examById.get(grade.examId) || null,
    }));
    const snapshotVersion = buildStudentProfileDataVersion({
      student: student as unknown as Record<string, unknown>,
      opportunitySnapshot:
        studentWithOpportunity as unknown as Record<string, unknown>,
      grades: gradesForVersion as unknown as Array<Record<string, unknown>>,
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

    const visibleExamIds = new Set<string>();
    if (access.grades)
      grades.forEach((grade) => visibleExamIds.add(grade.examId));
    if (access.opportunities)
      opportunityLogs.forEach((log) => {
        if (log.examId) visibleExamIds.add(log.examId);
      });
    if (access.followUp) {
      studentLeaves.forEach((leave) => {
        if (leave.examId) visibleExamIds.add(leave.examId);
      });
      studentCalls.forEach((call) => {
        if (call.examId) visibleExamIds.add(call.examId);
      });
    }
    const generatedAt = new Date().toISOString();

    return NextResponse.json({
      studentId,
      student: studentProfileStudentForAccess(
        {
          ...studentWithOpportunity,
          hasActiveChapter: Boolean(studentWithOpportunity.activeChapter),
        } as unknown as Record<string, unknown>,
        access,
      ),
      grades: access.grades ? grades : [],
      exams: exams.filter((exam) => visibleExamIds.has(exam.id)),
      opportunityLogs: access.opportunities ? opportunityLogs : [],
      studentLeaves: access.followUp ? studentLeaves : [],
      studentCalls: access.followUp ? studentCalls : [],
      studentNotes: access.followUp ? studentNotes : [],
      logs: access.logs ? auditResult.logs : [],
      enrollmentArchives: access.archives
        ? enrollmentArchives.map((archive) => ({
            id: archive.id,
            studentId: archive.studentId,
            fromCourseId: archive.fromCourseId,
            fromCourseName: archive.fromCourseName,
            toCourseId: archive.toCourseId,
            toCourseName: archive.toCourseName,
            resetKind: archive.resetKind,
            reason: archive.reason,
            createdById: archive.createdById,
            createdByName: archive.createdByName,
            createdAt: archive.createdAt,
            snapshot: sanitizeEnrollmentArchiveSnapshot(
              parseStudentEnrollmentArchiveSnapshot(archive.snapshot),
              access,
            ),
          }))
        : [],
      audit: auditResult.metadata,
      sections: access,
      snapshotVersion,
      source: "database" as const,
      generatedAt,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل لوغ ملف الطالب من بيانات النظام.",
    );
  }
}
