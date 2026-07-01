import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

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

type RawExecutor = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
};

type TransactionExecutor = {
  $executeRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<T>;
};

export async function ensureLogClearBackupTable(client: RawExecutor = db): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "LogClearBackup" (
      "id" TEXT PRIMARY KEY,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdById" TEXT,
      "createdByName" TEXT,
      "scopeIds" TEXT NOT NULL,
      "scopeLabels" TEXT NOT NULL,
      "dateFrom" TEXT,
      "dateTo" TEXT,
      "rangeLabel" TEXT NOT NULL,
      "auditLogs" TEXT NOT NULL,
      "opportunityLogs" TEXT NOT NULL,
      "auditCount" INTEGER NOT NULL DEFAULT 0,
      "opportunityCount" INTEGER NOT NULL DEFAULT 0,
      "restoredAt" TIMESTAMP(3),
      "restoredById" TEXT,
      "restoredByName" TEXT
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "LogClearBackup_createdAt_idx"
    ON "LogClearBackup" ("createdAt")
  `);

  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "LogClearBackup_restoredAt_idx"
    ON "LogClearBackup" ("restoredAt")
  `);
}

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
