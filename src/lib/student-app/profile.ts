/**
 * Database-bound builders for the student app (profile and opportunities).
 * Kept apart from read-models.ts so the pure rules stay importable in tests.
 */
import { loadActiveChapterReportContext, opportunityLogWithinActiveChapter } from "@/lib/active-chapter-report";
import { db } from "@/lib/db";
import { CONTACT_LINKS, isDismissedStatus } from "./read-models.ts";

export type StudentRecord = {
  id: string;
  name: string;
  phone: string | null;
  parentPhone: string | null;
  code: string;
  status: string;
  dismissalReason: string | null;
  courseId: string;
  studyType: string | null;
  mainSite: string | null;
  subSite: string | null;
  opportunities: number;
};

export type StudentProfile = {
  id: string;
  name: string;
  phone: string | null;
  parentPhone: string | null;
  code: string;
  status: string;
  isDismissed: boolean;
  dismissalReason: string | null;
  courseName: string | null;
  chapterName: string | null;
  studyType: string | null;
  mainSite: string | null;
  subSite: string | null;
  opportunities: number;
  contact: typeof CONTACT_LINKS;
};

export async function buildProfile(student: StudentRecord): Promise<StudentProfile> {
  const [course, chapter] = await Promise.all([
    db.course.findUnique({ where: { id: student.courseId }, select: { name: true } }),
    loadActiveChapterReportContext(db, student.courseId),
  ]);
  return {
    id: student.id,
    name: student.name,
    phone: student.phone,
    parentPhone: student.parentPhone,
    code: student.code,
    status: student.status,
    isDismissed: isDismissedStatus(student.status),
    dismissalReason: student.dismissalReason,
    courseName: course?.name ?? null,
    chapterName: chapter?.name ?? null,
    studyType: student.studyType,
    mainSite: student.mainSite,
    subSite: student.subSite,
    opportunities: student.opportunities,
    contact: CONTACT_LINKS,
  };
}

/** Same shape and filter as `/api/bot/opportunities`. */
export async function buildOpportunities(student: { id: string; courseId: string; opportunities: number }) {
  const chapter = await loadActiveChapterReportContext(db, student.courseId);
  const allLogs = await db.opportunityLog.findMany({ where: { studentId: student.id }, orderBy: { date: "desc" } });
  const logs = allLogs
    .filter((log) => (!log.chapterId || !chapter || log.chapterId === chapter.id) && opportunityLogWithinActiveChapter(log, chapter))
    .slice(0, 15);
  return {
    opportunities: student.opportunities,
    activeChapter: chapter ? { id: chapter.id, name: chapter.name, since: chapter.since } : null,
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      amount: log.appliedAmount ?? log.amount,
      balanceBefore: log.balanceBefore,
      balanceAfter: log.balanceAfter,
      reason: log.reason,
      date: log.date,
      chapterId: log.chapterId,
      examId: log.examId,
    })),
  };
}
