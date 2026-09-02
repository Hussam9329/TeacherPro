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
  return String(value ?? "")
    .replaceAll(RETIRED_FOLLOWUP_NOTE_KIND, "إعادة التفعيل")
    .replaceAll("بعد التعهد", "بعد إعادة التفعيل")
    .replaceAll("بعد تعهد", "بعد إعادة التفعيل")
    .replaceAll("تعهد أول", "إعادة تفعيل أولى")
    .replaceAll("تعهد ثانٍ", "إعادة تفعيل ثانية");
}
