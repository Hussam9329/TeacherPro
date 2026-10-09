import { Ban, CircleMinus, CirclePlus, FileText, Flag, RotateCcw, SlidersHorizontal, Star, Undo2, UserX } from "lucide-react";
import type { StaffOpportunityCategory } from "./export-dialog";

/** One icon per kind of row in a student's opportunities (staff windows). */
export const STAFF_ROW_ICONS: Record<StaffOpportunityCategory, typeof Star> = {
  exam: FileText,
  "exam-deduct": CircleMinus,
  "exam-dismissal": Ban,
  bonus: Star,
  "admin-add": CirclePlus,
  "admin-deduct": CircleMinus,
  undo: Undo2,
  "admin-dismissal": UserX,
  "chapter-start": Flag,
  return: RotateCcw,
  set: SlidersHorizontal,
};

/** An exam's effect note in the staff voice (the report speaks to the student). */
export function staffRowNote(note: string): string {
  return note
    .replace(/رصيدك/g, "رصيده")
    .replace(/رجعت لك/g, "رجعت للطالب")
    .replace(/وفُصلت/g, "وفُصل");
}
