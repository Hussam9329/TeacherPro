import { baghdadDateKey } from "@/lib/baghdad-time";

export const AUTOMATIC_NEW_STUDENT_GRACE_DAYS = 3;
export const MAX_MANUAL_STUDENT_GRACE_DAYS = 30;

export type GracePeriodStartMode = "registration" | "now";

export type StudentGraceLike = {
  createdAt?: Date | string | null;
  accountingGraceDays?: number | string | null;
  gracePeriodStartDate?: Date | string | null;
  gracePeriodEndedAt?: Date | string | null;
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
  return isDateWithinStudentGraceWindow(student, exam.date);
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
