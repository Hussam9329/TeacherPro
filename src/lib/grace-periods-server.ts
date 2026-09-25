import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  graceDateKey,
  isStudentInGracePeriod,
  type GracePeriodRange,
  type GracePeriodRecord,
} from "@/lib/grace-periods";

type GracePeriodClient = Pick<Prisma.TransactionClient, "gracePeriod">;

type GracePeriodRow = {
  id: string;
  studentId: string;
  startDate: Date;
  endDate: Date;
  source: string;
  note: string;
  createdById: string | null;
  createdByName: string;
  createdAt: Date;
  updatedById: string | null;
  updatedByName: string;
  updatedAt: Date;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancelledByName: string;
  cancelReason: string;
};

/** Prisma returns @db.Date as UTC midnight of the stored civil day. */
function dateColumnKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function toGracePeriodRange(row: Pick<GracePeriodRow, "id" | "startDate" | "endDate">): GracePeriodRange {
  return {
    id: row.id,
    startDate: dateColumnKey(row.startDate),
    endDate: dateColumnKey(row.endDate),
  };
}

export function toGracePeriodRecord(row: GracePeriodRow): GracePeriodRecord {
  return {
    ...toGracePeriodRange(row),
    id: row.id,
    studentId: row.studentId,
    source: row.source,
    note: row.note,
    createdById: row.createdById,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedById: row.updatedById,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledById: row.cancelledById,
    cancelledByName: row.cancelledByName,
    cancelReason: row.cancelReason,
  };
}

/** Stores a civil YYYY-MM-DD key in a @db.Date column. */
export function graceDateColumn(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Active (non-cancelled) periods for each requested student, sorted by start. */
export async function loadActiveGracePeriodsByStudent(
  client: GracePeriodClient,
  rawStudentIds: Iterable<string | null | undefined>,
): Promise<Map<string, GracePeriodRange[]>> {
  const studentIds = [...new Set([...rawStudentIds].map((id) => String(id || "").trim()).filter(Boolean))];
  const byStudent = new Map<string, GracePeriodRange[]>();
  if (!studentIds.length) return byStudent;
  for (let index = 0; index < studentIds.length; index += 5000) {
    const rows = await client.gracePeriod.findMany({
      where: { studentId: { in: studentIds.slice(index, index + 5000) }, cancelledAt: null },
      select: { id: true, studentId: true, startDate: true, endDate: true },
      orderBy: [{ studentId: "asc" }, { startDate: "asc" }],
    });
    for (const row of rows) {
      const list = byStudent.get(row.studentId) || [];
      list.push(toGracePeriodRange(row));
      byStudent.set(row.studentId, list);
    }
  }
  return byStudent;
}

/** Adds `gracePeriods` (active periods only) to each student-shaped row. */
export async function attachGracePeriods<T extends { id: string }>(
  client: GracePeriodClient,
  students: T[],
): Promise<Array<T & { gracePeriods: GracePeriodRange[] }>> {
  const byStudent = await loadActiveGracePeriodsByStudent(client, students.map((student) => student.id));
  return students.map((student) => ({ ...student, gracePeriods: byStudent.get(student.id) || [] }));
}

/** Every period of one student, including cancelled history. */
export async function listStudentGracePeriods(
  client: GracePeriodClient,
  studentId: string,
): Promise<GracePeriodRecord[]> {
  const rows = await client.gracePeriod.findMany({
    where: { studentId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toGracePeriodRecord);
}

/** isStudentInGracePeriod(studentId, examDate) for server code without a loaded state. */
export async function isStudentInGracePeriodForExam(
  studentId: string,
  examDate: Date | string,
  client: GracePeriodClient = db,
): Promise<boolean> {
  const dateKey = graceDateKey(examDate);
  if (!studentId || !dateKey) return false;
  const periods = await loadActiveGracePeriodsByStudent(client, [studentId]);
  return isStudentInGracePeriod(periods.get(studentId), dateKey);
}

/** Retired Student grace columns. Nothing reads them; responses strip them. */
export const LEGACY_STUDENT_GRACE_FIELDS = [
  "accountingGraceDays",
  "gracePeriodStartDate",
  "gracePeriodEndedAt",
  "gracePeriodEndedByExamId",
  "gracePeriodHistory",
  "gracePeriodHistoryPreserved",
] as const;

export function withoutLegacyGraceFields<T extends object>(student: T): T {
  const copy = { ...student } as Record<string, unknown>;
  for (const field of LEGACY_STUDENT_GRACE_FIELDS) delete copy[field];
  return copy as T;
}

/**
 * Student rows sent to the browser carry their active grace periods (read-only
 * result) and never the legacy grace columns.
 */
export async function studentsWithGracePeriodsForResponse<T extends { id: string }>(
  students: T[],
  client: GracePeriodClient = db,
): Promise<Array<T & { gracePeriods: GracePeriodRange[] }>> {
  const withPeriods = await attachGracePeriods(client, students);
  return withPeriods.map((student) => withoutLegacyGraceFields(student));
}
