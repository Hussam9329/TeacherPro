export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withGradeEntryMissingNoteSchema } from "@/lib/grade-entry-missing-note-schema";

/**
 * إحصائيات ملاحظات الطلاب غير الموجودين.
 * لا تعتمد على localStorage ولا على أول 500 ملاحظة المعروضة في الصفحة.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "grades.view");
  if (authError) return authError;

  try {
    const notes = (await withGradeEntryMissingNoteSchema(() =>
      db.gradeEntryMissingNote.findMany({
        select: { examId: true, text: true },
      }),
    )) as Array<{ examId: string; text: string | null }>;

    return NextResponse.json({
      total: notes.length,
      examsWithNotes: new Set(notes.map((note) => note.examId)).size,
      totalCharacters: notes.reduce((sum, note) => sum + String(note.text || "").length, 0),
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل إحصائيات ملاحظات الطلاب غير الموجودين من قاعدة البيانات.");
  }
}
