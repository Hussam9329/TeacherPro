import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import { recalculateAcademicState } from "@/lib/academic-engine";
import {
  loadAcademicStateForStudents,
  recalculateStudentsAcademicState,
} from "@/lib/academic-recalculate-server";
import { recalculateWithGraceReview } from "@/lib/grace-dismissal-review";
import { normalizeGracePeriodRanges } from "@/lib/grace-periods";
import { graceDateColumn } from "@/lib/grace-periods-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import {
  planLegacyStudentConversion,
  type LegacyOrigin,
  type LegacyStudentPlan,
} from "@/lib/legacy-grace-conversion";

type Client = typeof db | Prisma.TransactionClient;

const LEGACY_PLACEHOLDER_STATUS = "ضمن فترة السماح";
const ARCHIVED_STATUS = "مؤرشف";
export const LEGACY_GRACE_AUDIT_MODULE = "فترات السماح";
export const LEGACY_GRACE_AUDIT_ACTION = "نقل فترات السماح من النظام القديم";

export type LegacyConversionStudentRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  periods: Array<{ startDate: string; endDate: string; note: string }>;
  uncertainReasons: string[];
  conflicts: string[];
  placeholdersToDelete: number;
  futurePlaceholders: number;
  balance: {
    before: { opportunities: number; status: string };
    after: { opportunities: number; status: string };
  } | null;
};

export type LegacyConversionTotals = {
  studentsWithPeriods: number;
  periods: number;
  origins: Record<LegacyOrigin, number>;
  placeholdersToDelete: number;
  futurePlaceholders: number;
  uncertainStudents: number;
  conflictStudents: number;
  balanceChanges: number;
  alreadyConverted: number;
};

export type LegacyConversionBatch = {
  mode: "dry-run" | "apply";
  scanned: number;
  nextCursor: string | null;
  hasMore: boolean;
  students: LegacyConversionStudentRow[];
  totals: LegacyConversionTotals;
};

function emptyTotals(): LegacyConversionTotals {
  return {
    studentsWithPeriods: 0,
    periods: 0,
    origins: { "current-window": 0, history: 0, "history-exam": 0, placeholder: 0 },
    placeholdersToDelete: 0,
    futurePlaceholders: 0,
    uncertainStudents: 0,
    conflictStudents: 0,
    balanceChanges: 0,
    alreadyConverted: 0,
  };
}

function historyExamIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    return [raw.examIds, raw.excludedExamIds].flatMap((list) =>
      Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && id.length > 0) : []);
  });
}

async function planBatch(client: Client, cursor: string | null, batchSize: number) {
  const fetched = await client.student.findMany({
    where: cursor ? { id: { gt: cursor } } : undefined,
    orderBy: { id: "asc" },
    take: batchSize + 1,
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      createdAt: true,
      accountingGraceDays: true,
      gracePeriodStartDate: true,
      gracePeriodEndedAt: true,
      gracePeriodHistory: true,
    },
  });
  const hasMore = fetched.length > batchSize;
  const students = fetched.slice(0, batchSize);
  const ids = students.map((student) => student.id);
  const referencedExamIds = [...new Set(students.flatMap((student) => historyExamIds(student.gracePeriodHistory)))];
  const [placeholders, existing, referencedExams] = ids.length
    ? await Promise.all([
        client.grade.findMany({
          where: { studentId: { in: ids }, status: LEGACY_PLACEHOLDER_STATUS, score: null },
          select: { studentId: true, examId: true, exam: { select: { date: true } } },
        }),
        client.gracePeriod.findMany({
          where: { studentId: { in: ids } },
          select: { id: true, studentId: true, startDate: true, endDate: true, source: true, cancelledAt: true },
        }),
        referencedExamIds.length
          ? client.exam.findMany({ where: { id: { in: referencedExamIds } }, select: { id: true, date: true } })
          : Promise.resolve([]),
      ])
    : [[], [], []];
  const examDateById = new Map<string, string>(
    (referencedExams as Array<{ id: string; date: Date }>).map((exam) => [exam.id, baghdadDateKey(exam.date)]),
  );
  const todayKey = baghdadTodayKey();

  const plans = new Map<string, LegacyStudentPlan>();
  for (const student of students) {
    plans.set(student.id, planLegacyStudentConversion({
      student,
      examDateById,
      todayKey,
      placeholders: placeholders
        .filter((row) => row.studentId === student.id)
        .map((row) => ({ examId: row.examId, examDate: baghdadDateKey(row.exam.date) })),
      existingPeriods: existing
        .filter((row) => row.studentId === student.id)
        .map((row) => ({
          id: row.id,
          startDate: row.startDate.toISOString().slice(0, 10),
          endDate: row.endDate.toISOString().slice(0, 10),
          source: row.source,
          cancelled: Boolean(row.cancelledAt),
        })),
    }));
  }
  return { students, plans, hasMore };
}

