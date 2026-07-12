export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthPrincipal } from "@/lib/server-auth";
import { verifyPassword } from "@/lib/passwords";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  ensureLogClearBackupTable,
  type LogClearBackupRow,
} from "@/lib/log-clear-backups";

const TABLE_NAMES = [
  "courses",
  "chapters",
  "courseChapters",
  "students",
  "exams",
  "examCourses",
  "grades",
  "opportunityLogs",
  "studentLeaves",
  "studentCalls",
  "studentNotes",
  "gradeEntryMissingNotes",
  "correctionSheets",
  "telegramExamSubmissions",
  "telegramExamSubmissionVersions",
  "studentLeaveGradeBackups",
  "studentEnrollmentArchives",
  "roles",
  "appUsers",
  "permissionCatalog",
  "auditLogs",
  "logClearBackups",
] as const;

type BackupTables = Record<(typeof TABLE_NAMES)[number], unknown[]>;
const LEGACY_REQUIRED_TABLES = TABLE_NAMES.filter(
  (name) => name !== "logClearBackups",
);
function normalizeTables(value: unknown): BackupTables | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!LEGACY_REQUIRED_TABLES.every((name) => Array.isArray(raw[name])))
    return null;
  return {
    ...(raw as Omit<BackupTables, "logClearBackups">),
    logClearBackups: Array.isArray(raw.logClearBackups)
      ? raw.logClearBackups
      : [],
  } as BackupTables;
}
function requiredDate(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`تاريخ غير صالح في ${field}.`);
  return parsed;
}
function optionalDate(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  return requiredDate(value, field);
}

