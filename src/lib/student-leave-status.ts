import { baghdadDateKey } from "./baghdad-time";

/**
 * Where a leave stands today, shared by «إدارة الإجازات» and its API.
 * An exam leave covers its exam's day; a period covers its range. An ended
 * leave stays in the record and keeps the exemption of the exams it covered.
 */
export type StudentLeaveState = "active" | "upcoming" | "ended";
export type StudentLeaveListFilter = "past" | "current" | "all";

export const STUDENT_LEAVE_STATE_LABELS: Record<StudentLeaveState, string> = {
  active: "سارية",
  upcoming: "قادمة",
  ended: "منتهية",
};

export const STUDENT_LEAVE_LIST_FILTERS: ReadonlyArray<{
  value: StudentLeaveListFilter;
  label: string;
  hint: string;
}> = [
  { value: "past", label: "الإجازات السابقة", hint: "منتهية" },
  { value: "current", label: "الإجازات الحالية", hint: "سارية أو قادمة" },
  { value: "all", label: "كل الإجازات", hint: "" },
];

export function normalizeStudentLeaveListFilter(value: unknown): StudentLeaveListFilter {
  return value === "past" || value === "current" ? value : "all";
}

type DateValue = string | Date | null | undefined;

export type StudentLeaveDaySource = {
  leaveType?: string | null;
  date?: DateValue;
  dateFrom?: DateValue;
  dateTo?: DateValue;
  /** The linked exam's date; an exam leave is dated by its exam, never by its documentation date. */
  examDate?: DateValue;
};

export type StudentLeaveDays = { from: string; to: string };

export function studentLeaveDays(leave: StudentLeaveDaySource): StudentLeaveDays {
  if (leave.leaveType === "period") {
    const first = baghdadDateKey(leave.dateFrom || leave.date);
    const last = baghdadDateKey(leave.dateTo || leave.dateFrom || leave.date);
    return first <= last ? { from: first, to: last } : { from: last, to: first };
  }
  const day = baghdadDateKey(leave.examDate || leave.date);
  return { from: day, to: day };
}

export function studentLeaveState(days: StudentLeaveDays, today: string): StudentLeaveState {
  if (days.to && days.to < today) return "ended";
  if (days.from && days.from > today) return "upcoming";
  return "active";
}

export type StudentLeaveSummary = {
  total: number;
  active: number;
  upcoming: number;
  ended: number;
  /** Start day of the newest leave, for newest-first ordering. */
  latestDay: string;
  /** The student's light: any running leave wins, then an upcoming one. */
  state: StudentLeaveState | null;
};

export function summarizeStudentLeaves(
  leaves: readonly StudentLeaveDaySource[],
  today: string,
): StudentLeaveSummary {
  const summary: StudentLeaveSummary = { total: 0, active: 0, upcoming: 0, ended: 0, latestDay: "", state: null };
  for (const leave of leaves) {
    const days = studentLeaveDays(leave);
    summary[studentLeaveState(days, today)] += 1;
    summary.total += 1;
    if (days.from > summary.latestDay) summary.latestDay = days.from;
  }
  summary.state = summary.active ? "active" : summary.upcoming ? "upcoming" : summary.ended ? "ended" : null;
  return summary;
}

export function summaryMatchesFilter(summary: StudentLeaveSummary, filter: StudentLeaveListFilter): boolean {
  if (filter === "past") return summary.ended > 0;
  if (filter === "current") return summary.active + summary.upcoming > 0;
  return true;
}

/** Newest first: by start day, then end day, then when it was recorded. */
export function compareLeavesNewestFirst(
  a: StudentLeaveDaySource & { createdAt?: DateValue; id?: string },
  b: StudentLeaveDaySource & { createdAt?: DateValue; id?: string },
): number {
  const left = studentLeaveDays(a);
  const right = studentLeaveDays(b);
  return (
    right.from.localeCompare(left.from) ||
    right.to.localeCompare(left.to) ||
    String(b.createdAt ? new Date(b.createdAt).toISOString() : "").localeCompare(
      String(a.createdAt ? new Date(a.createdAt).toISOString() : ""),
    ) ||
    String(b.id || "").localeCompare(String(a.id || ""))
  );
}
