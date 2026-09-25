import { baghdadDateKey } from "./baghdad-time";
import { addDaysToGraceDateKey, formatGraceDate, type GracePeriodRange } from "./grace-periods";

/**
 * ONE-TIME CONVERSION of the retired grace model into GracePeriod rows.
 *
 * The functions below are a frozen reading of the old Student grace columns
 * (automatic 3 days, manual days + start date, "ended" flag, JSON history) and
 * of old "ضمن فترة السماح" placeholder rows. Nothing else in TeacherPro may
 * use them: after the switch, grace comes only from GracePeriod rows.
 */

const LEGACY_AUTOMATIC_DAYS = 3;
const LEGACY_MAX_MANUAL_DAYS = 30;

export type LegacyStudentGrace = {
  id: string;
  createdAt: Date | string;
  accountingGraceDays: number | null;
  gracePeriodStartDate: Date | string | null;
  gracePeriodEndedAt: Date | string | null;
  gracePeriodHistory: unknown;
};

export type LegacyPlaceholder = { examId: string; examDate: string };

export type LegacyExistingPeriod = GracePeriodRange & { source: string; cancelled: boolean };

type Interval = { startDate: string; endDate: string; origin: LegacyOrigin };

export type LegacyOrigin = "current-window" | "history" | "history-exam" | "placeholder";

export type LegacyStudentPlan = {
  status: "nothing" | "already-converted" | "convert";
  periods: Array<GracePeriodRange & { note: string }>;
  origins: Record<LegacyOrigin, number>;
  uncertainReasons: string[];
  conflicts: string[];
  /** Placeholders that stop existing once converted (covered or future). */
  placeholdersToDelete: number;
  /** Placeholders dated after today that no converted period covers. */
  futurePlaceholders: number;
};

const ORIGIN_LABELS: Record<LegacyOrigin, string> = {
  "current-window": "نافذة السماح القديمة",
  history: "سجل السماح القديم",
  "history-exam": "حماية امتحان محدد من سجل السماح القديم",
  placeholder: "علامة «ضمن فترة السماح» قديمة",
};

function dateKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  const key = baghdadDateKey(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function legacyDays(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(LEGACY_MAX_MANUAL_DAYS, Math.max(0, Math.trunc(numeric)));
}

/** Old getStudentGraceWindow, expressed with inclusive civil days. */
export function legacyCurrentWindow(student: LegacyStudentGrace): GracePeriodRange | null {
  if (student.gracePeriodEndedAt) return null;
  const registration = dateKey(student.createdAt);
  if (!registration) return null;
  const manualDays = legacyDays(student.accountingGraceDays);
  if (manualDays > 0) {
    const start = dateKey(student.gracePeriodStartDate) || registration;
    return { startDate: start, endDate: addDaysToGraceDateKey(start, manualDays - 1) };
  }
  return {
    startDate: registration,
    endDate: addDaysToGraceDateKey(registration, LEGACY_AUTOMATIC_DAYS - 1),
  };
}

type LegacyHistoryEntry = {
  start: string;
  endExclusive: string;
  excludedExamIds: string[];
  examIds?: string[];
};

function readHistory(value: unknown): LegacyHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: LegacyHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const start = dateKey(typeof raw.start === "string" ? raw.start : null);
    const end = dateKey(typeof raw.endExclusive === "string" ? raw.endExclusive : null);
    if (!start || !end || start >= end) continue;
    const ids = (list: unknown) =>
      Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    const examIds = raw.examIds === undefined ? undefined : ids(raw.examIds);
    if (examIds !== undefined && examIds.length === 0) continue;
    entries.push({ start, endExclusive: end, excludedExamIds: ids(raw.excludedExamIds), ...(examIds ? { examIds } : {}) });
  }
  return entries;
}

function splitAroundDays(interval: Interval, days: string[]): Interval[] {
  let pieces = [interval];
  for (const day of [...new Set(days)].sort()) {
    pieces = pieces.flatMap((piece) => {
      if (day < piece.startDate || day > piece.endDate) return [piece];
      const out: Interval[] = [];
      if (piece.startDate < day) out.push({ ...piece, endDate: addDaysToGraceDateKey(day, -1) });
      if (day < piece.endDate) out.push({ ...piece, startDate: addDaysToGraceDateKey(day, 1) });
      return out;
    });
  }
  return pieces;
}

function covered(intervals: Interval[], day: string): boolean {
  return intervals.some((interval) => day >= interval.startDate && day <= interval.endDate);
}

function subtract(intervals: Interval[], blockers: GracePeriodRange[]): { kept: Interval[]; changed: boolean } {
  let changed = false;
  let pieces = intervals;
  for (const blocker of blockers) {
    pieces = pieces.flatMap((piece) => {
      if (piece.endDate < blocker.startDate || blocker.endDate < piece.startDate) return [piece];
      changed = true;
      const out: Interval[] = [];
      if (piece.startDate < blocker.startDate) out.push({ ...piece, endDate: addDaysToGraceDateKey(blocker.startDate, -1) });
      if (blocker.endDate < piece.endDate) out.push({ ...piece, startDate: addDaysToGraceDateKey(blocker.endDate, 1) });
      return out;
    });
  }
  return { kept: pieces, changed };
}

