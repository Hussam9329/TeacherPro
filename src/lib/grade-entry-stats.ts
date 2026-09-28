import type { Grade } from "@/lib/teacher-store";

type GradeCountRow = Pick<
  Grade,
  "studentId" | "examId" | "status" | "score"
>;

/** A typed score parked as a smart note (dismissed, on leave, before
 * registration, or the retired grace archive). */
type ScoredNoteRow = { studentId: string; category: string };

export type ManualGradeCounts = {
  numeric: number;
  preRegistration: number;
  pending: number;
  dismissed: number;
  leave: number;
  graceArchive: number;
  total: number;
};

/**
 * «الأوراق المدخلة يدوياً»: how many students of this exam had a score typed
 * for them. Each student counts ONCE, in the first bucket that applies:
 *
 * 1. a saved grade with a number (status «درجة»)            → numeric
 * 2. a grade typed before registration («قبل تسجيل الطالب») → preRegistration
 * 3. an explicit pending-review grade («درجة معلّقة»)        → pending
 * 4. a typed score parked as a smart note that was not rejected:
 *    before registration → preRegistration, dismissed → dismissed,
 *    on leave → leave, retired grace archive → graceArchive.
 *
 * Not counted: absences, cheating and leave with no score, the retired grace
 * placeholder, legacy «درجة» rows with no number (system placeholders), and
 * rejected smart notes. A note that was later applied to a grade is the same
 * student, so it is never counted twice.
 */
export function countAllManualGradesForExam(
  grades: readonly GradeCountRow[],
  examId: string,
  scoredNotes: readonly ScoredNoteRow[] = [],
): ManualGradeCounts {
  const counts: ManualGradeCounts = { numeric: 0, preRegistration: 0, pending: 0, dismissed: 0, leave: 0, graceArchive: 0, total: 0 };
  if (!examId) return counts;

  const counted = new Set<string>();
  const add = (studentId: string, bucket: Exclude<keyof ManualGradeCounts, "total">) => {
    if (!studentId || counted.has(studentId)) return;
    counted.add(studentId);
    counts[bucket] += 1;
  };
  const hasNumber = (score: unknown) => typeof score === "number" && Number.isFinite(score);

  const examGrades = grades.filter((grade) => grade.examId === examId);
  for (const grade of examGrades) {
    if (grade.status === "درجة" && hasNumber(grade.score)) add(grade.studentId, "numeric");
  }
  for (const grade of examGrades) {
    if (grade.status === "قبل تسجيل الطالب" && hasNumber(grade.score)) add(grade.studentId, "preRegistration");
  }
  for (const grade of examGrades) {
    if (grade.status === "درجة معلّقة") add(grade.studentId, "pending");
  }
  const noteBucket: Record<string, Exclude<keyof ManualGradeCounts, "total">> = {
    BEFORE_REGISTRATION_PENDING: "preRegistration",
    DISMISSED_PENDING: "dismissed",
    LEAVE_PENDING: "leave",
    GRACE_SCORED: "graceArchive",
  };
  for (const note of scoredNotes) {
    const bucket = noteBucket[note.category];
    if (bucket) add(note.studentId, bucket);
  }
  counts.total = counted.size;
  return counts;
}
