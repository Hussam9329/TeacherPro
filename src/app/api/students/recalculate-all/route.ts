export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Vercel Pro plan max

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { routeErrorResponse } from "@/lib/route-helpers";

/**
 * POST /api/students/recalculate-all?offset=0&limit=100
 *
 * Recalculates the academic state (opportunities, dismissal status,
 * automatic opportunity logs) for a batch of students. This is a
 * one-time maintenance endpoint to repair students whose state was
 * computed by the old client-only recalculation (which had bugs that
 * left opportunities inflated or dismissal status stale).
 *
 * Process:
 * 1. Fetch student IDs ordered by createdAt, skipping `offset` and
 *    taking `limit` (default 100, max 500).
 * 2. Skip archived students (they're frozen).
 * 3. Call recalculateStudentsAcademicState(studentIds) which:
 *    - Loads all related data (grades, exams, chapters, leaves, logs).
 *    - Runs recalculateAcademicState() on the engine.
 *    - Writes back diffs (student updates, new automatic logs, stale
 *      automatic log cleanup).
 * 4. Returns counts: totalInBatch, processed, changed, nextOffset
 *    (or null if done).
 *
 * Auth: requires students.edit permission (admin-only effectively).
 *
 * Usage: call repeatedly with increasing offset until nextOffset is
 * null. Each call processes up to `limit` students. For 2300 students
 * with limit=100, that's 23 calls.
 */
export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const offset = Math.max(0, Number(searchParams.get("offset") || 0));
    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") || 100)));

    // Fetch the batch of student IDs (excluding archived — they're frozen).
    const students = await db.student.findMany({
      where: { status: { not: "مؤرشف" } },
      select: { id: true, opportunities: true, baseOpportunities: true, status: true, dismissalType: true, dismissalReason: true },
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: limit,
    });

    if (students.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No more students to process.",
        totalInBatch: 0,
        processed: 0,
        changed: 0,
        nextOffset: null,
        done: true,
      });
    }

    // Snapshot before-recalc state so we can count how many changed.
    const beforeById = new Map(students.map((s) => [s.id, s]));

    const studentIds = students.map((s) => s.id);
    const result = await recalculateStudentsAcademicState(studentIds);

    // Count how many students actually changed.
    let changed = 0;
    const changes: Array<{
      id: string;
      field: string;
      before: unknown;
      after: unknown;
    }> = [];
    for (const afterStudent of result.students) {
      const before = beforeById.get(afterStudent.id);
      if (!before) continue;
      const fields: Array<keyof typeof before> = [
        "opportunities",
        "status",
        "dismissalType",
        "dismissalReason",
      ];
      let studentChanged = false;
      for (const field of fields) {
        const b = String(before[field] ?? "");
        const a = String((afterStudent as unknown as Record<string, unknown>)[field] ?? "");
        if (b !== a) {
          studentChanged = true;
          changes.push({
            id: afterStudent.id,
            field: String(field),
            before: before[field],
            after: (afterStudent as unknown as Record<string, unknown>)[field],
          });
        }
      }
      if (studentChanged) changed += 1;
    }

    const nextOffset = offset + students.length;
    const totalCount = await db.student.count({ where: { status: { not: "مؤرشف" } } });
    const done = nextOffset >= totalCount;

    return NextResponse.json({
      ok: true,
      message: `Processed ${students.length} students (${changed} changed).`,
      totalInBatch: students.length,
      processed: students.length,
      changed,
      changes: changes.slice(0, 50), // cap for response size
      nextOffset: done ? null : nextOffset,
      totalCount,
      done,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر إعادة حساب حالة الطلاب حالياً.");
  }
}
