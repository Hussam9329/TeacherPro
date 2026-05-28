import { sanitizePhoneInput, toLatinDigits } from './format';

export interface StudentDuplicateCandidate {
  id?: string;
  name?: string;
  phone?: string;
  telegram?: string;
}

export function normalizeStudentName(value: string | undefined | null): string {
  return toLatinDigits(String(value ?? '')).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function sanitizeTelegramInput(value: string): string {
  return toLatinDigits(value).replace(/@/g, '').trim();
}

export function normalizeTelegramIdentifier(value: string | undefined | null): string {
  return sanitizeTelegramInput(String(value ?? '')).replace(/\s+/g, '').toLowerCase();
}

export function normalizePhoneForDuplicate(value: string | undefined | null): string {
  return sanitizePhoneInput(String(value ?? ''));
}

export function getStudentDuplicateMessage(
  students: StudentDuplicateCandidate[],
  candidate: StudentDuplicateCandidate,
  excludeId?: string,
): string | null {
  const candidateTelegram = normalizeTelegramIdentifier(candidate.telegram);
  const candidatePhone = normalizePhoneForDuplicate(candidate.phone);
  const candidateName = normalizeStudentName(candidate.name);

  const duplicate = students.find((student) => {
    if (excludeId && student.id === excludeId) return false;
    const sameTelegram = candidateTelegram && normalizeTelegramIdentifier(student.telegram) === candidateTelegram;
    const samePhone = candidatePhone && normalizePhoneForDuplicate(student.phone) === candidatePhone;
    const sameName = candidateName && normalizeStudentName(student.name) === candidateName;
    return Boolean(sameTelegram || samePhone || sameName);
  });

  if (!duplicate) return null;
  if (candidateTelegram && normalizeTelegramIdentifier(duplicate.telegram) === candidateTelegram) {
    return 'لا يمكن إضافة الطالب: معرف التلكرام مسجل مسبقاً لطالب آخر';
  }
  if (candidatePhone && normalizePhoneForDuplicate(duplicate.phone) === candidatePhone) {
    return 'لا يمكن إضافة الطالب: رقم الهاتف مسجل مسبقاً لطالب آخر';
  }
  if (candidateName && normalizeStudentName(duplicate.name) === candidateName) {
    return 'لا يمكن إضافة الطالب: الاسم الرباعي مسجل مسبقاً لطالب آخر';
  }
  return 'لا يمكن إضافة الطالب بسبب وجود بيانات مكررة';
}

export function isValidAccountingGraceDays(value: string): boolean {
  return /^(?:[0-9]|[12][0-9]|30)$/.test(toLatinDigits(value).trim());
}
