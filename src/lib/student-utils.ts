import { sanitizePhoneInput, toLatinDigits } from './format';

const studentArabicMarks = /[\u064B-\u065F\u0670]/g;
const studentHamzaMap: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ؤ: 'و',
  ئ: 'ي',
  ة: 'ه',
  ى: 'ي',
};

export interface StudentDuplicateCandidate {
  id?: string;
  name?: string | null;
  phone?: string | null;
  telegram?: string | null;
}

export function normalizeStudentName(value: string | undefined | null): string {
  return toLatinDigits(String(value ?? ''))
    .toLocaleLowerCase('ar-IQ')
    .normalize('NFKD')
    .replace(studentArabicMarks, '')
    .replace(/[أإآٱؤئىة]/g, (char) => studentHamzaMap[char] ?? char)
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeStudentUniqueText(value: string | undefined | null): string | null {
  const normalized = normalizeStudentName(value);
  return normalized || null;
}

export function sanitizeTelegramInput(value: string | null | undefined): string {
  return toLatinDigits(value).replace(/@/g, '').trim();
}

export function normalizeTelegramIdentifier(value: string | undefined | null): string {
  return sanitizeTelegramInput(String(value ?? '')).replace(/\s+/g, '').toLowerCase();
}

export function normalizePhoneForDuplicate(value: string | undefined | null): string {
  return sanitizePhoneInput(String(value ?? ''));
}

export function getStudentUniqueKeys(candidate: StudentDuplicateCandidate): {
  nameKey: string | null;
  phoneKey: string | null;
  telegramKey: string | null;
} {
  return {
    nameKey: normalizeStudentUniqueText(candidate.name),
    phoneKey: normalizePhoneForDuplicate(candidate.phone) || null,
    telegramKey: normalizeTelegramIdentifier(candidate.telegram) || null,
  };
}

export function getStudentDuplicateMessage(
  students: StudentDuplicateCandidate[],
  candidate: StudentDuplicateCandidate,
  excludeId?: string,
  /** «edit» when an existing student's data is being changed, not a student added. */
  action: "add" | "edit" = "add",
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
  if (action === "edit") {
    // Changing a student: say the change was not saved, and whose it is.
    const owner = duplicate.name ? ` «${duplicate.name}»` : " ثاني";
    if (candidateTelegram && normalizeTelegramIdentifier(duplicate.telegram) === candidateTelegram) {
      return `ما انحفظ التعديل: معرف التيليجرام مسجّل للطالب${owner}.`;
    }
    if (candidatePhone && normalizePhoneForDuplicate(duplicate.phone) === candidatePhone) {
      return `ما انحفظ التعديل: رقم الهاتف مسجّل للطالب${owner}.`;
    }
    if (candidateName && normalizeStudentName(duplicate.name) === candidateName) {
      return "ما انحفظ التعديل: الاسم الرباعي مسجّل لطالب ثاني.";
    }
    return "ما انحفظ التعديل: بياناته مكررة ويه طالب ثاني.";
  }
  if (candidateTelegram && normalizeTelegramIdentifier(duplicate.telegram) === candidateTelegram) {
    return 'لا يمكن إضافة الطالب: معرف التيليجرام مسجل مسبقاً لطالب آخر';
  }
  if (candidatePhone && normalizePhoneForDuplicate(duplicate.phone) === candidatePhone) {
    return 'لا يمكن إضافة الطالب: رقم الهاتف مسجل مسبقاً لطالب آخر';
  }
  if (candidateName && normalizeStudentName(duplicate.name) === candidateName) {
    return 'لا يمكن إضافة الطالب: الاسم الرباعي مسجل مسبقاً لطالب آخر';
  }
  return 'لا يمكن إضافة الطالب بسبب وجود بيانات مكررة';
}
