export type ExamChapterScope = {
  examCourses?: readonly { courseId: string; chapterId?: string | null }[];
};

/** The course's explicit exam assignment is authoritative. Historical notes
 * and settlement overrides can never move an exam into the active chapter.
 * Unassigned exams remain visible, but cannot change its opportunity balance.
 * Older callers without chapter metadata retain their existing interpretation. */
export function examChapterExclusion(
  exam: ExamChapterScope,
  courseId?: string | null,
  activeChapterId?: string | null,
): string | null {
  if (!courseId || !activeChapterId || exam.examCourses === undefined) return null;
  const assignment = exam.examCourses.find(link => link.courseId === courseId);
  if (!assignment?.chapterId) return "لم يُحدد فصل الامتحان لهذه الدورة؛ لا يؤثر على فرص الفصل الحالي";
  return assignment.chapterId === activeChapterId
    ? null
    : "امتحان تابع لفصل آخر؛ لا يؤثر على فرص الفصل الحالي";
}
