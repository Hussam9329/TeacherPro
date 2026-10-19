/**
 * «إحصائيات الطلبة» on the dashboard: one point per Baghdad day.
 *  - registrations: students registered that day (archived later or not)
 *  - dismissals: students dismissed that day (one per student per day)
 *  - archivals: students archived that day (one per student per day)
 *  - active: students active at the end of that day, walked back from today's
 *    count with the registrations, reactivations, restorations from the
 *    archive, dismissals and archivals of active students after it.
 * Pure: the route reads the rows, this turns them into the series.
 */

export type StudentTrendRange = "week" | "month" | "30d" | "90d";

export const STUDENT_TREND_RANGES: Array<{ value: StudentTrendRange; label: string }> = [
  { value: "week", label: "آخر 7 أيام" },
  { value: "month", label: "هذا الشهر" },
  { value: "30d", label: "آخر 30 يوم" },
  { value: "90d", label: "آخر 90 يوم" },
];

export type StudentTrendDay = {
  date: string; // YYYY-MM-DD (Baghdad)
  registrations: number;
  dismissals: number;
  archivals: number;
  active: number;
};

export type StudentTrend = {
  range: StudentTrendRange;
  days: StudentTrendDay[];
  generatedAt: string;
};

export function parseStudentTrendRange(value: unknown): StudentTrendRange {
  return STUDENT_TREND_RANGES.some((range) => range.value === value) ? (value as StudentTrendRange) : "month";
}

function shiftDay(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** The Baghdad days of a range, oldest first, ending today. */
export function studentTrendDayKeys(range: StudentTrendRange, todayKey: string): string[] {
  const first =
    range === "month"
      ? `${todayKey.slice(0, 8)}01`
      : shiftDay(todayKey, -({ week: 7, "30d": 30, "90d": 90 }[range] - 1));
  const days: string[] = [];
  for (let day = first; day <= todayKey; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/** Each event counts once per student per day. */
function countByDay(events: Array<{ studentId: string; day: string }>): Map<string, number> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const { studentId, day } of events) {
    if (!day) continue;
    const key = `${studentId}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return counts;
}

type DayEvent = { studentId: string; day: string };

/** «الحالة السابقة: نشط» in the archive note: the student left the active count. */
export function archivedWhileActive(noteText: string | null | undefined): boolean {
  return /الحالة السابقة:\s*نشط(?:[.\s،]|$)/u.test(String(noteText || ""));
}

export function buildStudentTrend({
  dayKeys,
  activeNow,
  registrations,
  dismissals,
  reactivations,
  archivals = [],
  restorations = [],
}: {
  dayKeys: string[];
  activeNow: number;
  registrations: DayEvent[];
  dismissals: DayEvent[];
  reactivations: DayEvent[];
  /** wasActive: the student was active when archived. */
  archivals?: Array<DayEvent & { wasActive: boolean }>;
  /** Restored from the archive: back to active. */
  restorations?: DayEvent[];
}): StudentTrendDay[] {
  const registered = countByDay(registrations);
  const dismissed = countByDay(dismissals);
  const reactivated = countByDay(reactivations);
  const archived = countByDay(archivals);
  const archivedActive = countByDay(archivals.filter((event) => event.wasActive));
  const restored = countByDay(restorations);
  const days: StudentTrendDay[] = dayKeys.map((date) => ({
    date,
    registrations: registered.get(date) || 0,
    dismissals: dismissed.get(date) || 0,
    archivals: archived.get(date) || 0,
    active: 0,
  }));
  // Walk back from today: the day after d added its registrations,
  // reactivations and restorations, and removed its dismissals and the
  // archivals of active students.
  let active = activeNow;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    days[index].active = Math.max(0, active);
    const date = days[index].date;
    active -=
      (registered.get(date) || 0) + (reactivated.get(date) || 0) + (restored.get(date) || 0)
      - (dismissed.get(date) || 0) - (archivedActive.get(date) || 0);
  }
  return days;
}
