import type { Prisma } from "@prisma/client";
import { attachGracePeriods } from "@/lib/grace-periods-server";
import { attachStudentOpportunitySnapshotsWithClient } from "@/lib/student-opportunity-snapshot-server";
import { loadActiveChapterReportContext } from "@/lib/active-chapter-report";
import { RETIRED_FOLLOWUP_NOTE_KIND } from "@/lib/retired-followup-compat";
import {
  buildAcademicOpportunityCommandEffects,
  buildAcademicStateFromRows,
} from "@/lib/academic-recalculate-server";
import {
  STUDENT_PROFILE_STUDENT_SELECT,
  studentProfileSectionAccess,
  studentProfileStudentForAccess,
} from "@/lib/student-profile-server";

/** The rows «ملف الطالب» and its HTML report read; one shape for both. */
export const PROFILE_GRADE_SELECT = {
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

export const PROFILE_OPPORTUNITY_LOG_SELECT = {
  id: true,
  action: true,
  amount: true,
  requestedAmount: true,
  appliedAmount: true,
  balanceBefore: true,
  balanceAfter: true,
  reversalOfLogId: true,
  ledgerVersion: true,
  settledGradeIds: true,
  reason: true,
  date: true,
  chapterId: true,
  chapterNameSnapshot: true,
  studentId: true,
  examId: true,
} as const;

export const PROFILE_LEAVE_SELECT = {
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

export const PROFILE_NOTE_SELECT = {
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

export const PROFILE_EXAM_SELECT = {
  examCourses: { select: { courseId: true, chapterId: true } },
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
  telegramOpenAt: true,
  telegramCloseAt: true,
} as const;

/** A score typed while it could not count waits as a pending smart note. */
export const PROFILE_PENDING_GRADE_SELECT = {
  id: true,
  examId: true,
  score: true,
  category: true,
  attemptedAt: true,
  studentId: true,
} as const;

/** The most students one report request may ask for. */
export const STUDENT_REPORT_DETAILS_MAX_IDS = 100;

type SectionAccess = ReturnType<typeof studentProfileSectionAccess>;

type ReportExam = Prisma.ExamGetPayload<{ select: typeof PROFILE_EXAM_SELECT }>;
type ReportNote = Prisma.StudentNoteGetPayload<{ select: typeof PROFILE_NOTE_SELECT }>;
type ReportLeave = Prisma.StudentLeaveGetPayload<{ select: typeof PROFILE_LEAVE_SELECT }>;
type ReportPendingGrade = Prisma.GradeSmartNoteGetPayload<{ select: typeof PROFILE_PENDING_GRADE_SELECT }>;

/**
 * What a report needs to compute a correct result, whatever sections the
 * exporter may read: the status, the registration day, the days of each leave
 * and the recorded dismissals. Only facts used for the calculation — no leave
 * reason, note, phone or call.
 */
export function buildStudentReportContext(
  student: { status: unknown; createdAt: unknown },
  studentLeaves: ReportLeave[],
  studentNotes: ReportNote[],
  pendingGradeNotes: Array<Pick<ReportPendingGrade, "examId" | "score" | "category">>,
  access: SectionAccess,
) {
  if (!access.grades && !access.opportunities) return null;
  return {
    status: student.status,
    registeredAt: student.createdAt,
    leaves: studentLeaves.map((leave) => ({
      examId: leave.examId,
      leaveType: leave.leaveType,
      date: leave.date,
      dateFrom: leave.dateFrom,
      dateTo: leave.dateTo,
    })),
    dismissals: studentNotes
      .filter((note) => note.kind === "إجراء" && /^(?:تم )?فصل الطالب/u.test(String(note.text || "")))
      .map((note) => ({
        date: note.dismissalDate || note.date,
        reason: String(note.dismissalReason || "").trim(),
      })),
    pendingGrades: access.grades
      ? pendingGradeNotes.map((note) => ({ examId: note.examId, score: note.score, category: note.category }))
      : [],
  };
}

function groupByStudent<T extends { studentId: string }>(rows: T[]): Map<string, T[]> {
  const byStudent = new Map<string, T[]>();
  for (const row of rows) {
    const list = byStudent.get(row.studentId);
    if (list) list.push(row);
    else byStudent.set(row.studentId, [row]);
  }
  return byStudent;
}

/**
 * The HTML report's part of «ملف الطالب» for many students at once: the same
 * fields and values /api/students/profile-log returns for each of them, read
 * with one query per table instead of one request per student. Calls, notes
 * text, audit logs and archives are not part of a report and are not read.
 */
export async function loadStudentReportDetails(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  access: SectionAccess,
) {
  const storedStudents = await tx.student.findMany({
    where: { id: { in: studentIds } },
    select: STUDENT_PROFILE_STUDENT_SELECT,
  });
  if (storedStudents.length === 0) return {};
  const ids = storedStudents.map((student) => student.id);
  const students = await attachGracePeriods(tx, storedStudents);

  const [grades, opportunityLogs, studentLeaves, callExams, studentNotes, pendingGradeNotes] = await Promise.all([
    tx.grade.findMany({
      where: { studentId: { in: ids } },
      select: PROFILE_GRADE_SELECT,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    }),
    tx.opportunityLog.findMany({
      where: { studentId: { in: ids } },
      select: PROFILE_OPPORTUNITY_LOG_SELECT,
      orderBy: [{ date: "desc" }, { id: "desc" }],
    }),
    tx.studentLeave.findMany({
      where: { studentId: { in: ids } },
      select: PROFILE_LEAVE_SELECT,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    }),
    // Only which exams the calls are about: the profile lists those exams.
    access.followUp
      ? tx.studentCall.findMany({
          where: { studentId: { in: ids }, examId: { not: null } },
          select: { studentId: true, examId: true },
          distinct: ["studentId", "examId"],
        })
      : Promise.resolve([] as Array<{ studentId: string; examId: string | null }>),
    tx.studentNote.findMany({
      where: { studentId: { in: ids }, kind: { not: RETIRED_FOLLOWUP_NOTE_KIND } },
      select: PROFILE_NOTE_SELECT,
      orderBy: [{ date: "desc" }, { id: "desc" }],
    }),
    tx.gradeSmartNote.findMany({
      where: { studentId: { in: ids }, status: "PENDING", score: { not: null } },
      select: PROFILE_PENDING_GRADE_SELECT,
      orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
    }),
  ]);

  const examIds = Array.from(
    new Set(
      [...grades, ...opportunityLogs, ...studentLeaves, ...callExams, ...pendingGradeNotes]
        .map((row) => String(row.examId || "").trim())
        .filter(Boolean),
    ),
  );
  const exams = examIds.length
    ? await tx.exam.findMany({
        where: { id: { in: examIds } },
        select: PROFILE_EXAM_SELECT,
        orderBy: [{ date: "desc" }, { id: "desc" }],
      })
    : [];
  // Each course once: its active exams and its active chapter.
  const courseIds = Array.from(new Set(students.map((student) => student.courseId).filter(Boolean)));
  const courseEntries = await Promise.all(
    courseIds.map(async (courseId) => {
      const [allCourseExams, currentChapter] = await Promise.all([
        tx.exam.findMany({
          where: { courseIds: { contains: `"${courseId}"` }, active: true },
          select: PROFILE_EXAM_SELECT,
          orderBy: [{ date: "desc" }, { id: "desc" }],
        }),
        loadActiveChapterReportContext(tx, courseId),
      ]);
      return [courseId, { allCourseExams, currentChapter }] as const;
    }),
  );
  const byCourse = new Map(courseEntries);
  const withOpportunity = await attachStudentOpportunitySnapshotsWithClient(tx, students);

  const gradesBy = groupByStudent(grades);
  const logsBy = groupByStudent(opportunityLogs);
  const leavesBy = groupByStudent(studentLeaves);
  const callsBy = groupByStudent(callExams);
  const notesBy = groupByStudent(studentNotes);
  const pendingBy = groupByStudent(pendingGradeNotes);
  const generatedAt = new Date().toISOString();

  const result: Record<string, unknown> = {};
  students.forEach((student, index) => {
    const studentWithOpportunity = withOpportunity[index];
    const studentGrades = gradesBy.get(student.id) || [];
    const studentLogs = logsBy.get(student.id) || [];
    const leaves = leavesBy.get(student.id) || [];
    const notes = notesBy.get(student.id) || [];
    const pending = pendingBy.get(student.id) || [];
    const course = student.courseId ? byCourse.get(student.courseId) : undefined;
    const allCourseExams: ReportExam[] = course?.allCourseExams || [];
    const currentChapter = course?.currentChapter || null;

    const ownExamIds = new Set(
      [...studentGrades, ...studentLogs, ...leaves, ...(callsBy.get(student.id) || []), ...pending]
        .map((row) => String(row.examId || "").trim())
        .filter(Boolean),
    );
    const ownExams = exams.filter((exam) => ownExamIds.has(exam.id));

    const activeChapter = studentWithOpportunity.activeChapter;
    const opportunityCommandEffects = access.grades && access.opportunities && activeChapter && currentChapter?.id === activeChapter.id
      ? buildAcademicOpportunityCommandEffects(buildAcademicStateFromRows({
          students: [student],
          grades: studentGrades,
          exams: Array.from(new Map([...ownExams, ...allCourseExams].map((exam) => [exam.id, exam])).values()),
          courseChapters: [{
            id: `profile-active-${student.courseId}-${activeChapter.id}`,
            courseId: student.courseId,
            chapterId: activeChapter.id,
            active: true,
            archived: false,
          }],
          chapters: [activeChapter],
          opportunityLogs: studentLogs,
          studentLeaves: leaves,
          studentNotes: notes,
        }), student.id)
      : [];

    const visibleExamIds = new Set<string>();
    if (access.grades) {
      studentGrades.forEach((grade) => visibleExamIds.add(grade.examId));
      pending.forEach((note) => visibleExamIds.add(note.examId));
    }
    if (access.opportunities) studentLogs.forEach((log) => { if (log.examId) visibleExamIds.add(log.examId); });
    if (access.followUp) {
      leaves.forEach((leave) => { if (leave.examId) visibleExamIds.add(leave.examId); });
      (callsBy.get(student.id) || []).forEach((call) => { if (call.examId) visibleExamIds.add(call.examId); });
    }

    result[student.id] = {
      studentId: student.id,
      student: studentProfileStudentForAccess(
        {
          ...studentWithOpportunity,
          hasActiveChapter: Boolean(studentWithOpportunity.activeChapter),
        } as unknown as Record<string, unknown>,
        access,
      ),
      currentChapter,
      grades: access.grades ? studentGrades : [],
      exams: ownExams.filter((exam) => visibleExamIds.has(exam.id)),
      allCourseExams: access.grades ? allCourseExams : [],
      opportunityLogs: access.opportunities ? studentLogs : [],
      opportunityCommandEffects: access.grades && access.opportunities ? opportunityCommandEffects : [],
      studentLeaves: access.followUp ? leaves : [],
      reportContext: buildStudentReportContext(student, leaves, notes, pending, access),
      generatedAt,
    };
  });
  return result;
}