export async function POST(req: NextRequest) {
  try {
    const principal = await getAuthPrincipal(req);
    if (!principal)
      return NextResponse.json(
        { error: "يجب تسجيل الدخول أولاً." },
        { status: 401 },
      );
    if (!principal.isAdmin)
      return NextResponse.json(
        { error: "استعادة النظام متاحة للمدير العام فقط." },
        { status: 403 },
      );
    const rateLimitError = await checkApiRateLimit(
      req,
      API_RATE_LIMITS.adminHeavy,
    );
    if (rateLimitError) return rateLimitError;
    const body = (await req.json()) as Record<string, unknown>;
    const password = String(body.password || "").trim();
    const backup = body.backup as Record<string, unknown> | undefined;
    if (!password)
      return validationError("أدخل كلمة مرور المدير لتأكيد الاستعادة.");
    const admin = await db.appUser.findUnique({
      where: { id: principal.id },
      select: { passwordHash: true },
    });
    if (!admin || !(await verifyPassword(password, admin.passwordHash)))
      return NextResponse.json(
        { error: "كلمة مرور المدير غير صحيحة." },
        { status: 403 },
      );
    const normalizedTables = backup ? normalizeTables(backup.tables) : null;
    if (
      !backup ||
      backup.format !== "teacherpro-full-backup" ||
      Number(backup.version) < 6 ||
      !normalizedTables
    ) {
      return validationError(
        "ملف النسخة غير كامل أو إصداره لا يدعم الاستعادة الكاملة.",
      );
    }
    const tables = normalizedTables;
    const computedChecksum = createHash("sha256")
      .update(
        JSON.stringify({
          format: backup.format,
          version: backup.version,
          exportedAt: backup.exportedAt,
          counts: backup.counts,
          tables: backup.tables,
        }),
      )
      .digest("hex");
    if (backup.checksum && String(backup.checksum) !== computedChecksum)
      return validationError(
        "فشل التحقق من سلامة النسخة الاحتياطية؛ قد يكون الملف معدلاً أو تالفاً.",
        409,
      );
    const counts = Object.fromEntries(
      TABLE_NAMES.map((name) => [name, tables[name].length]),
    );
    if (body.dryRun === true)
      return NextResponse.json({
        ok: true,
        dryRun: true,
        counts,
        checksum: computedChecksum,
        warning: "المعاينة ناجحة. لم تتغير قاعدة البيانات.",
      });
    if (
      body.confirmImpact !== true ||
      String(body.confirmText || "").trim() !== "استعادة النظام بالكامل"
    ) {
      return validationError(
        "أكد الاستعادة بكتابة «استعادة النظام بالكامل». ستُستبدل كل بيانات النظام الحالية.",
      );
    }

    await ensureLogClearBackupTable();
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('teacherpro-full-restore'))`;
        await tx.$executeRawUnsafe('DELETE FROM "LogClearBackup"');
        // Delete dependants first.
        await tx.telegramExamSubmissionVersion.deleteMany();
        await tx.telegramExamSubmission.deleteMany();
        await tx.correctionSheet.deleteMany();
        await tx.studentLeaveGradeBackup.deleteMany();
        await tx.studentEnrollmentArchive.deleteMany();
        await tx.studentNote.deleteMany();
        await tx.studentCall.deleteMany();
        await tx.studentLeave.deleteMany();
        await tx.opportunityLog.deleteMany();
        await tx.grade.deleteMany();
        await tx.gradeEntryMissingNote.deleteMany();
        await tx.examCourse.deleteMany();
        await tx.auditLog.deleteMany();
        await tx.student.deleteMany();
        await tx.courseChapter.deleteMany();
        await tx.exam.deleteMany();
        await tx.chapter.deleteMany();
        await tx.course.deleteMany();
        await tx.permissionCatalog.deleteMany();
        await tx.appUser.deleteMany();
        await tx.role.deleteMany();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const createMany = async (model: any, data: unknown[]) => {
          if (data.length)
            await model.createMany({
              data: data as any[],
              skipDuplicates: false,
            });
        };
        await createMany(tx.course, tables.courses);
        await createMany(tx.chapter, tables.chapters);
        await createMany(tx.courseChapter, tables.courseChapters);
        await createMany(tx.role, tables.roles);
        await createMany(tx.appUser, tables.appUsers);
        await createMany(tx.student, tables.students);
        await createMany(tx.exam, tables.exams);
        await createMany(tx.examCourse, tables.examCourses);
        await createMany(tx.grade, tables.grades);
        await createMany(tx.opportunityLog, tables.opportunityLogs);
        await createMany(tx.studentLeave, tables.studentLeaves);
        await createMany(tx.studentCall, tables.studentCalls);
        await createMany(tx.studentNote, tables.studentNotes);
        await createMany(
          tx.gradeEntryMissingNote,
          tables.gradeEntryMissingNotes,
        );
        await createMany(tx.correctionSheet, tables.correctionSheets);
        await createMany(
          tx.telegramExamSubmission,
          tables.telegramExamSubmissions,
        );
        await createMany(
          tx.telegramExamSubmissionVersion,
          tables.telegramExamSubmissionVersions,
        );
        await createMany(
          tx.studentLeaveGradeBackup,
          tables.studentLeaveGradeBackups,
        );
        await createMany(
          tx.studentEnrollmentArchive,
          tables.studentEnrollmentArchives,
        );
        await createMany(tx.permissionCatalog, tables.permissionCatalog);
        await createMany(tx.auditLog, tables.auditLogs);
        for (const rawRow of tables.logClearBackups as LogClearBackupRow[]) {
          const row = rawRow as unknown as Record<string, unknown>;
          await tx.$executeRawUnsafe(
            `INSERT INTO "LogClearBackup" (
            "id", "createdAt", "createdById", "createdByName", "scopeIds", "scopeLabels",
            "dateFrom", "dateTo", "rangeLabel", "auditLogs", "opportunityLogs",
            "auditCount", "opportunityCount", "restoredAt", "restoredById", "restoredByName"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            String(row.id || ""),
            requiredDate(row.createdAt, "LogClearBackup.createdAt"),
            row.createdById == null ? null : String(row.createdById),
            row.createdByName == null ? null : String(row.createdByName),
            String(row.scopeIds || "[]"),
            String(row.scopeLabels || "[]"),
            row.dateFrom == null ? null : String(row.dateFrom),
            row.dateTo == null ? null : String(row.dateTo),
            String(row.rangeLabel || ""),
            String(row.auditLogs || "[]"),
            String(row.opportunityLogs || "[]"),
            Number(row.auditCount || 0),
            Number(row.opportunityCount || 0),
            optionalDate(row.restoredAt, "LogClearBackup.restoredAt"),
            row.restoredById == null ? null : String(row.restoredById),
            row.restoredByName == null ? null : String(row.restoredByName),
          );
        }

        const restoredPrincipalExists = (
          tables.appUsers as Array<{ id?: unknown }>
        ).some((user) => String(user?.id || "") === principal.id);
        await tx.auditLog.create({
          data: {
            module: "النسخ الاحتياطي",
            action: "استعادة نسخة نظام كاملة",
            details: JSON.stringify({
              counts,
              checksum: computedChecksum,
              backupExportedAt: backup.exportedAt,
            }),
            userId: restoredPrincipalExists ? principal.id : null,
            userName: principal.name || principal.username || "مدير النظام",
          },
        });
      },
      { isolationLevel: "Serializable", timeout: 120000 },
    );
    return NextResponse.json({
      ok: true,
      restored: true,
      counts,
      checksum: computedChecksum,
      message:
        "تمت استعادة كل جداول النظام. يجب تسجيل الدخول مجدداً للتأكد من تطابق الجلسة مع الحسابات المستعادة.",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر استعادة النسخة الكاملة. لم تُحفظ أي استعادة جزئية إذا فشلت المعاملة.",
    );
  }
}
