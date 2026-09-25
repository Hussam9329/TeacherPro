import { baghdadDateKey } from "./baghdad-time";

/**
 * فترة السماح في TeacherPro هي فترة زمنية محددة للطالب (من يوم إلى يوم،
 * واليومان داخلان). أي امتحان يقع تاريخه داخلها يُعامل الطالب فيه كمجاز بسبب
 * فترة السماح ولا يكون له أي أثر محاسبي. هذا الملف هو المصدر الوحيد للقرار؛
 * لا يجوز لأي قسم آخر أن يكتب نسخة خاصة من منطق السماح.
 */

export const GRACE_PERIOD_EXCUSE_LABEL = "مجاز — فترة سماح";
export const MAX_GRACE_PERIOD_DAYS = 30;

/** Civil Baghdad days as YYYY-MM-DD, both ends inclusive. */
export type GracePeriodRange = {
  id?: string;
  startDate: string;
  endDate: string;
};

export type GracePeriodRecord = GracePeriodRange & {
  id: string;
  studentId: string;
  source: string;
  note: string;
  createdById: string | null;
  createdByName: string;
  createdAt: string;
  updatedById: string | null;
  updatedByName: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancelledByName: string;
  cancelReason: string;
};

export type StudentGracePeriodsLike = {
  gracePeriods?: readonly GracePeriodRange[] | null;
};

type DateInput = Date | string | null | undefined;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Baghdad civil day of any stored instant or date-only value. */
export function graceDateKey(value: DateInput): string {
  const key = baghdadDateKey(value ?? null);
  return DATE_KEY_PATTERN.test(key) ? key : "";
}

function dateKeyToUtc(key: string): number | null {
  const match = key.match(DATE_KEY_PATTERN);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === key ? time : null;
}

/** Strict calendar validation for a YYYY-MM-DD key (rejects 2026-02-30). */
export function isValidGraceDateKey(value: unknown): value is string {
  return typeof value === "string" && dateKeyToUtc(value) !== null;
}

export function addDaysToGraceDateKey(key: string, days: number): string {
  const time = dateKeyToUtc(key);
  if (time === null || !Number.isFinite(days)) return "";
  const date = new Date(time);
  date.setUTCDate(date.getUTCDate() + Math.trunc(days));
  return date.toISOString().slice(0, 10);
}

/** Inclusive day count: 25/09 → 28/09 is 4 days. */
export function gracePeriodDays(period: Pick<GracePeriodRange, "startDate" | "endDate">): number {
  const start = dateKeyToUtc(period.startDate);
  const end = dateKeyToUtc(period.endDate);
  if (start === null || end === null || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/** End date from a start date and an inclusive number of days. */
export function gracePeriodEndFromDays(startDate: string, days: number): string {
  if (!isValidGraceDateKey(startDate) || !Number.isInteger(days) || days < 1) return "";
  return addDaysToGraceDateKey(startDate, days - 1);
}

export function normalizeGracePeriodRange(value: unknown): GracePeriodRange | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const startDate = graceDateKey(raw.startDate as DateInput);
  const endDate = graceDateKey(raw.endDate as DateInput);
  if (!startDate || !endDate || endDate < startDate) return null;
  if (raw.cancelledAt) return null;
  return {
    ...(typeof raw.id === "string" && raw.id ? { id: raw.id } : {}),
    startDate,
    endDate,
  };
}

/** Active (non-cancelled) periods, validated and sorted by start date. */
export function normalizeGracePeriodRanges(value: unknown): GracePeriodRange[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeGracePeriodRange)
    .filter((period): period is GracePeriodRange => Boolean(period))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
}

export function isDateInGracePeriod(period: GracePeriodRange, dateKey: string): boolean {
  return Boolean(dateKey) && dateKey >= period.startDate && dateKey <= period.endDate;
}

/** The period that covers the exam date, if any. */
export function findStudentGracePeriod(
  periods: readonly GracePeriodRange[] | null | undefined,
  examDate: DateInput,
): GracePeriodRange | null {
  const dateKey = graceDateKey(examDate);
  if (!dateKey || !periods?.length) return null;
  for (const period of periods) {
    if (isDateInGracePeriod(period, dateKey)) return period;
  }
  return null;
}

/**
 * القاعدة الوحيدة: الطالب مجاز بسبب فترة السماح إذا كان تاريخ الامتحان
 * >= بداية الفترة و <= نهايتها. لا يعتمد القرار على تاريخ إدخال الدرجة أو
 * تعديلها أو مزامنتها أو من أدخلها أو أي ملاحظة نصية.
 */
export function isStudentInGracePeriod(
  periods: readonly GracePeriodRange[] | null | undefined,
  examDate: DateInput,
): boolean {
  return findStudentGracePeriod(periods, examDate) !== null;
}

