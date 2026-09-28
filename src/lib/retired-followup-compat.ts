import { displayReasonText } from "@/lib/reason-display";

/**
 * Read-only compatibility marker for records created by the retired follow-up
 * feature. New writes are rejected and these records stay outside operational
 * lists while historical database backups remain recoverable.
 */
export const RETIRED_FOLLOWUP_NOTE_KIND = "تعهد ولي الأمر";
const RETIRED_REACTIVATION_ACTION = "رصيد بعد تعهد";

export function isRetiredFollowupNote(note: { kind?: unknown }): boolean {
  return String(note.kind ?? "").trim() === RETIRED_FOLLOWUP_NOTE_KIND;
}

export function displayOpportunityAction(value: unknown): string {
  const action = String(value ?? "").trim();
  return action === RETIRED_REACTIVATION_ACTION
    ? "رصيد إعادة التفعيل"
    : action;
}

export function displayOpportunityReason(value: unknown): string {
  return displayReasonText(value)
    // «تثبيت إعادة التفعيل بعد تعهد الطالب» would otherwise read «… بعد
    // إعادة التفعيل الطالب» after the swaps below.
    .replaceAll("تثبيت إعادة التفعيل بعد تعهد الطالب", "تثبيت إعادة التفعيل")
    .replaceAll(RETIRED_FOLLOWUP_NOTE_KIND, "إعادة التفعيل")
    .replaceAll("بعد التعهد", "بعد إعادة التفعيل")
    .replaceAll("بعد تعهد", "بعد إعادة التفعيل")
    .replaceAll("تعهد أول", "إعادة تفعيل أولى")
    .replaceAll("تعهد ثانٍ", "إعادة تفعيل ثانية");
}