/** Projects each converting student's balance with the new periods (no writes). */
async function projectBalances(
  client: Client,
  studentIds: string[],
  plans: Map<string, LegacyStudentPlan>,
) {
  const result = new Map<string, LegacyConversionStudentRow["balance"]>();
  if (!studentIds.length) return result;
  const state = await loadAcademicStateForStudents(client, studentIds);
  const projectedState = {
    ...state,
    students: state.students.map((student) => ({
      ...student,
      gracePeriods: normalizeGracePeriodRanges([
        ...(student.gracePeriods || []),
        ...(plans.get(student.id)?.periods || []),
      ]),
    })),
  };
  const recalculable = state.students.filter((student) => student.status !== ARCHIVED_STATUS);
  const ordinaryIds = new Set(recalculable.filter((student) => student.status !== "مفصول").map((student) => student.id));
  const ordinary = ordinaryIds.size ? recalculateAcademicState(projectedState, ordinaryIds) : null;
  for (const stored of recalculable) {
    const projected = stored.status === "مفصول"
      ? recalculateWithGraceReview(projectedState, new Set([stored.id]), { studentId: stored.id })
        .students.find((student) => student.id === stored.id)
      : ordinary?.students.find((student) => student.id === stored.id);
    if (!projected) continue;
    if (projected.opportunities !== stored.opportunities || projected.status !== stored.status) {
      result.set(stored.id, {
        before: { opportunities: stored.opportunities, status: stored.status },
        after: { opportunities: projected.opportunities, status: projected.status },
      });
    }
  }
  return result;
}

function summarize(
  mode: LegacyConversionBatch["mode"],
  students: Array<{ id: string; name: string; code: string; status: string }>,
  plans: Map<string, LegacyStudentPlan>,
  balances: Map<string, LegacyConversionStudentRow["balance"]>,
  hasMore: boolean,
): LegacyConversionBatch {
  const totals = emptyTotals();
  const rows: LegacyConversionStudentRow[] = [];
  for (const student of students) {
    const plan = plans.get(student.id)!;
    if (plan.status === "already-converted") totals.alreadyConverted += 1;
    if (plan.status !== "convert") continue;
    const balance = balances.get(student.id) || null;
    if (plan.periods.length) totals.studentsWithPeriods += 1;
    totals.periods += plan.periods.length;
    for (const [origin, count] of Object.entries(plan.origins) as Array<[LegacyOrigin, number]>) totals.origins[origin] += count;
    totals.placeholdersToDelete += plan.placeholdersToDelete;
    totals.futurePlaceholders += plan.futurePlaceholders;
    if (plan.uncertainReasons.length) totals.uncertainStudents += 1;
    if (plan.conflicts.length) totals.conflictStudents += 1;
    if (balance) totals.balanceChanges += 1;
    rows.push({
      id: student.id,
      name: student.name,
      code: student.code,
      status: student.status,
      periods: plan.periods,
      uncertainReasons: plan.uncertainReasons,
      conflicts: plan.conflicts,
      placeholdersToDelete: plan.placeholdersToDelete,
      futurePlaceholders: plan.futurePlaceholders,
      balance,
    });
  }
  return {
    mode,
    scanned: students.length,
    nextCursor: students.at(-1)?.id || null,
    hasMore,
    students: rows,
    totals,
  };
}

