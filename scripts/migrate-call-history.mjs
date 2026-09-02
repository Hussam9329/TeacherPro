#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  buildCallHistoryMigrationPlan,
} from "./call-history-migration-core.mjs";

const db = new PrismaClient();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const jsonOutput = args.includes("--json");

function readArg(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readResolutions() {
  const filename = readArg("--resolution-file");
  if (!filename) return {};
  const absolute = path.resolve(process.cwd(), filename);
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Resolution file must contain a JSON object keyed by studentId::examId.");
  }
  return parsed;
}

function dateText(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function short(value, max = 90) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || "-";
}

function printablePlan(plan) {
  return {
    summary: plan.summary,
    duplicateGroups: plan.duplicateGroups.map((group) => ({
      identityKey: group.identityKey,
      studentId: group.studentId,
      examId: group.examId,
      rowCount: group.rowCount,
      survivorId: group.survivorId,
      deleteIds: group.deleteIds,
      categories: group.categories,
      statuses: group.distinctStatuses,
      unsupportedStatuses: group.unsupportedStatuses,
      notes: group.distinctNotes,
      conflictTypes: group.conflictTypes,
      unresolved: group.unresolved,
      resolutionApplied: group.resolutionApplied,
      metadataWarnings: group.metadataWarnings,
      merge: group.merge,
      rows: group.rows.map((row) => ({
        id: row.id,
        category: row.category,
        status: row.status,
        completed: row.completed,
        completedAt: row.completedAt,
        notes: row.notes,
        phone: row.phone,
        target: row.target,
        createdAt: row.createdAt,
      })),
    })),
    resolutionTemplate: plan.resolutionTemplate,
  };
}

function printSummary(plan) {
  const s = plan.summary;
  console.log("\nTP-PATCH-03 — Call History Migration");
  console.log(apply ? "Mode: APPLY" : "Mode: DRY-RUN (read only)");
  console.log("------------------------------------");
  console.log(`Total StudentCall rows: ${s.totalRows}`);
  console.log(`Exam-call rows: ${s.examCallRows}`);
  console.log(`Logical student + exam calls: ${s.logicalExamCalls}`);
  console.log(`Manual student-note rows (untouched): ${s.manualStudentNoteRows}`);
  console.log(`Non-exam call rows (untouched): ${s.nonExamCallRows}`);
  console.log(`Legacy rows (absent / grade:*): ${s.legacyRows}`);
  console.log(`Distinct legacy category keys: ${s.legacyDistinctCategoryKeys}`);
  console.log(`  absent rows: ${s.legacyCategoryKinds.absent}`);
  console.log(`  grade:* rows: ${s.legacyCategoryKinds.grade}`);
  console.log(`Duplicate logical groups: ${s.duplicateGroups}`);
  console.log(`Duplicate rows removable: ${s.duplicateRowsRemovable}`);
  console.log(`Safe/resolved merge groups: ${s.safeMergeGroups}`);
  console.log(`Unresolved conflict groups: ${s.unresolvedConflictGroups}`);
  console.log(`  status conflicts: ${s.statusConflictGroups}`);
  console.log(`  unsupported historical status groups: ${s.unsupportedStatusGroups}`);
  console.log(`  note conflicts: ${s.noteConflictGroups}`);
  console.log(`Metadata warning groups: ${s.metadataWarningGroups}`);
  console.log(`Rows after a successful migration: ${s.rowsAfterSuccessfulMigration}`);
}

