import { examChapterExclusion, type ExamChapterScope } from "./exam-chapter-scope";

/** A historical movement stays in the complete ledger, but must not appear
 * as a deduction from the student's currently active chapter. */
export function isCurrentChapterOpportunityLog(
  log: { chapterId?: string | null; examId?: string | null },
  student: { courseId?: string | null; activeChapter?: { id: string } | null; activeChapterConflictCount?: number | null },
  exam?: ExamChapterScope,
): boolean {
  const chapterId = student.activeChapter?.id;
  if (!chapterId || !student.courseId || (student.activeChapterConflictCount ?? 0) > 1) return false;
  if (log.chapterId !== chapterId) return false;
  if (!log.examId) return true;
  if (!exam?.examCourses) return false;
  return !examChapterExclusion(exam, student.courseId, chapterId);
}
