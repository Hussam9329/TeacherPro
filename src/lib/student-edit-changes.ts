import { baghdadDateKey } from "@/lib/baghdad-time";
import { STUDENT_EDIT_CHANGES_MARKER, STUDENT_EDIT_CHANGE_SEPARATOR } from "@/lib/student-story-audit";
import { storyDay } from "@/lib/student-story-format";

const EDITABLE_FIELDS: Array<[string, string]> = [
  ["name", "الاسم"],
  ["phone", "رقم الطالب"],
  ["parentPhone", "رقم ولي الأمر"],
  ["telegram", "معرف تيليجرام"],
  ["username", "يوزر تيليجرام"],
  ["school", "المدرسة"],
  ["gender", "الجنس"],
  ["locationScope", "الموقع"],
  ["mainSite", "المحافظة"],
  ["subSite", "المنطقة"],
  ["studyType", "نظام الدراسة"],
  ["courseProgram", "نظام الاشتراك"],
  ["courseTerm", "الكورس المطلوب"],
];

function clean(value: unknown): string {
  return String(value ?? "").replace(/[؛|]/g, "،").replace(/\s+/g, " ").trim();
}

/** «رقم ولي الأمر: 0770… ← 0771…» for each field a student edit changed. */
export function studentEditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const changes: string[] = [];
  for (const [field, label] of EDITABLE_FIELDS) {
    const from = clean(before[field]);
    const to = clean(after[field]);
    if (from !== to) changes.push(`${label}: ${from || "فارغ"} ← ${to || "فارغ"}`);
  }
  const fromDay = baghdadDateKey(before.createdAt as string | Date | null | undefined);
  const toDay = baghdadDateKey(after.createdAt as string | Date | null | undefined);
  if (fromDay && toDay && fromDay !== toDay) {
    changes.push(`تاريخ التسجيل: ${storyDay(fromDay)} ← ${storyDay(toDay)}`);
  }
  return changes;
}

/** The suffix a student edit appends to its audit details. */
export function studentEditChangesSuffix(changes: string[]): string {
  return changes.length ? `${STUDENT_EDIT_CHANGES_MARKER}${changes.join(STUDENT_EDIT_CHANGE_SEPARATOR)}` : "";
}
