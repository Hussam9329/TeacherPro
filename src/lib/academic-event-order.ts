import { baghdadDateKey } from "./baghdad-time";

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
