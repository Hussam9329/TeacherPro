import type { Prisma } from '@prisma/client';

export type LogClearBackupInsert = {
  id: string;
  createdById?: string | null;
  createdByName?: string | null;
  scopeIds: string[];
  scopeLabels: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
  rangeLabel: string;
  auditLogs: unknown[];
  opportunityLogs: unknown[];
};

export type LogClearBackupRow = {
  id: string;
  createdAt: Date;
  createdById: string | null;
  createdByName: string | null;
  scopeIds: string;
  scopeLabels: string;
  dateFrom: string | null;
  dateTo: string | null;
  rangeLabel: string;
  auditLogs: string;
  opportunityLogs: string;
  auditCount: number;
  opportunityCount: number;
  restoredAt: Date | null;
  restoredById: string | null;
  restoredByName: string | null;
};

type TransactionExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>;

export async function insertLogClearBackup(tx: TransactionExecutor, backup: LogClearBackupInsert): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "LogClearBackup" (
      "id",
      "createdById",
      "createdByName",
      "scopeIds",
      "scopeLabels",
      "dateFrom",
      "dateTo",
      "rangeLabel",
      "auditLogs",
      "opportunityLogs",
      "auditCount",
      "opportunityCount"
    ) VALUES (
      ${backup.id},
      ${backup.createdById ?? null},
      ${backup.createdByName ?? null},
      ${JSON.stringify(backup.scopeIds)},
      ${JSON.stringify(backup.scopeLabels)},
      ${backup.dateFrom ?? null},
      ${backup.dateTo ?? null},
      ${backup.rangeLabel},
      ${JSON.stringify(backup.auditLogs)},
      ${JSON.stringify(backup.opportunityLogs)},
      ${backup.auditLogs.length},
      ${backup.opportunityLogs.length}
    )
  `;
}

export function parseBackupJsonArray<T = Record<string, unknown>>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}