/** Merge overlapping or touching intervals into non-overlapping periods. */
export function mergeLegacyIntervals(intervals: Interval[]): Array<GracePeriodRange & { origins: Set<LegacyOrigin> }> {
  const sorted = [...intervals].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const merged: Array<GracePeriodRange & { origins: Set<LegacyOrigin> }> = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.startDate <= addDaysToGraceDateKey(last.endDate, 1)) {
      if (interval.endDate > last.endDate) last.endDate = interval.endDate;
      last.origins.add(interval.origin);
    } else {
      merged.push({ startDate: interval.startDate, endDate: interval.endDate, origins: new Set([interval.origin]) });
    }
  }
  return merged;
}

/**
 * Converts one student's legacy grace state into explicit periods. The result
 * protects exactly the days the old system protected, with two documented
 * approximations reported as "uncertain": a per-exam history entry and an
 * orphan placeholder both become a whole protected day.
 */
export function planLegacyStudentConversion(args: {
  student: LegacyStudentGrace;
  examDateById: ReadonlyMap<string, string>;
  placeholders: LegacyPlaceholder[];
  existingPeriods: LegacyExistingPeriod[];
  todayKey: string;
}): LegacyStudentPlan {
  const { student, examDateById, placeholders, existingPeriods, todayKey } = args;
  const origins: Record<LegacyOrigin, number> = { "current-window": 0, history: 0, "history-exam": 0, placeholder: 0 };
  const empty = (status: LegacyStudentPlan["status"]): LegacyStudentPlan => ({
    status, periods: [], origins, uncertainReasons: [], conflicts: [], placeholdersToDelete: 0, futurePlaceholders: 0,
  });
  if (existingPeriods.some((period) => period.source === "legacy")) return empty("already-converted");

  const intervals: Interval[] = [];
  const uncertainReasons: string[] = [];
  const conflicts: string[] = [];

  const window = legacyCurrentWindow(student);
  if (window) intervals.push({ ...window, origin: "current-window" });

  for (const entry of readHistory(student.gracePeriodHistory)) {
    const range: Interval = {
      startDate: entry.start,
      endDate: addDaysToGraceDateKey(entry.endExclusive, -1),
      origin: entry.examIds ? "history-exam" : "history",
    };
    if (entry.examIds) {
      for (const examId of entry.examIds) {
        const day = examDateById.get(examId);
        if (!day || day < range.startDate || day > range.endDate) continue;
        intervals.push({ startDate: day, endDate: day, origin: "history-exam" });
        uncertainReasons.push(`حماية امتحان محدد يوم ${formatGraceDate(day)} أصبحت حماية يوم كامل`);
      }
      continue;
    }
    const excludedDays = entry.excludedExamIds
      .map((examId) => examDateById.get(examId) || "")
      .filter((day) => day && day >= range.startDate && day <= range.endDate);
    if (excludedDays.length) {
      conflicts.push(
        `استُبعد يوم ${[...new Set(excludedDays)].map(formatGraceDate).join("، ")} من السماح لأن درجة رقمية أنهت السماح القديم فيه`,
      );
    }
    intervals.push(...splitAroundDays(range, excludedDays));
  }

  let placeholdersToDelete = 0;
  let futurePlaceholders = 0;
  for (const placeholder of placeholders) {
    placeholdersToDelete += 1;
    if (covered(intervals, placeholder.examDate)) continue;
    if (placeholder.examDate > todayKey) {
      futurePlaceholders += 1;
      continue;
    }
    intervals.push({ startDate: placeholder.examDate, endDate: placeholder.examDate, origin: "placeholder" });
    uncertainReasons.push(`يوم ${formatGraceDate(placeholder.examDate)} محمي فقط بعلامة «ضمن فترة السماح» قديمة`);
  }

  const blockers = existingPeriods.filter((period) => !period.cancelled);
  const { kept, changed } = subtract(intervals, blockers);
  if (changed) conflicts.push("تداخلت فترة قديمة مع فترة أضيفت يدوياً؛ اعتُمدت الفترة اليدوية واقتُطع الجزء المتداخل");

  const merged = mergeLegacyIntervals(kept);
  for (const period of merged) for (const origin of period.origins) origins[origin] += 1;
  if (!merged.length && !placeholdersToDelete) return empty("nothing");
  return {
    status: "convert",
    periods: merged.map((period) => ({
      startDate: period.startDate,
      endDate: period.endDate,
      note: `محوّل من النظام القديم: ${[...period.origins].map((origin) => ORIGIN_LABELS[origin]).join(" + ")}`,
    })),
    origins,
    uncertainReasons: [...new Set(uncertainReasons)],
    conflicts,
    placeholdersToDelete,
    futurePlaceholders,
  };
}
