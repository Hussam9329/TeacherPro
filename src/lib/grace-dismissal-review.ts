import {
  getActiveChapterForStudent,
  isAutomaticOpportunityLog,
  recalculateAcademicState,
} from "./academic-engine";
import { examChapterExclusion } from "./exam-chapter-scope";
import { isExamInStudentGracePeriod } from "./grace-periods";
import { historicalLeaveLogIds } from "./leave-dismissal-review";
import type { AcademicStateInput } from "./academic-types";

/** The student whose grace periods were just changed from the management screen. */
export type GraceDismissalReview = { studentId: string };

/**
 * Ordinary recalculation never reactivates a dismissed student. Only an
 * explicit grace-period change may reconsider one: when the exam behind the
 * current automatic dismissal is now inside a grace period, the student is
 * replayed as active and keeps the computed balance (no grant, no reset).
 * A later manual dismissal always wins over the old automatic evidence.
 */
export function recalculateWithGraceReview(
  state: AcademicStateInput,
  targetIds: Set<string>,
  review?: GraceDismissalReview,
) {
  const ordinary = recalculateAcademicState(state, targetIds);
  if (!review || !targetIds.has(review.studentId)) return ordinary;
  const historicalIds = historicalLeaveLogIds(state, targetIds);
  const preserveHistory = (result: typeof ordinary) => ({
    ...result,
    opportunityLogs: [
      ...result.opportunityLogs.filter((log) => !historicalIds.has(log.id)),
      ...state.opportunityLogs.filter((log) => historicalIds.has(log.id)),
    ],
  });
  const unchanged = preserveHistory(ordinary);
  const student = state.students.find((item) => item.id === review.studentId);
  if (!student || student.status !== "مفصول") return unchanged;
  const chapter = getActiveChapterForStudent(student, state.courseChapters, state.chapters);
  if (!chapter) return unchanged;
  const exams = new Map(state.exams.map((exam) => [exam.id, exam]));
  const logs = state.opportunityLogs.filter((log) => log.studentId === student.id);
  const currentAutomatic = logs.filter((log) => {
    const exam = exams.get(log.examId);
    return isAutomaticOpportunityLog(log) && log.chapterId === chapter.id &&
      exam?.examCourses && !examChapterExclusion(exam, student.courseId, chapter.id);
  });
  const evidence = currentAutomatic.find((log) => log.action === "فصل تلقائي" &&
    log.reason.replace(/^تلقائي:\s*/, "").trim() === student.dismissalReason.trim());
  if (!evidence) return unchanged;
  if (logs.some((log) => !isAutomaticOpportunityLog(log) && log.reason.startsWith("فصل الطالب") && log.date >= evidence.date) ||
      state.studentNotes.some((note) => note.studentId === student.id && note.kind === "إجراء" &&
        note.text.startsWith("فصل الطالب") && note.date >= evidence.date)) return unchanged;
  const removedCause = currentAutomatic.some((log) => {
    const exam = exams.get(log.examId);
    return exam && log.date <= evidence.date &&
      (log.action === "خصم تلقائي" || log.action === "فصل تلقائي") &&
      isExamInStudentGracePeriod(student, exam);
  });
  if (!removedCause) return unchanged;
  const projected = recalculateAcademicState({
    ...state,
    students: state.students.map((item) =>
      item.id === student.id ? { ...item, status: "نشط", dismissalReason: "" } : item),
  }, targetIds);
  const result = projected.students.find((item) => item.id === student.id);
  if (result?.status !== "نشط" || projected.opportunityLogs.some((log) =>
    log.studentId === student.id && log.chapterId === chapter.id && log.action === "فصل تلقائي")) return unchanged;
  return preserveHistory(projected);
}
