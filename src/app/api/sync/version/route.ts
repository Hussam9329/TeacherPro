export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";

type CountDelegate = { count: () => Promise<number> };
type AggregateDelegate = {
  aggregate: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const countDelegates: Array<[string, CountDelegate]> = [
  ["courses", db.course as unknown as CountDelegate],
  ["chapters", db.chapter as unknown as CountDelegate],
  ["courseChapters", db.courseChapter as unknown as CountDelegate],
  ["students", db.student as unknown as CountDelegate],
  ["exams", db.exam as unknown as CountDelegate],
  ["grades", db.grade as unknown as CountDelegate],
  ["opportunityLogs", db.opportunityLog as unknown as CountDelegate],
  ["studentLeaves", db.studentLeave as unknown as CountDelegate],
  ["studentCalls", db.studentCall as unknown as CountDelegate],
  ["studentNotes", db.studentNote as unknown as CountDelegate],
  ["correctionSheets", db.correctionSheet as unknown as CountDelegate],
  ["telegramSubmissions", db.telegramExamSubmission as unknown as CountDelegate],
  ["users", db.appUser as unknown as CountDelegate],
  ["roles", db.role as unknown as CountDelegate],
  ["auditLogs", db.auditLog as unknown as CountDelegate],
];

const maxDateDelegates: Array<[string, AggregateDelegate, string]> = [
  ["grades", db.grade as unknown as AggregateDelegate, "updatedAt"],
  ["telegramSubmissions", db.telegramExamSubmission as unknown as AggregateDelegate, "updatedAt"],
  ["missingNotes", db.gradeEntryMissingNote as unknown as AggregateDelegate, "updatedAt"],
  ["auditLogs", db.auditLog as unknown as AggregateDelegate, "time"],
];

async function safeCount(name: string, delegate: CountDelegate) {
  try {
    return [name, await delegate.count()] as const;
  } catch {
    return [name, 0] as const;
  }
}

async function safeMaxDate(
  name: string,
  delegate: AggregateDelegate,
  field: string,
) {
  try {
    const result = await delegate.aggregate({ _max: { [field]: true } });
    const max = (result._max as Record<string, unknown> | undefined)?.[field];
    if (max instanceof Date && Number.isFinite(max.getTime())) {
      return [name, max.toISOString()] as const;
    }
    if (typeof max === "string" && max.trim()) {
      const date = new Date(max);
      if (Number.isFinite(date.getTime())) return [name, date.toISOString()] as const;
    }
  } catch {
    // Missing optional tables/columns should not break sync-version checks.
  }
  return [name, ""] as const;
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const [countPairs, maxDatePairs] = await Promise.all([
      Promise.all(countDelegates.map(([name, delegate]) => safeCount(name, delegate))),
      Promise.all(
        maxDateDelegates.map(([name, delegate, field]) =>
          safeMaxDate(name, delegate, field),
        ),
      ),
    ]);

    const counts = Object.fromEntries(countPairs);
    const maxDates = Object.fromEntries(maxDatePairs);
    const latestMs = Math.max(
      0,
      ...Object.values(maxDates).map((value) => {
        if (!value) return 0;
        const time = new Date(value).getTime();
        return Number.isFinite(time) ? time : 0;
      }),
    );

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
