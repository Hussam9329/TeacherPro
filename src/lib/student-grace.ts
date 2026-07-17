import { baghdadDateKey } from "@/lib/baghdad-time";

export const AUTOMATIC_NEW_STUDENT_GRACE_DAYS = 3;
export const MAX_MANUAL_STUDENT_GRACE_DAYS = 30;

export type GracePeriodStartMode = "registration" | "now";

export type StudentGraceLike = {
  createdAt?: Date | string | null;
  accountingGraceDays?: number | string | null;
  gracePeriodStartDate?: Date | string | null;
};

export type ExamDateLike = {
  date?: Date | string | null;
};

export type StudentGraceWindow = {
  start: Date;
  endExclusive: Date;
  days: number;
  source: "automatic" | "manual";
};

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
  return value === "registration" || value === "now" ? value : "";
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
  return Number.isFinite(date.getTime()) ? date : null;
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
  return isDateWithinStudentGraceWindow(student, exam.date);
}

export function isStudentCurrentlyInGrace(
  student: StudentGraceLike,
  now: Date = new Date(),
): boolean {
  return isDateWithinStudentGraceWindow(student, now);
}
