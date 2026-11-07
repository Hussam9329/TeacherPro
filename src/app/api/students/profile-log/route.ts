export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { attachGracePeriods, listStudentGracePeriods } from "@/lib/grace-periods-server";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireAnyPermissionPrincipal } from "@/lib/server-auth";
import { attachStudentOpportunitySnapshotsWithClient } from "@/lib/student-opportunity-snapshot-server";
import { parseStudentEnrollmentArchiveSnapshot } from "@/lib/student-enrollment-archive-server";
import { loadActiveChapterReportContext } from "@/lib/active-chapter-report";
import { RETIRED_FOLLOWUP_NOTE_KIND } from "@/lib/retired-followup-compat";
import {
  buildAcademicOpportunityCommandEffects,
  buildAcademicStateFromRows,
} from "@/lib/academic-recalculate-server";
import {
  buildStudentProfileDataVersion,
  loadStudentProfileAuditLogs,
  loadStudentStoryAuditFacts,
  sanitizeEnrollmentArchiveSnapshot,
  STUDENT_PROFILE_ACCESS_PERMISSIONS,
  STUDENT_PROFILE_STUDENT_SELECT,
  studentProfileSectionAccess,
  studentProfileStudentForAccess,
} from "@/lib/student-profile-server";
import {
  buildStudentReportContext,
  PROFILE_EXAM_SELECT,
  PROFILE_GRADE_SELECT,
  PROFILE_LEAVE_SELECT,
  PROFILE_NOTE_SELECT,
  PROFILE_OPPORTUNITY_LOG_SELECT,
} from "@/lib/student-report-details-server";

// The same rows as the HTML report's batch read (/api/students/report-details).
const GRADE_SELECT = PROFILE_GRADE_SELECT;
const OPPORTUNITY_LOG_SELECT = PROFILE_OPPORTUNITY_LOG_SELECT;
const LEAVE_SELECT = PROFILE_LEAVE_SELECT;
const NOTE_SELECT = PROFILE_NOTE_SELECT;
const EXAM_SELECT = PROFILE_EXAM_SELECT;

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
  noteResolved: true,
  createdAt: true,
  actedAt: true,
  actedByName: true,
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
        const storedStudent = await tx.student.findUnique({
          where: { id: studentId },
          select: STUDENT_PROFILE_STUDENT_SELECT,
        });
        if (!storedStudent) return null;
        const [student] = await attachGracePeriods(tx, [storedStudent]);

        const enrollmentArchives = await tx.studentEnrollmentArchive.findMany({
          where: { studentId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        const currentEnrollmentStartedAt = enrollmentArchives[0]?.createdAt || null;

        const [grades, opportunityLogs, studentLeaves, studentCalls, studentNotes, pendingGradeNotes] =
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
              where: {
                studentId,
                kind: { not: RETIRED_FOLLOWUP_NOTE_KIND },
              },
              select: NOTE_SELECT,
              orderBy: [{ date: "desc" }, { id: "desc" }],
            }),
            // A score typed while it could not count (dismissed, on leave,
            // before registration) waits here, never as a Grade row.
            tx.gradeSmartNote.findMany({
              where: { studentId, status: "PENDING", score: { not: null } },
              select: { id: true, examId: true, score: true, category: true, attemptedAt: true },
              orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
            }),
          ]);

        const examIds = Array.from(
          new Set(
            [
              ...grades.map((grade) => grade.examId),
              ...opportunityLogs.map((log) => log.examId),
              ...studentLeaves.map((leave) => leave.examId),
              ...studentCalls.map((call) => call.examId),
              ...pendingGradeNotes.map((note) => note.examId),
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
        // جلب كل امتحانات الدورة لإظهارها في التقارير حتى لو لم يكن للطالب سجل درجات.
        const allCourseExams = student.courseId
          ? await tx.exam.findMany({
              where: { courseIds: { contains: `"${student.courseId}"` }, active: true },
              select: EXAM_SELECT,
              orderBy: [{ date: "desc" }, { id: "desc" }],
            })
          : [];
        // سياق الفصل النشط الحالي: يحدد امتحانات الدورة التي انصنعت بعد بداية
        // الفصل النشط (آخر انتقال للدورة)، ليعرض تقرير HTML درجات الفصل النشط
        // وحدها — نفس المصدر الذي تبنى عليه رسالة تليگرام في إدارة المفصولين.
        const currentChapter = student.courseId
          ? await loadActiveChapterReportContext(tx, student.courseId)
          : null;
        const [studentWithOpportunity] =
          await attachStudentOpportunitySnapshotsWithClient(tx, [student]);
        const activeChapter = studentWithOpportunity.activeChapter;
        // Reuse this transaction's already-loaded rows. No independent fetch
        // or accounting write may participate in a report explanation.
        const opportunityCommandEffects = access.grades && access.opportunities && activeChapter && currentChapter?.id === activeChapter.id
          ? buildAcademicOpportunityCommandEffects(buildAcademicStateFromRows({
              students: [student],
              grades,
              exams: Array.from(new Map([...exams, ...allCourseExams].map((exam) => [exam.id, exam])).values()),
              courseChapters: [{
                id: `profile-active-${student.courseId}-${activeChapter.id}`,
                courseId: student.courseId,
                chapterId: activeChapter.id,
                active: true,
                archived: false,
              }],
              chapters: [activeChapter],
              opportunityLogs,
              studentLeaves,
              studentNotes,
            }), studentId)
          : [];
        // The story reads who did each manual action for every viewer; the
        // raw audit rows below stay with those who may read the logs.
        const [storyAudit, gracePeriodRecords] = await Promise.all([
          loadStudentStoryAuditFacts(tx, student, { from: currentEnrollmentStartedAt }),
          listStudentGracePeriods(tx, studentId),
        ]);
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
          allCourseExams,
          currentChapter,
          opportunityLogs,
          opportunityCommandEffects,
          studentLeaves,
          studentCalls,
          studentNotes,
          pendingGradeNotes,
          enrollmentArchives,
          auditResult,
          storyAudit,
          gracePeriodRecords,
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
      allCourseExams,
      currentChapter,
      opportunityLogs,
      opportunityCommandEffects,
      studentLeaves,
      studentCalls,
      studentNotes,
      pendingGradeNotes,
      enrollmentArchives,
      auditResult,
      storyAudit,
      gracePeriodRecords,
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
    if (access.grades) {
      grades.forEach((grade) => visibleExamIds.add(grade.examId));
      pendingGradeNotes.forEach((note) => visibleExamIds.add(note.examId));
    }
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
      currentChapter,
      grades: access.grades ? grades : [],
      exams: exams.filter((exam) => visibleExamIds.has(exam.id)),
      allCourseExams: access.grades ? allCourseExams : [],
      opportunityLogs: access.opportunities ? opportunityLogs : [],
      opportunityCommandEffects: access.grades && access.opportunities ? opportunityCommandEffects : [],
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
      story: {
        audit: storyAudit,
        gracePeriods: gracePeriodRecords,
        pendingGrades: pendingGradeNotes,
      },
      // What the student report needs to compute a correct result, whatever
      // sections the exporter may read (one builder with the batch read).
      reportContext: buildStudentReportContext(student, studentLeaves, studentNotes, pendingGradeNotes, access),
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
