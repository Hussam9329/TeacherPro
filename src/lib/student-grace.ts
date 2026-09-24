import { baghdadDateKey } from "@/lib/baghdad-time";

export const AUTOMATIC_NEW_STUDENT_GRACE_DAYS = 3;
export const MAX_MANUAL_STUDENT_GRACE_DAYS = 30;

export type GracePeriodStartMode = "registration" | "now" | "custom";

export type StudentGraceLike = {
  createdAt?: Date | string | null;
  accountingGraceDays?: number | string | null;
  gracePeriodStartDate?: Date | string | null;
  gracePeriodEndedAt?: Date | string | null;
  gracePeriodHistory?: unknown;
};

export type ExamDateLike = {
  id?: string;
  date?: Date | string | null;
};

export type StudentGraceHistoryEntry = {
  start: string;
  endExclusive: string;
  excludedExamIds: string[];
  examIds?: string[];
};

export type StudentGraceWindow = {
  start: Date;
  endExclusive: Date;
  days: number;
  source: "automatic" | "manual";
};

export type StudentGraceStatus = {
  window: StudentGraceWindow | null;
  remainingDays: number;
  state: "unavailable" | "upcoming" | "active" | "expired";
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeGraceDays(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(
    MAX_MANUAL_STUDENT_GRACE_DAYS,
    Math.max(0, Math.trunc(numeric)),
  );
}

export function normalizeGracePeriodStartMode(
  value: unknown,
): GracePeriodStartMode | "" {
  return value === "registration" ||
    value === "now" ||
    value === "custom"
    ? value
    : "";
}

/**
 * يحوّل إدخال تاريخ بداية صريح (yyyy-mm-dd أو تاريخ) إلى منتصف ليل UTC
 * لنفس يوم بغداد. يعيد null عند الإدخال غير الصالح.
 */
export function parseGraceStartDateInput(value: unknown): Date | null {
  if (!value) return null;
  return parseGraceDateOnly(value as Date | string);
}

/**
 * قواعد تاريخ البداية الصريح: لا يسبق تاريخ التسجيل ولا يدخل المستقبل.
 * يعيد رسالة خطأ عربية أو سلسلة فارغة عند الصلاحية.
 */
export function validateManualGraceStartDate(args: {
  start: Date;
  createdAt: Date | string;
  now?: Date;
}): string {
  const startKey = baghdadDateKey(args.start);
  if (!startKey) return "تاريخ بداية فترة السماح غير صالح.";
  const registrationKey = baghdadDateKey(args.createdAt);
  if (registrationKey && startKey < registrationKey) {
    return "تاريخ بداية السماح لا يمكن أن يسبق تاريخ تسجيل الطالب.";
  }
  const todayKey = baghdadDateKey(args.now || new Date());
  if (todayKey && startKey > todayKey) {
    return "تاريخ بداية السماح لا يمكن أن يكون في المستقبل.";
  }
  return "";
}

export function parseGraceDateOnly(
  value: Date | string | null | undefined,
): Date | null {
  if (!value) return null;
  const key = baghdadDateKey(value);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0),
  );
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key
    ? date
    : null;
}

export function resolveManualGraceStartDate(args: {
  mode: GracePeriodStartMode;
  createdAt: Date | string;
  now?: Date;
}): Date {
  const source = args.mode === "registration" ? args.createdAt : args.now || new Date();
  const parsed = parseGraceDateOnly(source);
  if (!parsed) {
    throw new Error("تعذر تحديد تاريخ بدء فترة السماح.");
  }
  return parsed;
}

/**
 * المصدر الوحيد لحساب السماح في النظام:
 * - عند وجود سماح يدوي (> 0) وgracePeriodStartDate، يحل اليدوي محل التلقائي.
 * - بيانات قديمة بلا gracePeriodStartDate تبدأ من تاريخ التسجيل كحل آمن متوافق.
 * - بدون سماح يدوي يحصل الطالب الجديد على 3 أيام تلقائية من تاريخ التسجيل.
 */
export function getStudentGraceWindow(
  student: StudentGraceLike,
): StudentGraceWindow | null {
  // A real numeric grade (or an explicit administrative termination) ends
  // grace permanently for the current enrollment. Zero days alone cannot
  // represent that state because zero normally means the automatic 3-day
  // new-student window applies.
  if (student.gracePeriodEndedAt) return null;

  const registrationStart = parseGraceDateOnly(student.createdAt);
  if (!registrationStart) return null;

  const manualDays = normalizeGraceDays(student.accountingGraceDays);
  if (manualDays > 0) {
    const manualStart =
      parseGraceDateOnly(student.gracePeriodStartDate) || registrationStart;
    const endExclusive = new Date(manualStart);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + manualDays);
    return {
      start: manualStart,
      endExclusive,
      days: manualDays,
      source: "manual",
    };
  }

  const endExclusive = new Date(registrationStart);
  endExclusive.setUTCDate(
    endExclusive.getUTCDate() + AUTOMATIC_NEW_STUDENT_GRACE_DAYS,
  );
  return {
    start: registrationStart,
    endExclusive,
    days: AUTOMATIC_NEW_STUDENT_GRACE_DAYS,
    source: "automatic",
  };
}

