/**
 * «الطلبة المتميزين»: students ranked by their grades in the chosen exams
 * (cumulative, optionally finals too). Every exam counts as a percentage of
 * its full mark, so exams out of 50 and out of 100 weigh the same.
 *
 * Per exam a grade is one of:
 *  - a mark (status «درجة» with a score): counted;
 *  - excused («مجاز», «إجازة», before registration) or not entered yet: left
 *    out, it neither helps nor hurts;
 *  - absent («غائب», «غش», or no row at all after the exam): with
 *    «حضر كل الامتحانات» the student is left out of the ranking; with
 *    «الغياب صفر» it counts as 0%.
 */

export const TOP_STUDENT_EXAM_TYPES = ["تراكمي", "فاينل"] as const;
export type TopStudentsAttendance = "all" | "zero";

export type TopStudentsExam = { id: string; name: string; date: string; type: string; fullMark: number };
export type TopStudentsStudent = { id: string; name: string; code: string; gender?: string | null; studyType?: string | null; createdAt?: string | null };
export type TopStudentsGrade = { studentId: string; examId: string; status: string; score: number | null };

export type TopStudentExamResult = { examId: string; percent: number | null; score: number | null; state: "mark" | "absent" | "excused" | "pending" };
export type TopStudentRow = {
  rank: number;
  id: string;
  name: string;
  code: string;
  average: number;
  marks: number;
  absences: number;
  excused: number;
  fullMarks: number;
  exams: TopStudentExamResult[];
};
export type TopStudentsResult = {
  exams: TopStudentsExam[];
  rows: TopStudentRow[];
  /** Students in the course who matched the student filters. */
  considered: number;
  /** Of them, the ones the attendance rule lets into the ranking. */
  qualified: number;
  /** The average of the qualified students (the course's level in these exams). */
  courseAverage: number | null;
};

const EXCUSED = new Set(["مجاز", "إجازة", "اجازة", "قبل تسجيل الطالب"]);
const ABSENT = new Set(["غائب", "غش"]);

function classify(grade: TopStudentsGrade | undefined, exam: TopStudentsExam, student: TopStudentsStudent): TopStudentExamResult {
  const base = { examId: exam.id, percent: null, score: null };
  // An exam held before the student registered is not theirs to sit.
  if (student.createdAt && exam.date && student.createdAt.slice(0, 10) > exam.date.slice(0, 10) && !grade) {
    return { ...base, state: "excused" };
  }
  if (!grade) return { ...base, state: "absent" };
  const status = String(grade.status || "").trim();
  if (status === "درجة" && typeof grade.score === "number" && exam.fullMark > 0) {
    const percent = Math.max(0, Math.min(100, (grade.score / exam.fullMark) * 100));
    return { examId: exam.id, percent, score: grade.score, state: "mark" };
  }
  if (EXCUSED.has(status)) return { ...base, state: "excused" };
  if (ABSENT.has(status)) return { ...base, state: "absent" };
  // «درجة» without a score, or a status still being decided: not yet known.
  return { ...base, state: "pending" };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function rankTopStudents(input: {
  exams: TopStudentsExam[];
  students: TopStudentsStudent[];
  grades: TopStudentsGrade[];
  attendance: TopStudentsAttendance;
  limit: number;
}): TopStudentsResult {
  const exams = [...input.exams].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ar"));
  const gradeOf = new Map(input.grades.map((grade) => [`${grade.studentId}|${grade.examId}`, grade]));
  const ranked: Omit<TopStudentRow, "rank">[] = [];

  for (const student of input.students) {
    const results = exams.map((exam) => classify(gradeOf.get(`${student.id}|${exam.id}`), exam, student));
    const marks = results.filter((result) => result.state === "mark");
    const absences = results.filter((result) => result.state === "absent").length;
    if (!marks.length) continue;
    if (input.attendance === "all" && absences > 0) continue;
    const counted = marks.map((result) => result.percent as number);
    if (input.attendance === "zero") for (let i = 0; i < absences; i += 1) counted.push(0);
    const average = counted.reduce((total, value) => total + value, 0) / counted.length;
    ranked.push({
      id: student.id,
      name: student.name,
      code: student.code,
      average: round1(average),
      marks: marks.length,
      absences,
      excused: results.filter((result) => result.state === "excused").length,
      fullMarks: marks.filter((result) => (result.percent as number) >= 100).length,
      exams: results.map((result) => (result.percent === null ? result : { ...result, percent: round1(result.percent) })),
    });
  }

  // Higher average first; then more marks (more evidence), more full marks, then the name.
  ranked.sort((a, b) =>
    b.average - a.average ||
    b.marks - a.marks ||
    b.fullMarks - a.fullMarks ||
    a.name.localeCompare(b.name, "ar"),
  );

  // Equal averages share a place (1, 2, 2, 4).
  const rows: TopStudentRow[] = [];
  ranked.forEach((row, index) => {
    const previous = rows[index - 1];
    const rank = previous && previous.average === row.average ? previous.rank : index + 1;
    rows.push({ ...row, rank });
  });

  const qualified = rows.length;
  const courseAverage = qualified ? round1(rows.reduce((total, row) => total + row.average, 0) / qualified) : null;
  const limit = Math.max(1, Math.trunc(input.limit) || 10);
  // Keep everyone tied with the last place shown.
  const cut = rows.length > limit ? rows[limit - 1].rank : Infinity;
  return {
    exams,
    rows: rows.filter((row, index) => index < limit || row.rank <= cut),
    considered: input.students.length,
    qualified,
    courseAverage,
  };
}
