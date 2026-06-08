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

export type ExamStatusLabel = 'نشط' | 'تفعيل مجدول' | 'تعطيل مجدول' | 'معطل';

export function splitSelection(value?: string | null): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasFutureDate(value?: string | null, now = new Date()): boolean {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date > now;
}

export function getExamStatus(exam: ExamLike, now = new Date()): ExamStatusLabel {
  if (!exam.active && hasFutureDate(exam.scheduledActivateAt, now)) return 'تفعيل مجدول';
  if (exam.active && hasFutureDate(exam.scheduledDeactivateAt, now)) return 'تعطيل مجدول';
  return exam.active ? 'نشط' : 'معطل';
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

export function isGradeEntered(grade: GradeLike, exam?: ExamForGradeRange | null): boolean {
  if (!grade || !exam) return false;
  if (grade.status === 'درجة') return isScoreInsideExamRange(grade.score, exam.fullMark);
  return ['غائب', 'مجاز', 'غش'].includes(String(grade.status || ''));
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