/** Dry run: reads everything, writes nothing. */
export async function dryRunLegacyGraceConversion(cursor: string | null, batchSize = 150) {
  const { students, plans, hasMore } = await planBatch(db, cursor, batchSize);
  const convertIds = students.filter((student) => plans.get(student.id)?.status === "convert").map((student) => student.id);
  const balances = await projectBalances(db, convertIds, plans);
  return summarize("dry-run", students, plans, balances, hasMore);
}

/**
 * Apply: re-plans the batch inside one serializable transaction, creates the
 * periods, removes the retired placeholders, recalculates the affected
 * students (lifting only automatic dismissals whose cause is now excused) and
 * writes one audit record. Already-converted students are skipped, so a
 * repeated or resumed run never duplicates periods.
 */
export async function applyLegacyGraceConversion(
  cursor: string | null,
  actor: { id: string | null; name: string },
  batchSize = 50,
) {
  return withSerializableTransaction(async (tx) => {
    const { students, plans, hasMore } = await planBatch(tx, cursor, batchSize);
    const converting = students.filter((student) => plans.get(student.id)?.status === "convert");
    const convertIds = converting.map((student) => student.id);
    const balances = await projectBalances(tx, convertIds, plans);

    const rows = converting.flatMap((student) => plans.get(student.id)!.periods.map((period) => ({
      studentId: student.id,
      startDate: graceDateColumn(period.startDate),
      endDate: graceDateColumn(period.endDate),
      source: "legacy",
      note: period.note,
      createdById: actor.id,
      createdByName: actor.name,
      updatedById: actor.id,
      updatedByName: actor.name,
    })));
    if (rows.length) await tx.gracePeriod.createMany({ data: rows });
    if (convertIds.length) {
      await tx.grade.deleteMany({
        where: { studentId: { in: convertIds }, status: LEGACY_PLACEHOLDER_STATUS, score: null },
      });
    }

    const active = converting.filter((student) => student.status !== ARCHIVED_STATUS);
    const dismissed = active.filter((student) => student.status === "مفصول").map((student) => student.id);
    const ordinary = active.filter((student) => student.status !== "مفصول").map((student) => student.id);
    if (ordinary.length) await recalculateStudentsAcademicState(ordinary, { tx });
    for (const studentId of dismissed) {
      await recalculateStudentsAcademicState([studentId], { tx, graceReview: { studentId } });
    }

    const report = summarize("apply", students, plans, balances, hasMore);
    if (convertIds.length) {
      await tx.auditLog.create({
        data: {
          module: LEGACY_GRACE_AUDIT_MODULE,
          action: LEGACY_GRACE_AUDIT_ACTION,
          details: `دفعة: ${students.length} طالب - طلاب حُوّلوا: ${convertIds.length} - فترات أُنشئت: ${rows.length} - علامات قديمة حُذفت: ${report.totals.placeholdersToDelete} - تغيّر رصيدهم: ${report.totals.balanceChanges}`,
          userId: actor.id,
          userName: actor.name,
        },
      });
    }
    return report;
  });
}

/** Where the one-time conversion stands. */
export async function legacyGraceConversionStatus() {
  const [legacyPeriods, remainingPlaceholders, lastRun] = await Promise.all([
    db.gracePeriod.count({ where: { source: "legacy" } }),
    db.grade.count({ where: { status: LEGACY_PLACEHOLDER_STATUS, score: null } }),
    db.auditLog.findFirst({
      where: { module: LEGACY_GRACE_AUDIT_MODULE, action: LEGACY_GRACE_AUDIT_ACTION },
      orderBy: { time: "desc" },
      select: { time: true, userName: true },
    }),
  ]);
  return {
    legacyPeriods,
    remainingPlaceholders,
    lastAppliedAt: lastRun?.time.toISOString() || null,
    lastAppliedBy: lastRun?.userName || null,
  };
}
