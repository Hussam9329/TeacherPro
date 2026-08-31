import { normalizeListFilter } from "@/lib/all-filter";

export type ContactStatus = "" | "تم الاتصال" | "لم يرد" | "الرقم خاطئ";

export type ContactStatusFilter =
  | "all"
  | "no-action"
  | "contacted"
  | "unanswered"
  | "wrong";

export function normalizeContactStatusFilter(
  value: string | null,
): ContactStatusFilter {
  const normalized = normalizeListFilter(value);
  if (
    normalized === "no-action" ||
    normalized === "contacted" ||
    normalized === "unanswered" ||
    normalized === "wrong"
  ) {
    return normalized;
  }
  return "all";
}

export function normalizeContactStatus(
  call: { status: string; completed: boolean } | undefined,
): ContactStatus {
  if (!call) return "";
  const value = String(call.status || "").trim();
  if (value === "تم الاتصال" || value === "لم يرد" || value === "الرقم خاطئ") {
    return value;
  }
  return call.completed ? "تم الاتصال" : "";
}

export function contactStatusMatchesFilter(
  filter: ContactStatusFilter,
  status: ContactStatus,
): boolean {
  if (filter === "all") return true;
  if (filter === "no-action") return status === "";
  if (filter === "contacted") return status === "تم الاتصال";
  if (filter === "unanswered") return status === "لم يرد";
  return status === "الرقم خاطئ";
}
