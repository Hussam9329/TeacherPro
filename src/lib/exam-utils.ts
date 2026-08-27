import { baghdadDateKey, baghdadTodayKey, parseBaghdadDateTime } from './baghdad-time';
import { MAIN_SITE_OPTIONS, normalizeIraqiProvinceName } from './iraq';
import {
  getStudentGraceWindow,
  isExamWithinStudentGraceWindow,
  normalizeGraceDays,
  type ExamDateLike as UnifiedExamDateLike,
  type StudentGraceLike as UnifiedStudentGraceLike,
} from './student-grace';

export type ExamLike = {
  active: boolean;
  date?: string | Date | null;
  scheduledActivateAt?: string | Date | null;
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
  createdAt?: string | Date | null;
};

export type ExamStatusLabel = 'نشط' | 'تفعيل مجدول' | 'معطل';

export type ExamEntryAvailabilityCode =
  | 'available'
  | 'scheduled-activation'
  | 'inactive'
  | 'future-exam-date';

export type ExamEntryAvailability = {
  available: boolean;
  code: ExamEntryAvailabilityCode;
  reason: string;
};


export type { ExamDateLike, StudentGraceLike } from './student-grace';
export { getStudentGraceWindow, normalizeGraceDays };

export function isExamWithinStudentGracePeriod(
  student: UnifiedStudentGraceLike,
  exam: UnifiedExamDateLike,
): boolean {
  return isExamWithinStudentGraceWindow(student, exam);
}

export function splitSelection(value?: string | null): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDateOnly(value?: string | Date | null): Date | null {
  if (!value) return null;
  const key = baghdadDateKey(value);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isExamOnOrAfterStudentRegistration(student: StudentRegistrationLike, exam: UnifiedExamDateLike): boolean {
  const registeredAt = parseDateOnly(student.createdAt);
  const examDate = parseDateOnly(exam.date);
  if (!registeredAt || !examDate) return true;
  return examDate >= registeredAt;
}

export function getExamStatus(exam: ExamLike, now = new Date()): ExamStatusLabel {
  const activateAt = parseBaghdadDateTime(exam.scheduledActivateAt);

  // A future activation is authoritative even if a stale client also sent active=true.
  if (activateAt && activateAt > now) return 'تفعيل مجدول';

  const effectivelyActive = Boolean(exam.active || (activateAt && activateAt <= now));
  if (!effectivelyActive) return 'معطل';
  return 'نشط';
}

export function getExamEntryAvailability(exam: ExamLike, now = new Date()): ExamEntryAvailability {
  const status = getExamStatus(exam, now);
  if (status === 'تفعيل مجدول') {
    return {
      available: false,
      code: 'scheduled-activation',
      reason: 'الامتحان مفعّل بجدولة مستقبلية ولم يحن وقت التفعيل بعد.',
    };
  }
  if (status === 'معطل') {
    return {
      available: false,
      code: 'inactive',
      reason: 'الامتحان معطل ولا يقبل درجات حالياً.',
    };
  }

  const examDay = baghdadDateKey(exam.date);
  const today = baghdadTodayKey(now);
  if (examDay && today && examDay > today) {
    return {
      available: false,
      code: 'future-exam-date',
      reason: `تاريخ الامتحان ${examDay} لم يحن بعد بتوقيت بغداد.`,
    };
  }

  return { available: true, code: 'available', reason: 'الامتحان متاح لإدخال الدرجات.' };
}

export function isExamAvailableForEntry(exam: ExamLike, now = new Date()): boolean {
  return getExamEntryAvailability(exam, now).available;
}

export function hasActiveChapterLink(
  courseChapters: Array<{ courseId: string; active: boolean; archived: boolean }>,
  courseId: string,
): boolean {
  return courseChapters.some((link) => link.courseId === courseId && link.active && !link.archived);
}

export function normalizeExamSiteValue(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, ' ');
  if (compact === 'الكل') return 'الكل';
  if (compact === 'اونلاين' || compact === 'إونلاين' || compact === 'الكتروني' || compact === 'إلكتروني') return 'أونلاين';
  if (compact.startsWith('خارج القطر')) return 'خارج القطر';
  if (compact === 'اربيل') return 'أربيل';
  if (compact === 'الانبار') return 'الأنبار';
  if (compact === 'البصره') return 'البصرة';
  if (compact === 'الديوانيه') return 'الديوانية';
  return normalizeIraqiProvinceName(compact);
}

const EXAM_SITE_STORAGE_ALIASES: Record<string, string[]> = {
  'أونلاين': ['أونلاين', 'اونلاين', 'إونلاين', 'الكتروني', 'إلكتروني'],
  'أربيل': ['أربيل', 'اربيل'],
  'الأنبار': ['الأنبار', 'الانبار'],
  'البصرة': ['البصرة', 'البصره'],
  'الديوانية': ['الديوانية', 'الديوانيه', 'القادسية'],
  'الناصرية': ['الناصرية', 'ذي قار'],
};

/**
 * Returns every legacy spelling that may still be stored for an exam site.
 * Database filters cannot call normalizeExamSiteValue for each row, so the
 * API uses this list to keep pagination/count/export aligned with the exact
 * in-memory academic-engine matcher.
 */
export function examSiteDatabaseValues(selectedMainSites: string[]): string[] {
  return Array.from(
    new Set(
      selectedMainSites.flatMap((site) => {
        const raw = String(site || '').trim();
        const normalized = normalizeExamSiteValue(raw);
        return [raw, normalized, ...(EXAM_SITE_STORAGE_ALIASES[normalized] || [])];
      }).filter(Boolean),
    ),
  );
}

export function includesOutsideCountryExamSite(selectedMainSites: string[]): boolean {
  return selectedMainSites.some(
    (site) => normalizeExamSiteValue(site) === 'خارج القطر',
  );
}

export function isAllMainSitesSelection(selectedMainSites: string[]): boolean {
  const normalizedSelection = new Set(selectedMainSites.map(normalizeExamSiteValue).filter(Boolean));
  if (normalizedSelection.size === 0 || normalizedSelection.has('الكل')) return true;

  const normalizedAllSites = MAIN_SITE_OPTIONS.map(normalizeExamSiteValue).filter(Boolean);
  return normalizedAllSites.every((site) => normalizedSelection.has(site));
}

export function studentMatchesExamMainSites(student: StudentSiteLike, selectedMainSites: string[]): boolean {
  if (isAllMainSitesSelection(selectedMainSites)) return true;
  const values = new Set([
    student.mainSite,
    student.subSite,
    student.locationScope,
  ].map((value) => normalizeExamSiteValue(value)).filter(Boolean));
  return selectedMainSites.some((site) => values.has(normalizeExamSiteValue(site)));
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
  return ['غائب', 'غش', 'مجاز', 'ضمن فترة السماح', 'قبل تسجيل الطالب'].includes(String(grade.status || ''));
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
