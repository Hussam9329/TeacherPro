import {
  getActiveChapterForStudent,
  isAutomaticOpportunityLog,
  recalculateAcademicState,
} from "./academic-engine";
import { baghdadDateKey } from "./baghdad-time";
import { examChapterExclusion } from "./exam-chapter-scope";
import type {
  AcademicOpportunityLog,
  AcademicRecalculationResult,
  AcademicStateInput,
} from "./academic-types";

const dismissalReason = (value: string) =>
  String(value || "").replace(/^تلقائي:\s*/, "").trim();

function groupByStudent<T extends { studentId: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.studentId) || [];
    group.push(row);
    groups.set(row.studentId, group);
  }
  return groups;
}

function seedActive(state: AcademicStateInput, ids: Set<string>): AcademicStateInput {
  return {
    ...state,
    students: state.students.map(student => ids.has(student.id)
      ? { ...student, status: "نشط", dismissalReason: "" }
      : student),
  };
}

/** Exam edits may undo only an automatic dismissal proved by the TRUE old
 * snapshot and removed by this edit. Ordinary replay's persisted-dismissal
 * protection stays unchanged. Both previews are batched and create no grant,
 * reset, pledge, grade or note; recovered students retain their computed balance.
 * The caller owns historical-log preservation when persisting the result. */
export function recalculateWithExamEditReview(
  currentState: AcademicStateInput,
  targetIds: Set<string>,
  ordinaryResult: AcademicRecalculationResult,
  beforeState: AcademicStateInput,
  editedExamId: string,
): AcademicRecalculationResult {
  if (!editedExamId || !targetIds.size) return ordinaryResult;
  const currentStudents = new Map(currentState.students.map(student => [student.id, student]));
  const oldExams = new Map(beforeState.exams.map(exam => [exam.id, exam]));
  if (!oldExams.has(editedExamId)) return ordinaryResult;
  const oldLogs = groupByStudent(beforeState.opportunityLogs);
  const allLogs = groupByStudent([...beforeState.opportunityLogs, ...currentState.opportunityLogs]);
  const allNotes = groupByStudent([...beforeState.studentNotes, ...currentState.studentNotes]);
  const evidenceByStudent = new Map<string, AcademicOpportunityLog[]>();

  for (const student of beforeState.students) {
    if (!targetIds.has(student.id) || student.status !== "مفصول" ||
        currentStudents.get(student.id)?.status !== "مفصول") continue;
    const chapter = getActiveChapterForStudent(student, beforeState.courseChapters, beforeState.chapters);
    if (!chapter || !student.dismissalReason.trim()) continue;
    const evidence = (oldLogs.get(student.id) || []).filter(log => {
      const exam = oldExams.get(log.examId);
      return log.action === "فصل تلقائي" && isAutomaticOpportunityLog(log) &&
        log.chapterId === chapter.id && exam?.examCourses &&
        !examChapterExclusion(exam, student.courseId, chapter.id) &&
        dismissalReason(log.reason) === student.dismissalReason.trim() &&
        Boolean(baghdadDateKey(log.date));
    });
    const unoverridden = evidence.filter(log => {
      const causeDay = baghdadDateKey(log.date);
      // Administrative dates may be date-only. Conservatively retain a manual
      // dismissal on the same Baghdad day, or with an unreadable date.
      const isLater = (date: string) => !baghdadDateKey(date) || baghdadDateKey(date) >= causeDay;
      return !(allLogs.get(student.id) || []).some(item =>
        !isAutomaticOpportunityLog(item) && item.reason.startsWith("فصل الطالب") && isLater(item.date)) &&
        !(allNotes.get(student.id) || []).some(note =>
          note.kind === "إجراء" && note.text.startsWith("فصل الطالب") && isLater(note.date));
    });
    if (unoverridden.length) evidenceByStudent.set(student.id, unoverridden);
  }
  if (!evidenceByStudent.size) return ordinaryResult;

  const candidates = new Set(evidenceByStudent.keys());
  const oldReplay = recalculateAcademicState(seedActive(beforeState, candidates), candidates, {
    respectLegacyReactivationDates: true,
  });
  const oldReplayStudents = new Map(oldReplay.students.map(student => [student.id, student]));
  // The engine carries linked historical source logs through by reference.
  // Only newly calculated events prove that the edited exam contributed to
  // this dismissal; a retained source from an earlier pledge is not evidence.
  const storedOldLogs = new Set(beforeState.opportunityLogs);
  const oldReplayLogs = groupByStudent(oldReplay.opportunityLogs.filter(log => !storedOldLogs.has(log)));
  const proved = new Set<string>();
  for (const [studentId, evidence] of evidenceByStudent) {
    const replayedStudent = oldReplayStudents.get(studentId);
    if (replayedStudent?.status !== "مفصول") continue;
    const logs = oldReplayLogs.get(studentId) || [];
    const matchingEvidence = evidence.find(cause =>
      replayedStudent.dismissalReason.trim() === dismissalReason(cause.reason) &&
      logs.some(log => log.action === "فصل تلقائي" &&
        log.examId === cause.examId && log.chapterId === cause.chapterId &&
        dismissalReason(log.reason) === dismissalReason(cause.reason) &&
        baghdadDateKey(log.date) === baghdadDateKey(cause.date)) &&
      // Require this exam's actual replayed contribution. Merely finding an
      // old stored log would incorrectly recover settled or unrelated cases.
      logs.some(log => log.examId === editedExamId && log.chapterId === cause.chapterId &&
        (log.action === "فصل تلقائي" || (log.action === "خصم تلقائي" && log.amount > 0)) &&
        Boolean(baghdadDateKey(log.date)) && baghdadDateKey(log.date) <= baghdadDateKey(cause.date)));
    if (matchingEvidence) proved.add(studentId);
  }
  if (!proved.size) return ordinaryResult;

  const newReplay = recalculateAcademicState(seedActive(currentState, proved), proved, {
    respectLegacyReactivationDates: true,
  });
  const recovered = new Map(newReplay.students.filter(student => {
    if (!proved.has(student.id) || student.status !== "نشط" || student.dismissalReason.trim()) return false;
    const chapter = getActiveChapterForStudent(student, currentState.courseChapters, currentState.chapters);
    // Active status with no reason is the engine's authoritative absence of
    // any current cause. Retained historical pledge-source logs may still
    // contain an old dismissal from this same chapter and must survive.
    return Boolean(chapter);
  }).map(student => [student.id, student]));
  if (!recovered.size) return ordinaryResult;

  return {
    students: ordinaryResult.students.map(student => recovered.get(student.id) || student),
    opportunityLogs: [
      ...ordinaryResult.opportunityLogs.filter(log => !recovered.has(log.studentId)),
      ...newReplay.opportunityLogs.filter(log => recovered.has(log.studentId)),
    ],
  };
}
