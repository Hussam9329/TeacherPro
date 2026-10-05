import { baghdadDateKey } from "./baghdad-time";
import { isExamAvailableForEntry, isScoreInsideExamRange } from "./exam-utils";

/** An exam owns its calendar day. A date-only exam may follow an already
 * recorded balance movement on that same day, but delayed entry must never
 * move it across a later exam day or a later day's credit. */
export function examResultTimelineDate(
  examDate: string,
  enteredDate: string,
  balanceDates: readonly string[],
): string {
  const examTime = Date.parse(examDate);
  const enteredTime = Date.parse(enteredDate);
  if (!Number.isFinite(examTime) || !Number.isFinite(enteredTime)) return examDate;
  const examDay = baghdadDateKey(examDate);
  let result = examDate;
  let latestTime = examTime;
  for (const date of balanceDates) {
    const time = Date.parse(date);
    if (Number.isFinite(time) && time > latestTime && time <= enteredTime &&
        baghdadDateKey(date) === examDay) {
      result = date;
      latestTime = time;
    }
  }
  return result;
}

/** A result that can take no opportunity: a recorded score above the exam's
 * discount mark (a final not zero and above its dismissal grade), a leave or
 * any other non-result status, an excluded grade, or anything but cheating
 * on a «بدون خصم» exam, an exam not open for grades, or a score outside the
 * exam's range. Mirrors gradeHasAcademicEffect without the student's context
 * (leaves, grace, settlements), which the engine adds itself. */
export function examResultCannotDeduct(
  grade: { status?: unknown; score?: unknown; academicEffectExcluded?: unknown },
  exam?: {
    type?: unknown; discountMark?: unknown; dismissalGrade?: unknown; noDiscount?: unknown;
    active?: unknown; date?: unknown; scheduledActivateAt?: unknown; fullMark?: unknown;
  } | null,
): boolean {
  if (!exam || grade.academicEffectExcluded === true) return true;
  if (exam.active !== undefined && !isExamAvailableForEntry({
    active: exam.active === true || exam.active === "true",
    date: exam.date as string | Date | null | undefined,
    scheduledActivateAt: exam.scheduledActivateAt as string | Date | null | undefined,
  })) return true;
  if (grade.status === "درجة" && exam.fullMark !== undefined && exam.fullMark !== null &&
      !isScoreInsideExamRange(grade.score, Number(exam.fullMark))) return true;
  if (grade.status === "غش") return false;
  if (exam.noDiscount === true || exam.noDiscount === "true") return true;
  if (grade.status === "غائب") return false;
  if (grade.status !== "درجة") return true;
  if (grade.score === null || grade.score === undefined || grade.score === "") return true;
  const score = Number(grade.score);
  if (!Number.isFinite(score)) return true;
  if (String(exam.type ?? "") === "فاينل") {
    const dismissal = exam.dismissalGrade === null || exam.dismissalGrade === undefined || exam.dismissalGrade === ""
      ? null : Number(exam.dismissalGrade);
    return score !== 0 && (dismissal === null || score > dismissal);
  }
  return score > Number(exam.discountMark);
}

export type ExamResultPlacement = {
  examDate: string;
  enteredDate: string;
  /** The exam's place among exams: its date, then its ID. */
  orderKey: string;
  cannotDeduct: boolean;
};

/** Where each result sits among the balance movements, in input order.
 * A result that can deduct follows a same-day movement it was entered after:
 * it must not spend a balance it did not know about. One that cannot deduct
 * (a pass, or a fail above the discount mark) stays on its exam's day however
 * late it was entered, but never ahead of an earlier exam of the same day,
 * so a day's exams keep their order. */
export function examResultLedgerDates(
  results: readonly ExamResultPlacement[],
  balanceDates: readonly string[],
): string[] {
  const dates = results.map((result) => result.cannotDeduct
    ? result.examDate
    : examResultTimelineDate(result.examDate, result.enteredDate, balanceDates));
  const order = results.map((_, index) => index)
    .sort((a, b) => results[a].orderKey.localeCompare(results[b].orderKey) || a - b);
  const latestByDay = new Map<string, { time: number; date: string }>();
  for (const index of order) {
    const day = baghdadDateKey(results[index].examDate);
    const time = Date.parse(dates[index]);
    if (!day || !Number.isFinite(time)) continue;
    const latest = latestByDay.get(day);
    if (latest && latest.time > time) {
      if (results[index].cannotDeduct) dates[index] = latest.date;
    } else {
      latestByDay.set(day, { time, date: dates[index] });
    }
  }
  return dates;
}
