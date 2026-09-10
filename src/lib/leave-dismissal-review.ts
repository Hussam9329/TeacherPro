import { getActiveChapterForStudent, isAutomaticOpportunityLog, recalculateAcademicState, studentLeaveAppliesToExam } from "./academic-engine";
import { examChapterExclusion } from "./exam-chapter-scope";
import type { AcademicStateInput } from "./academic-types";

export type LeaveDismissalReview = { studentId: string; examIds: string[] };

export function historicalLeaveLogIds(state: AcademicStateInput, targetIds: Set<string>): Set<string> {
  const chapterByStudent = new Map(state.students.map(s => [s.id,
    getActiveChapterForStudent(s, state.courseChapters, state.chapters)?.id]));
  return new Set(state.opportunityLogs.filter(l => targetIds.has(l.studentId) &&
    isAutomaticOpportunityLog(l) && l.chapterId !== chapterByStudent.get(l.studentId)).map(l => l.id));
}

/** Only an explicit leave mutation may reconsider a proved exam dismissal.
 * Ordinary recalculation keeps its existing dismissed-student policy. */
export function recalculateWithLeaveReview(
  state: AcademicStateInput,
  targetIds: Set<string>,
  review?: LeaveDismissalReview,
) {
  const ordinary = recalculateAcademicState(state, targetIds);
  if (!review || !targetIds.has(review.studentId)) return ordinary;
  const historicalIds = historicalLeaveLogIds(state, targetIds);
  const preserveHistory = (result: typeof ordinary) => ({ ...result,
    opportunityLogs: [...result.opportunityLogs.filter(l => !historicalIds.has(l.id)),
      ...state.opportunityLogs.filter(l => historicalIds.has(l.id))],
  });
  const unchanged = preserveHistory(ordinary);
  const student = state.students.find(s => s.id === review.studentId);
  if (!student || student.status !== "مفصول") return unchanged;
  const chapter = getActiveChapterForStudent(student, state.courseChapters, state.chapters);
  if (!chapter) return unchanged;
  const exams = new Map(state.exams.map(e => [e.id, e]));
  const logs = state.opportunityLogs.filter(l => l.studentId === student.id);
  const currentAutomatic = logs.filter(l => {
    const exam = exams.get(l.examId);
    return isAutomaticOpportunityLog(l) && l.chapterId === chapter.id &&
      exam?.examCourses && !examChapterExclusion(exam, student.courseId, chapter.id);
  });
  const evidence = currentAutomatic.find(l => l.action === "فصل تلقائي" &&
    l.reason.replace(/^تلقائي:\s*/, "").trim() === student.dismissalReason.trim());
  if (!evidence) return unchanged;
  // An explicit manual dismissal supersedes old automatic evidence.
  if (logs.some(l => !isAutomaticOpportunityLog(l) && l.reason.startsWith("فصل الطالب") && l.date >= evidence.date) ||
      state.studentNotes.some(n => n.studentId === student.id && n.kind === "إجراء" && n.text.startsWith("فصل الطالب") && n.date >= evidence.date)) return unchanged;
  const covered = new Set(review.examIds);
  const removedCause = currentAutomatic.some(l => {
    const exam = exams.get(l.examId);
    return covered.has(l.examId) && exam && l.date <= evidence.date &&
      (l.action === "خصم تلقائي" || l.action === "فصل تلقائي") &&
      state.studentLeaves.some(leave => studentLeaveAppliesToExam(leave, student.id, exam));
  });
  if (!removedCause) return unchanged;
  const projected = recalculateAcademicState({ ...state, students: state.students.map(s =>
    s.id === student.id ? { ...s, status: "نشط", dismissalReason: "" } : s) }, targetIds);
  const result = projected.students.find(s => s.id === student.id);
  // No pledge, grant or historical reset: retain the actual remaining balance.
  if (result?.status !== "نشط" || projected.opportunityLogs.some(l =>
    l.studentId === student.id && l.chapterId === chapter.id && l.action === "فصل تلقائي")) return unchanged;
  return preserveHistory(projected);
}