export function findExamGracePeriod(
  student: StudentGracePeriodsLike | null | undefined,
  exam: { date?: DateInput } | null | undefined,
): GracePeriodRange | null {
  return findStudentGracePeriod(student?.gracePeriods, exam?.date);
}

export function isExamInStudentGracePeriod(
  student: StudentGracePeriodsLike | null | undefined,
  exam: { date?: DateInput } | null | undefined,
): boolean {
  return findExamGracePeriod(student, exam) !== null;
}

export function gracePeriodsOverlap(
  a: Pick<GracePeriodRange, "startDate" | "endDate">,
  b: Pick<GracePeriodRange, "startDate" | "endDate">,
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export type GracePeriodState = "current" | "past";

/** Current while today is on or before the last day; past afterwards. */
export function gracePeriodState(period: GracePeriodRange, todayKey: string): GracePeriodState {
  return todayKey && period.endDate < todayKey ? "past" : "current";
}

export type GracePeriodListFilter = "all" | GracePeriodState;

/** Smart filter of the grace list in «إدارة فترة السماح». */
export const GRACE_PERIOD_LIST_FILTERS: ReadonlyArray<{ value: GracePeriodListFilter; label: string }> = [
  { value: "all", label: "فترات السماح (الكل)" },
  { value: "current", label: "فترات السماح (المستمرة)" },
  { value: "past", label: "فترات السماح (المنتهية)" },
];

export function normalizeGracePeriodListFilter(value: unknown): GracePeriodListFilter {
  return value === "current" || value === "past" ? value : "all";
}

/** Days left counting today; 0 once the period has ended. */
export function graceDaysRemaining(period: Pick<GracePeriodRange, "startDate" | "endDate">, todayKey: string): number {
  if (!isValidGraceDateKey(todayKey) || period.endDate < todayKey) return 0;
  const from = period.startDate > todayKey ? period.startDate : todayKey;
  return gracePeriodDays({ startDate: from, endDate: period.endDate });
}

/** «آخر يوم اليوم» / «متبقي 3 أيام» / «منتهية». */
export function describeGraceRemaining(period: Pick<GracePeriodRange, "startDate" | "endDate">, todayKey: string): string {
  const left = graceDaysRemaining(period, todayKey);
  if (left === 0) return "منتهية";
  if (period.startDate > todayKey) return `تبدأ ${formatGraceDate(period.startDate)}`;
  if (left === 1) return "آخر يوم اليوم";
  return `متبقي ${formatGraceDays(left)}`;
}

export function formatGraceDate(key: string): string {
  const match = key.match(DATE_KEY_PATTERN);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

export function formatGracePeriod(period: Pick<GracePeriodRange, "startDate" | "endDate">): string {
  return `${formatGraceDate(period.startDate)} → ${formatGraceDate(period.endDate)}`;
}

export function formatGraceDays(days: number): string {
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومان";
  if (days >= 3 && days <= 10) return `${days} أيام`;
  return `${days} يوماً`;
}

/** «هذا الامتحان مستبعد من المحاسبة بسبب فترة سماح 25/09 → 28/09» */
export function describeExamGraceExclusion(period: GracePeriodRange): string {
  return `هذا الامتحان مستبعد من المحاسبة بسبب فترة سماح ${formatGracePeriod(period)}`;
}

export type GracePeriodInputError = string;

/**
 * Validation shared by the management screen and its API. A period is a
 * concrete, already-started window: no hidden starts and no upcoming periods.
 */
export function validateGracePeriodInput(args: {
  startDate: unknown;
  endDate: unknown;
  todayKey: string;
  existing?: readonly GracePeriodRange[];
  ignoreId?: string;
}): GracePeriodInputError {
  const { startDate, endDate, todayKey } = args;
  if (!isValidGraceDateKey(startDate)) return "حدد تاريخ بداية فترة السماح بشكل صحيح.";
  if (!isValidGraceDateKey(endDate)) return "حدد تاريخ نهاية فترة السماح بشكل صحيح.";
  if (endDate < startDate) return "تاريخ النهاية لا يمكن أن يسبق تاريخ البداية.";
  if (todayKey && startDate > todayKey) {
    return "لا يمكن أن تبدأ فترة السماح في يوم قادم. اختر اليوم أو تاريخاً سابقاً.";
  }
  const days = gracePeriodDays({ startDate, endDate });
  if (days > MAX_GRACE_PERIOD_DAYS) {
    return `فترة السماح لا تتجاوز ${MAX_GRACE_PERIOD_DAYS} يوماً.`;
  }
  const overlap = (args.existing || []).some((period) =>
    period.id !== args.ignoreId && gracePeriodsOverlap(period, { startDate, endDate }),
  );
  if (overlap) {
    return "يوجد للطالب فترة سماح تتداخل مع الفترة المحددة. يرجى تعديل الفترة الموجودة بدلاً من إنشاء فترة جديدة.";
  }
  return "";
}