function printGroups(plan) {
  if (plan.duplicateGroups.length === 0) {
    console.log("\nNo duplicate logical calls were found.");
    return;
  }

  console.log("\nMerge plan:");
  for (const group of plan.duplicateGroups) {
    const marker = group.unresolved ? "CONFLICT" : group.resolutionApplied ? "RESOLVED" : "SAFE";
    console.log(`\n[${marker}] ${group.identityKey}`);
    console.log(`  keep: ${group.survivorId}`);
    console.log(`  remove: ${group.deleteIds.join(", ")}`);
    console.log(`  categories: ${group.categories.join(", ")}`);
    console.log(`  statuses: ${group.distinctStatuses.join(" | ") || "(no action)"}`);
    if (group.unsupportedStatuses.length) {
      console.log(`  unsupported statuses: ${group.unsupportedStatuses.join(" | ")}`);
    }
    console.log(`  notes: ${group.distinctNotes.map((note) => short(note)).join(" | ") || "-"}`);
    if (group.conflictTypes.length) console.log(`  conflict types: ${group.conflictTypes.join(", ")}`);
    if (group.merge) {
      console.log(
        `  result: status=${group.merge.status || "(no action)"}, note=${short(group.merge.notes)}, category=${group.merge.survivingCategory || "(empty)"}`,
      );
    }
    if (
      group.metadataWarnings.phoneConflict ||
      group.metadataWarnings.targetConflict ||
      group.metadataWarnings.completedFlagMismatchIds.length
    ) {
      console.log(
        `  metadata warning: phone=${group.metadataWarnings.phoneConflict ? "differs" : "ok"}, target=${group.metadataWarnings.targetConflict ? "differs" : "ok"}, completedMismatch=${group.metadataWarnings.completedFlagMismatchIds.length}`,
      );
    }
    for (const row of group.rows) {
      console.log(
        `    - ${row.id} | ${row.category || "(empty)"} | ${row.status || (row.completed ? "completed=true" : "(no action)")} | ${dateText(row.createdAt)} | note=${short(row.notes, 60)}`,
      );
    }
  }
}

function writeResolutionTemplate(plan) {
  const filename = readArg("--write-resolution-template");
  if (!filename) return;
  const absolute = path.resolve(process.cwd(), filename);
  fs.writeFileSync(absolute, `${JSON.stringify(plan.resolutionTemplate, null, 2)}\n`, "utf8");
  console.log(`\nResolution template written to: ${absolute}`);
}

async function loadRows(client = db) {
  return client.studentCall.findMany({
    select: {
      id: true,
      studentId: true,
      examId: true,
      category: true,
      target: true,
      phone: true,
      status: true,
      completed: true,
      completedAt: true,
      notes: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function affectedRows(plan, currentRows) {
  const ids = new Set(plan.duplicateGroups.flatMap((group) => group.rowIds));
  return currentRows.filter((row) => ids.has(row.id));
}

async function createBackups(tx, runId, rows) {
  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await tx.studentCallHistoryBackup.createMany({
      data: chunk.map((row) => ({
        id: randomUUID(),
        migrationRunId: runId,
        sourceCallId: row.id,
        studentId: row.studentId,
        examId: row.examId,
        category: row.category,
        target: row.target,
        phone: row.phone,
        status: row.status,
        completed: row.completed,
        completedAt: row.completedAt,
        notes: row.notes,
        sourceCreatedAt: row.createdAt,
      })),
    });
  }
}

async function applyPlan(resolutions, previewPlan) {
  const runId = `callhist_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const previewStudentIds = [
    ...new Set(previewPlan.duplicateGroups.map((group) => group.studentId)),
  ];

  return db.$transaction(
    async (tx) => {
      if (previewStudentIds.length) {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Student" WHERE "id" IN (${Prisma.join(previewStudentIds)}) ORDER BY "id" FOR UPDATE`,
        );
      }

      const liveRows = await loadRows(tx);
      const livePlan = buildCallHistoryMigrationPlan(liveRows, resolutions);
      if (livePlan.summary.unresolvedConflictGroups > 0) {
        throw new Error(
          `Migration blocked: ${livePlan.summary.unresolvedConflictGroups} unresolved conflict group(s) exist in the live snapshot.`,
        );
      }

      const liveStudentIds = new Set(livePlan.duplicateGroups.map((group) => group.studentId));
      for (const studentId of liveStudentIds) {
        if (!previewStudentIds.includes(studentId)) {
          throw new Error(
            `Migration plan changed after locking: new affected student ${studentId}. Re-run dry-run before applying.`,
          );
        }
      }

      const backupRows = affectedRows(livePlan, liveRows);
      await tx.studentCallHistoryMigrationRun.create({
        data: {
          id: runId,
          status: "running",
          backupCount: backupRows.length,
          mergedGroups: 0,
          deletedRows: 0,
          summary: livePlan.summary,
        },
      });
      await createBackups(tx, runId, backupRows);

      for (const group of livePlan.duplicateGroups) {
        const merge = group.merge;
        if (!merge) throw new Error(`Internal error: unresolved merge ${group.identityKey}.`);
        await tx.studentCall.update({
          where: { id: group.survivorId },
          data: {
            status: merge.status,
            completed: merge.completed,
            completedAt: merge.completedAt,
            notes: merge.notes,
            target: merge.target,
            phone: merge.phone,
          },
        });
        if (group.deleteIds.length) {
          await tx.studentCall.deleteMany({ where: { id: { in: group.deleteIds } } });
        }
      }

      const verificationRows = await loadRows(tx);
      const verificationPlan = buildCallHistoryMigrationPlan(verificationRows, resolutions);
      if (verificationPlan.summary.duplicateGroups !== 0) {
        throw new Error(
          `Verification failed: ${verificationPlan.summary.duplicateGroups} duplicate logical call group(s) remain. The transaction will roll back.`,
        );
      }

      await tx.studentCallHistoryMigrationRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          completedAt: new Date(),
          mergedGroups: livePlan.summary.duplicateGroups,
          deletedRows: livePlan.summary.duplicateRowsRemovable,
          summary: {
            ...livePlan.summary,
            verificationDuplicateGroups: verificationPlan.summary.duplicateGroups,
            rowsAfterMigration: verificationRows.length,
          },
        },
      });

      return {
        runId,
        backupCount: backupRows.length,
        mergedGroups: livePlan.summary.duplicateGroups,
        deletedRows: livePlan.summary.duplicateRowsRemovable,
        verificationDuplicateGroups: verificationPlan.summary.duplicateGroups,
        rowsAfterMigration: verificationRows.length,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 30_000,
      timeout: 300_000,
    },
  );
}

