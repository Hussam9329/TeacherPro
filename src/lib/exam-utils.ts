import { parseBaghdadDateTime } from './baghdad-time';

export type ExamLike = {
  active: boolean;
  scheduledActivateAt?: string | null;
  scheduledDeactivateAt?: string | null;
};

export type ExamForGradeRange = {
  fullMark: number;
};

export type GradeLike = {
  status?: string | null;
  score?: number | string | null;
} | null | undefined;

export type StudentSiteLike = {
  mainSite?: string | null;
  subSite?: string | null;
  locationScope?: string | null;
};

export type StudentRegistrationLike = {
  createdAt?: string | null;
};

export type ExamDateLike = {
  date?: string | null;
};

export type ExamStatusLabel = 'نشط' | 'تفعيل مجدول' | 'تعطيل مجدول' | 'معطل';


export type StudentGraceLike = {
  createdAt?: string | null;
  accountingGraceDays?: number | string | null;
};

export function normalizeGraceDays(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(30, Math.max(0, Math.trunc(numeric)));
}

export function getStudentGraceWindow(student: StudentGraceLike): { start: Date; endExclusive: Date; days: number } | null {
  const days = normalizeGraceDays(student.accountingGraceDays);
  if (days <= 0) return null;
  const start = parseDateOnly(student.createdAt);
  if (!start) return null;
  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + days);
  return { start, endExclusive, days };
}

export function isExamWithinStudentGracePeriod(student: StudentGraceLike, exam: ExamDateLike): boolean {
  const window = getStudentGraceWindow(student);
  const examDate = parseDateOnly(exam.date);
  if (!window || !examDate) return false;
  return examDate >= window.start && examDate < window.endExclusive;
}

export function splitSelection(value?: string | null): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null;
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isExamOnOrAfterStudentRegistration(student: StudentRegistrationLike, exam: ExamDateLike): boolean {
  const registeredAt = parseDateOnly(student.createdAt);
  const examDate = parseDateOnly(exam.date);
  if (!registeredAt || !examDate) return true;
  return examDate >= registeredAt;
}

export function getExamStatus(exam: ExamLike, now = new Date()): ExamStatusLabel {
  const activateAt = parseBaghdadDateTime(exam.scheduledActivateAt);
  const deactivateAt = parseBaghdadDateTime(exam.scheduledDeactivateAt);
  const activatedBySchedule = Boolean(activateAt && activateAt <= now);
  const effectivelyActive = Boolean(exam.active || activatedBySchedule);

  if (!effectivelyActive && activateAt && activateAt > now) return 'تفعيل مجدول';
  if (effectivelyActive && deactivateAt && deactivateAt > now) return 'تعطيل مجدول';
  if (effectivelyActive && deactivateAt && deactivateAt <= now) return 'معطل';
  return effectivelyActive ? 'نشط' : 'معطل';
}

export function isExamAvailableForEntry(exam: ExamLike, now = new Date()): boolean {
  const status = getExamStatus(exam, now);
  return status === 'نشط' || status === 'تعطيل مجدول';
}

export function hasActiveChapterLink(
  courseChapters: Array<{ courseId: string; active: boolean; archived: boolean }>,
  courseId: string,
): boolean {
  return courseChapters.some((link) => link.courseId === courseId && link.active && !link.archived);
}

export function studentMatchesExamMainSites(student: StudentSiteLike, selectedMainSites: string[]): boolean {
  if (selectedMainSites.length === 0) return true;
  const values = new Set([
    student.mainSite,
    student.subSite,
    student.locationScope,
  ].map((value) => String(value || '').trim()).filter(Boolean));
  return selectedMainSites.some((site) => values.has(site));
}

export function normalizeScore(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function isScoreInsideExamRange(value: unknown, fullMark: number): boolean {
  const numeric = normalizeScore(value);
  return numeric !== null && numeric >= 0 && numeric <= Number(fullMark || 0);
}


export function formatGradeScore(grade: GradeLike, exam?: ExamForGradeRange | null, emptyLabel = '—'): string {
  if (!grade) return emptyLabel;
  const status = String(grade.status || '');
  if (status === 'درجة') {
    const score = normalizeScore(grade.score);
    if (score === null) return emptyLabel;
    return exam ? `${score}/${Number(exam.fullMark || 0)}` : String(score);
  }
  if (status === 'غائب' || status === 'غش') return status;
  return status || emptyLabel;
}

export function isGradeEntered(grade: GradeLike, exam?: ExamForGradeRange | null): boolean {
  if (!grade || !exam) return false;
  if (grade.status === 'درجة') return isScoreInsideExamRange(grade.score, exam.fullMark);
  return ['غائب', 'غش'].includes(String(grade.status || ''));
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
