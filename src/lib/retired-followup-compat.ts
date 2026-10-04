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

// Stored action names stay as they are; people read one name per action:
// «إرجاع الطالب» for bringing a dismissed student back, «فرص» for what he holds.
const DISPLAYED_ACTIONS: Record<string, string> = {
  [RETIRED_REACTIVATION_ACTION]: "فرص الإرجاع",
  "رصيد إعادة التفعيل": "فرص الإرجاع",
  "إعادة تفعيل": "إرجاع الطالب",
};

export function displayOpportunityAction(value: unknown): string {
  const action = String(value ?? "").trim();
  return DISPLAYED_ACTIONS[action] ?? action;
}

export function displayOpportunityReason(value: unknown): string {
  return displayReasonText(value)
    // «تثبيت إعادة التفعيل بعد تعهد الطالب» would otherwise read «… بعد
    // إعادة التفعيل الطالب» after the swaps below.
    .replaceAll("تثبيت إعادة التفعيل بعد تعهد الطالب", "تثبيت الإرجاع")
    .replaceAll(RETIRED_FOLLOWUP_NOTE_KIND, "الإرجاع")
    .replaceAll("بعد التعهد", "بعد الإرجاع")
    .replaceAll("بعد تعهد", "بعد الإرجاع")
    .replaceAll("تعهد أول", "إرجاع أول")
    .replaceAll("تعهد ثانٍ", "إرجاع ثاني")
    .replaceAll("رصيد إعادة التفعيل", "فرص الإرجاع")
    .replaceAll("إعادة التفعيل", "الإرجاع")
    .replaceAll("استعادة بقرار الإدارة", "إرجاع بقرار الإدارة")
    .replaceAll("رصيد الفرص", "الفرص")
    .replaceAll("برصيد فرصتين", "بفرصتين")
    .replaceAll("برصيد فرصة", "بفرصة")
    .replaceAll("برصيد ", "بـ")
    .replaceAll("الرصيد", "الفرص");
}