let exitCode = 0;
try {
  const resolutions = readResolutions();
  const rows = await loadRows();
  const plan = buildCallHistoryMigrationPlan(rows, resolutions);

  if (jsonOutput) {
    console.log(JSON.stringify(printablePlan(plan), null, 2));
  } else {
    printSummary(plan);
    printGroups(plan);
  }
  writeResolutionTemplate(plan);

  if (!apply) {
    console.log("\nDry run only. No database rows were changed.");
    if (plan.summary.unresolvedConflictGroups > 0) {
      console.log(
        "Resolve the conflicts explicitly with --resolution-file before using --apply. You can generate a starter file with --write-resolution-template <file>.",
      );
    } else if (plan.summary.duplicateGroups > 0) {
      console.log("Re-run with --apply after reviewing this plan.");
    }
  } else if (plan.summary.unresolvedConflictGroups > 0) {
    console.error(
      `\nAPPLY BLOCKED: ${plan.summary.unresolvedConflictGroups} unresolved conflict group(s). No backup, update, or delete was performed.`,
    );
    exitCode = 2;
  } else if (plan.summary.duplicateGroups === 0) {
    console.log("\nNo migration is needed. Database is already logically deduplicated.");
  } else {
    const result = await applyPlan(resolutions, plan);
    console.log("\nMigration completed successfully.");
    console.log(`Migration run: ${result.runId}`);
    console.log(`Backup rows: ${result.backupCount}`);
    console.log(`Merged logical groups: ${result.mergedGroups}`);
    console.log(`Deleted duplicate rows: ${result.deletedRows}`);
    console.log(`Duplicate logical calls after migration: ${result.verificationDuplicateGroups}`);
    console.log(`StudentCall rows after migration: ${result.rowsAfterMigration}`);
  }
} catch (error) {
  console.error("\nCall history migration failed. Any in-transaction changes were rolled back.");
  console.error(error instanceof Error ? error.stack || error.message : error);
  exitCode = 1;
} finally {
  await db.$disconnect();
}

process.exitCode = exitCode;
