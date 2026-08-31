import { normalizeListFilter } from "@/lib/all-filter";

export const CALL_STUDENT_NOTE_CATEGORY = "call-student-note";

export type CallNotesFilter = "all" | "with-notes";

export function normalizeCallNotesFilter(
  value: string | null,
): CallNotesFilter {
  return normalizeListFilter(value) === "with-notes" ? "with-notes" : "all";
}

export function hasManualCallNote(call: {
  category: string;
  notes: string | null | undefined;
}): boolean {
  return (
    call.category === CALL_STUDENT_NOTE_CATEGORY &&
    Boolean(String(call.notes || "").trim())
  );
}
