import {
  normalizePhoneForDuplicate,
  normalizeStudentName,
  normalizeTelegramIdentifier,
} from "@/lib/student-utils";

/**
 * An existing student a bulk-import row duplicates (same name or same phone),
 * as the preview returns it, so the row can be compared field by field and
 * the student moved to the row's course by hand.
 */
export type BulkDuplicateMatch = {
  id: string;
  code: string;
  name: string;
  status: string;
  phone: string | null;
  parentPhone: string | null;
  telegram: string | null;
  username: string | null;
  school: string;
  gender: string;
  courseId: string;
  courseName: string;
  courseProgram: string | null;
  courseTerm: string | null;
  studyType: string | null;
  locationScope: string | null;
  subSite: string | null;
};

export type BulkDuplicateIncoming = {
  name: string;
  phone?: string | null;
  parentPhone?: string | null;
  telegram?: string | null;
  school?: string | null;
  gender?: string | null;
};

export type BulkDuplicateField = {
  key: "name" | "phone" | "parentPhone" | "telegram" | "school" | "gender";
  label: string;
  current: string;
  incoming: string;
  /** 1 same, 0 different, between: partly the same; null when a side is empty. */
  score: number | null;
};

const words = (value: string | null | undefined) =>
  normalizeStudentName(value).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** Name: the words in the same place, out of the longer name. */
function nameScore(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  const longest = Math.max(left.length, right.length);
  if (!longest) return 0;
  let same = 0;
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) if (left[i] === right[i]) same += 1;
  return same / longest;
}

/** School: the shared words, in any order, out of the longer name. */
function schoolScore(a: string, b: string): number {
  const left = new Set(words(a));
  const right = new Set(words(b));
  const longest = Math.max(left.size, right.size);
  if (!longest) return 0;
  let same = 0;
  left.forEach((word) => { if (right.has(word)) same += 1; });
  return same / longest;
}

const text = (value: string | null | undefined) => String(value ?? "").trim();

/** 07703749556, 7703749556 and 009647703749556 are one number. */
const nationalPhone = (value: string) => normalizePhoneForDuplicate(value).replace(/\D/g, "").replace(/^(?:00964|964|0)/, "");

function exact(current: string, incoming: string, normalize: (value: string) => string): number | null {
  const left = normalize(current);
  const right = normalize(incoming);
  if (!left || !right) return null;
  return left === right ? 1 : 0;
}

/** Field-by-field comparison and the overall percentage of the compared fields. */
export function compareBulkDuplicate(incoming: BulkDuplicateIncoming, match: BulkDuplicateMatch): {
  fields: BulkDuplicateField[];
  percent: number;
} {
  const currentHandle = text(match.username) || text(match.telegram);
  const incomingTelegram = normalizeTelegramIdentifier(incoming.telegram);
  const telegramScore = !incomingTelegram || (!text(match.username) && !text(match.telegram))
    ? null
    : [match.username, match.telegram].some((value) => normalizeTelegramIdentifier(value) === incomingTelegram) ? 1 : 0;
  const fields: BulkDuplicateField[] = [
    {
      key: "name",
      label: "الاسم",
      current: match.name,
      incoming: incoming.name,
      score: text(match.name) && text(incoming.name) ? nameScore(match.name, incoming.name) : null,
    },
    {
      key: "phone",
      label: "رقم الطالب",
      current: text(match.phone),
      incoming: text(incoming.phone),
      score: exact(text(match.phone), text(incoming.phone), nationalPhone),
    },
    {
      key: "parentPhone",
      label: "رقم ولي الأمر",
      current: text(match.parentPhone),
      incoming: text(incoming.parentPhone),
      score: exact(text(match.parentPhone), text(incoming.parentPhone), nationalPhone),
    },
    {
      key: "telegram",
      label: "التليگرام",
      current: currentHandle,
      incoming: text(incoming.telegram),
      score: telegramScore,
    },
    {
      key: "school",
      label: "المدرسة",
      current: text(match.school),
      incoming: text(incoming.school),
      score: text(match.school) && text(incoming.school) ? schoolScore(match.school, incoming.school ?? "") : null,
    },
    {
      key: "gender",
      label: "الجنس",
      current: text(match.gender),
      incoming: text(incoming.gender),
      score: exact(text(match.gender), text(incoming.gender), (value) => value),
    },
  ];
  const compared = fields.filter((field) => field.score !== null);
  const percent = compared.length
    ? Math.round((compared.reduce((sum, field) => sum + (field.score ?? 0), 0) / compared.length) * 100)
    : 0;
  return { fields, percent };
}

/** The course fields a bulk row carries into «تعديل الطالب» for a manual transfer. */
export type BulkTransferCourse = {
  courseId: string;
  courseProgram: string;
  courseTerm: string;
  studyType: string;
  locationScope: string;
  baghdadMode: string;
  subSite: string;
};

export const BULK_TRANSFER_STUDENT_PARAM = "edit-student";
export const BULK_TRANSFER_COURSE_PARAM = "edit-course";

/** The «سجل الطلاب» link that opens «تعديل الطالب» with the row's course filled in. */
export function bulkTransferHref(studentId: string, course: BulkTransferCourse): string {
  const params = new URLSearchParams({
    section: "student-registry",
    [BULK_TRANSFER_STUDENT_PARAM]: studentId,
    [BULK_TRANSFER_COURSE_PARAM]: JSON.stringify(course),
  });
  return `/?${params}`;
}

/** Reads that link back; null when it is missing or malformed. */
export function readBulkTransferIntent(search: string): { studentId: string; course: BulkTransferCourse } | null {
  const params = new URLSearchParams(search);
  const studentId = text(params.get(BULK_TRANSFER_STUDENT_PARAM));
  if (!studentId || studentId.length > 128) return null;
  try {
    const raw = JSON.parse(params.get(BULK_TRANSFER_COURSE_PARAM) || "null") as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || typeof raw.courseId !== "string" || !raw.courseId) return null;
    const field = (key: keyof BulkTransferCourse) => (typeof raw[key] === "string" ? String(raw[key]).slice(0, 200) : "");
    return {
      studentId,
      course: {
        courseId: field("courseId"),
        courseProgram: field("courseProgram"),
        courseTerm: field("courseTerm"),
        studyType: field("studyType"),
        locationScope: field("locationScope"),
        baghdadMode: field("baghdadMode"),
        subSite: field("subSite"),
      },
    };
  } catch {
    return null;
  }
}
