/**
 * Stored opportunity and dismissal reasons keep the markers the calculation
 * depends on («تلقائي:», [zero-balance-violation], [undo-ref:…],
 * [academic-reactivation-link:…], the balance brackets). People see the same
 * reason without them. Display only: never use the result for logic, and
 * never write it back.
 */

const BALANCE_CLAMP_MARKER =
  /\s*\[مطلوب:\s*([^،\]]+?)،\s*مطبّق:\s*([^،\]]+?)،\s*قبل:\s*([^→\]]+?)\s*→\s*بعد:\s*([^\]]+?)\]/gu;
const BALANCE_RESET_MARKER =
  /\s*\[قبل:\s*([^→\]]+?)\s*→\s*بعد:\s*([^،\]]+?)(?:،\s*فرق:\s*[^\]]*)?\]/gu;
const ZERO_BALANCE_MARKER = /\s*\[zero-balance-violation\]/gu;
const HIDDEN_MARKERS = /\s*\[(?:undo-ref|academic-[a-z-]+):[^\]]*\]/gu;
const AUTOMATIC_PREFIX = /^\s*تلقائي:\s*/u;

export function displayReasonText(value: unknown): string {
  return String(value ?? "")
    .replace(AUTOMATIC_PREFIX, "")
    .replace(
      BALANCE_CLAMP_MARKER,
      (_match, requested: string, applied: string, before: string, after: string) =>
        ` (المطلوب ${requested.trim()}، المطبّق ${applied.trim()}، الرصيد من ${before.trim()} إلى ${after.trim()})`,
    )
    .replace(
      BALANCE_RESET_MARKER,
      (_match, before: string, after: string) =>
        ` (الرصيد من ${before.trim()} إلى ${after.trim()})`,
    )
    .replace(ZERO_BALANCE_MARKER, " (خصم والرصيد صفر)")
    .replace(HIDDEN_MARKERS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
