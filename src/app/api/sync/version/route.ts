export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { assertDatabaseSchemaReady } from "@/lib/schema-readiness";

// ============================================================================
// Performance optimization: previously this endpoint ran 19 separate Prisma
// queries (15 count() + 4 aggregate _max) on every poll. With 10s polling
// that was 114 DB round-trips/minute per connected client.
//
// Now: a single $queryRaw consolidates all 15 counts + 4 max dates into ONE
// database round-trip. The response JSON shape is IDENTICAL to before —
// same keys, same types, same version fingerprint format — so the client's
// cache matching logic is unaffected.
//
// Schema readiness is checked before this consolidated query. Missing tables
// are deployment errors and must never be disguised as legitimate zero counts.
// ============================================================================

type SyncVersionRow = {
  courses: bigint;
  chapters: bigint;
  coursechapters: bigint;
  students: bigint;
  exams: bigint;
  grades: bigint;
  opportunitylogs: bigint;
  studentleaves: bigint;
  studentcalls: bigint;
  studentnotes: bigint;
  correctionsheets: bigint;
  telegramsubmissions: bigint;
  users: bigint;
  roles: bigint;
  auditlogs: bigint;
  gradesmartnotes: bigint;
  gradesmax: Date | null;
  telegramsubmissionsmax: Date | null;
  auditlogsmax: Date | null;
  gradesmartnotesmax: Date | null;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function toIso(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  }
  return "";
}

const SYNC_VERSION_SQL = `
  SELECT
    (SELECT COUNT(*) FROM "Course") AS courses,
    (SELECT COUNT(*) FROM "Chapter") AS chapters,
    (SELECT COUNT(*) FROM "CourseChapter") AS coursechapters,
    (SELECT COUNT(*) FROM "Student") AS students,
    (SELECT COUNT(*) FROM "Exam") AS exams,
    (SELECT COUNT(*) FROM "Grade") AS grades,
    (SELECT COUNT(*) FROM "OpportunityLog") AS opportunitylogs,
    (SELECT COUNT(*) FROM "StudentLeave") AS studentleaves,
    (SELECT COUNT(*) FROM "StudentCall") AS studentcalls,
    (SELECT COUNT(*) FROM "StudentNote") AS studentnotes,
    (SELECT COUNT(*) FROM "CorrectionSheet") AS correctionsheets,
    COALESCE((SELECT COUNT(*) FROM "TelegramExamSubmission"), 0) AS telegramsubmissions,
    (SELECT COUNT(*) FROM "AppUser") AS users,
    (SELECT COUNT(*) FROM "Role") AS roles,
    (SELECT COUNT(*) FROM "AuditLog") AS auditlogs,
    (SELECT COUNT(*) FROM "GradeSmartNote") AS gradesmartnotes,
    (SELECT MAX("updatedAt") FROM "Grade") AS gradesmax,
    COALESCE((SELECT MAX("updatedAt") FROM "TelegramExamSubmission"), NULL) AS telegramsubmissionsmax,
    (SELECT MAX("time") FROM "AuditLog") AS auditlogsmax,
    (SELECT MAX("updatedAt") FROM "GradeSmartNote") AS gradesmartnotesmax
`;

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    await assertDatabaseSchemaReady();
    const rows = await db.$queryRaw<SyncVersionRow[]>(Prisma.raw(SYNC_VERSION_SQL));
    const row = rows[0] ?? null;

    if (!row) {
      return NextResponse.json(
        { ok: true, version: "0:", latestAt: null, counts: {}, maxDates: {}, source: "database", generatedAt: new Date().toISOString() },
      );
    }

    // Build the response with the EXACT same shape as before.
    const counts: Record<string, number> = {
      courses: toNumber(row.courses),
      chapters: toNumber(row.chapters),
      courseChapters: toNumber(row.coursechapters),
      students: toNumber(row.students),
      exams: toNumber(row.exams),
      grades: toNumber(row.grades),
      opportunityLogs: toNumber(row.opportunitylogs),
      studentLeaves: toNumber(row.studentleaves),
      studentCalls: toNumber(row.studentcalls),
      studentNotes: toNumber(row.studentnotes),
      correctionSheets: toNumber(row.correctionsheets),
      telegramSubmissions: toNumber(row.telegramsubmissions),
      users: toNumber(row.users),
      roles: toNumber(row.roles),
      auditLogs: toNumber(row.auditlogs),
      gradeSmartNotes: toNumber(row.gradesmartnotes),
    };

    const maxDates: Record<string, string> = {
      grades: toIso(row.gradesmax),
      telegramSubmissions: toIso(row.telegramsubmissionsmax),
      auditLogs: toIso(row.auditlogsmax),
      gradeSmartNotes: toIso(row.gradesmartnotesmax),
    };

    const latestMs = Math.max(
      0,
      ...Object.values(maxDates).map((value) => {
        if (!value) return 0;
        const time = new Date(value).getTime();
        return Number.isFinite(time) ? time : 0;
      }),
    );

    // IMPORTANT: the version fingerprint format must match the previous
    // implementation EXACTLY so the client's cache-matching logic continues
    // to work without change.
    const countFingerprint = Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join("|");
    const maxFingerprint = Object.entries(maxDates)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value || "0"}`)
      .join("|");
    const version = `${latestMs}:${countFingerprint}:${maxFingerprint}`;

    return NextResponse.json({
      ok: true,
      version,
      latestAt: latestMs ? new Date(latestMs).toISOString() : null,
      counts,
      maxDates,
      source: "database",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر فحص إصدار مزامنة البيانات.");
  }
}