export function isDateWithinStudentGraceWindow(
  student: StudentGraceLike,
  date: Date | string | null | undefined,
): boolean {
  const window = getStudentGraceWindow(student);
  const targetDate = parseGraceDateOnly(date);
  if (!window || !targetDate) return false;
  return targetDate >= window.start && targetDate < window.endExclusive;
}

export function isExamWithinStudentGraceWindow(
  student: StudentGraceLike,
  exam: ExamDateLike,
): boolean {
  if (isDateWithinStudentGraceWindow(student, exam.date)) return true;
  const date = parseGraceDateOnly(exam.date)?.toISOString().slice(0, 10);
  if (!date) return false;
  return normalizeStudentGraceHistory(student.gracePeriodHistory).some(
    (entry) => date >= entry.start && date < entry.endExclusive &&
      (!entry.examIds || Boolean(exam.id && entry.examIds.includes(exam.id))) &&
      (entry.excludedExamIds.length === 0 || Boolean(exam.id && !entry.excludedExamIds.includes(exam.id))),
  );
}

/** Persisted, server-owned civil-day intervals; never extend the current counter. */
export function normalizeStudentGraceHistory(value: unknown): StudentGraceHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, StudentGraceHistoryEntry>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const start = typeof item.start === "string" ? parseGraceDateOnly(item.start) : null;
    const end = typeof item.endExclusive === "string" ? parseGraceDateOnly(item.endExclusive) : null;
    if (!start || !end || start >= end) continue;
    const examIds = Array.isArray(item.examIds)
      ? [...new Set<string>(item.examIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0))].sort()
      : undefined;
    if (item.examIds !== undefined && !examIds?.length) continue;
    const entry: StudentGraceHistoryEntry = {
      start: start.toISOString().slice(0, 10),
      endExclusive: end.toISOString().slice(0, 10),
      excludedExamIds: Array.isArray(item.excludedExamIds)
        ? [...new Set<string>(item.excludedExamIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0))].sort()
        : [],
      ...(examIds ? { examIds } : {}),
    };
    unique.set(JSON.stringify(entry), entry);
  }
  return [...unique.values()].sort((a, b) =>
    a.start.localeCompare(b.start) || a.endExclusive.localeCompare(b.endExclusive) ||
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}

/**
 * Save elapsed entitlement before replacing a window. Renewal preserves today;
 * numeric activation preserves earlier days and keeps the entered exam chargeable.
 * Future days in an edited/cancelled grant are not silently carried forward.
 */
export function preserveStudentGraceHistory(
  student: StudentGraceLike,
  options: { now?: Date; includeToday?: boolean; excludeExamId?: string } = {},
): StudentGraceHistoryEntry[] {
  const history = normalizeStudentGraceHistory(student.gracePeriodHistory);
  const window = getStudentGraceWindow(student);
  const cutoff = parseGraceDateOnly(options.now || new Date());
  if (window && cutoff) {
    if (options.includeToday !== false) cutoff.setUTCDate(cutoff.getUTCDate() + 1);
    const end = new Date(Math.min(window.endExclusive.getTime(), cutoff.getTime()));
    if (end > window.start) {
      history.push({ start: window.start.toISOString().slice(0, 10), endExclusive: end.toISOString().slice(0, 10), excludedExamIds: [] });
    }
  }
  if (options.excludeExamId) {
    for (const entry of history) entry.excludedExamIds.push(options.excludeExamId);
  }
  return normalizeStudentGraceHistory(history);
}

/**
 * يحسب العداد الذي يراه المستخدم من نافذة السماح الفعلية، لا من مدة السماح
 * الأصلية المخزنة. مدة 12 يوماً تبقى محفوظة لحماية تفسير الامتحانات القديمة،
 * بينما remainingDays ينخفض يومياً ويصبح صفراً عند نهاية النافذة.
 */
export function getStudentGraceStatus(
  student: StudentGraceLike,
  now: Date = new Date(),
): StudentGraceStatus {
  const window = getStudentGraceWindow(student);
  const today = parseGraceDateOnly(now);
  if (!window || !today) {
    return { window, remainingDays: 0, state: "unavailable" };
  }
  if (today < window.start) {
    return { window, remainingDays: 0, state: "upcoming" };
  }
  if (today >= window.endExclusive) {
    return { window, remainingDays: 0, state: "expired" };
  }

  const remainingDays = Math.max(
    0,
    Math.ceil((window.endExclusive.getTime() - today.getTime()) / DAY_MS),
  );
  return { window, remainingDays, state: "active" };
}

export function getStudentGraceDaysRemaining(
  student: StudentGraceLike,
  now: Date = new Date(),
): number {
  return getStudentGraceStatus(student, now).remainingDays;
}

export function isStudentCurrentlyInGrace(
  student: StudentGraceLike,
  now: Date = new Date(),
): boolean {
  return getStudentGraceStatus(student, now).state === "active";
}
