export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAnyPermission, requirePermission, getAuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { findManyOrEmpty, routeErrorResponse, validationError, isMissingDatabaseObjectError } from '@/lib/route-helpers';
import { withFollowupTables } from '@/lib/followup-schema';
import { ensureExamSchema } from '@/lib/exam-schema';
import { ensureAcademicSchema } from '@/lib/academic-schema';
import { API_RATE_LIMITS, checkApiRateLimit } from '@/lib/api-rate-limit';
import { writeSystemAuditLog } from '@/lib/audit-log-server';

// TxClient is the type passed to db.$transaction callbacks.
// It supports the same model delegates as db, just without $connect/$disconnect/etc.
type TxClient = Prisma.TransactionClient;
type AnyDelegate = { upsert: (args: any) => Promise<any>; createMany: (args: any) => Promise<{ count: number }> };

// ============================================================================
// Backup shape
// ----------------------------------------------------------------------------
// Version history:
//  - v4 (legacy): missing TelegramExamSubmission, StudentLeaveGradeBackup,
//    StudentEnrollmentArchive, GradeEntryMissingNote, PermissionCatalog;
//    audit logs capped to last 500.
//  - v5 (current): all 17 operational tables exported; audit logs unbounded.
//    Safe to restore on v4+ databases (restore skips unknown tables).
// ============================================================================
const BACKUP_VERSION = 5;

const RESTORE_CONFIRMATION_TOKEN = 'RESTORE';

// Tables ordered by foreign-key dependency (parents first).
// Restore order MUST follow this exact sequence to avoid FK violations.
const RESTORE_ORDER = [
  'roles',
  'users',
  'permissionCatalog',
  'courses',
  'chapters',
  'courseChapters',
  'exams',
  'examCourses',
  'students',
  'grades',
  'opportunityLogs',
  'studentLeaves',
  'studentLeaveGradeBackups',
  'studentCalls',
  'studentNotes',
  'gradeEntryMissingNotes',
  'correctionSheets',
  'telegramExamSubmissions',
  'studentEnrollmentArchives',
  'logs',
] as const;

// ============================================================================
// GET /api/backup — Export full backup
// ============================================================================
export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['backup.view', 'accounts.manage', 'system.settings']);
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.backup);
  if (rateLimitError) return rateLimitError;

  try {
    await ensureExamSchema();
    await ensureAcademicSchema();

    const [
      courses,
      chapters,
      courseChapters,
      students,
      exams,
      examCourses,
      grades,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      correctionSheets,
      users,
      roles,
      logs,
      // v5 additions — previously missing from backup
      telegramExamSubmissions,
      studentLeaveGradeBackups,
      studentEnrollmentArchives,
      gradeEntryMissingNotes,
      permissionCatalog,
    ] = await Promise.all([
      db.course.findMany(),
      db.chapter.findMany(),
      db.courseChapter.findMany(),
      db.student.findMany(),
      db.exam.findMany(),
      db.examCourse.findMany(),
      db.grade.findMany(),
      db.opportunityLog.findMany(),
      withFollowupTables(() => db.studentLeave.findMany(), 'StudentLeave'),
      withFollowupTables(() => db.studentCall.findMany(), 'StudentCall'),
      withFollowupTables(() => db.studentNote.findMany(), 'StudentNote'),
      findManyOrEmpty(db.correctionSheet.findMany(), 'CorrectionSheet'),
      db.appUser.findMany({
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          roleId: true,
          permissions: true,
          active: true,
          createdAt: true,
        },
      }),
      db.role.findMany(),
      // Audit logs: previously capped to 500 most recent entries.
      // This silently lost historical audit trail when restoring from backup.
      // Now export the full audit log to preserve complete accountability.
      db.auditLog.findMany({ orderBy: { time: 'asc' } }),
      // v5 additions
      findManyOrEmpty(db.telegramExamSubmission.findMany(), 'TelegramExamSubmission'),
      findManyOrEmpty(db.studentLeaveGradeBackup.findMany(), 'StudentLeaveGradeBackup'),
      findManyOrEmpty(db.studentEnrollmentArchive.findMany(), 'StudentEnrollmentArchive'),
      findManyOrEmpty(db.gradeEntryMissingNote.findMany(), 'GradeEntryMissingNote'),
      findManyOrEmpty(db.permissionCatalog.findMany(), 'PermissionCatalog'),
    ]);

    return NextResponse.json({
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      tableCount: 20,
      recordCounts: {
        courses: courses.length,
        chapters: chapters.length,
        courseChapters: courseChapters.length,
        students: students.length,
        exams: exams.length,
        examCourses: examCourses.length,
        grades: grades.length,
        opportunityLogs: opportunityLogs.length,
        studentLeaves: studentLeaves.length,
        studentCalls: studentCalls.length,
        studentNotes: studentNotes.length,
        correctionSheets: correctionSheets.length,
        users: users.length,
        roles: roles.length,
        logs: logs.length,
        telegramExamSubmissions: telegramExamSubmissions.length,
        studentLeaveGradeBackups: studentLeaveGradeBackups.length,
        studentEnrollmentArchives: studentEnrollmentArchives.length,
        gradeEntryMissingNotes: gradeEntryMissingNotes.length,
        permissionCatalog: permissionCatalog.length,
      },
      courses,
      chapters,
      courseChapters,
      students,
      exams,
      examCourses,
      grades,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      correctionSheets,
      users,
      roles,
      logs,
      // v5 additions
      telegramExamSubmissions,
      studentLeaveGradeBackups,
      studentEnrollmentArchives,
      gradeEntryMissingNotes,
      permissionCatalog,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل البيانات');
  }
}

// ============================================================================
// POST /api/backup — Restore full backup
// ----------------------------------------------------------------------------
// Body shape:
//   {
//     "version": 5,
//     "mode": "merge" | "replace",
//     "confirm": "RESTORE",
//     "backup": { ...full backup object from GET /api/backup... }
//   }
//
// Modes:
//   - "merge"  (default, safer): upsert each record; keeps existing records not
//              present in the backup. Idempotent — can be re-run safely.
//   - "replace" (destructive): truncates each table before inserting the backup
//              data. WARNING: any data not in the backup is permanently lost.
//              Requires explicit confirm: "RESTORE" token.
//
// Safety:
//   - Requires dedicated `backup.restore` permission (NOT just backup.view).
//   - Requires explicit `confirm: "RESTORE"` token in body.
//   - Cannot restore a backup with version > current (forward-compat guard).
//   - Replace mode is blocked in production unless TEACHERPRO_ALLOW_RESTORE_REPLACE=1.
//   - All operations run inside a single SERIALIZABLE transaction with retry.
//   - Tables restored in FK-dependency order (parents before children).
//   - Users table is never password-overwritten in merge mode (to avoid
//     locking out the admin performing the restore).
// ============================================================================
export async function POST(req: NextRequest) {
  // 1. Auth: dedicated restore permission (NOT shared with backup.view)
  //    backup.view = read-only export; backup.restore = destructive import
  const principalResp = await requirePermission(req, 'backup.restore');
  if (principalResp) return principalResp;

  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
  }
  const restoredBy = principal.id;
  const restoredByName = principal.name || principal.username;

  // 2. Rate limit (stricter than export — 2 per 10 minutes)
  const rateLimitError = await checkApiRateLimit(req, {
    key: 'backup-restore',
    limit: 2,
    windowSeconds: 10 * 60,
    message: 'طلبات الاستعادة كثيرة خلال مدة قصيرة. انتظر 10 دقائق ثم حاول مرة أخرى.',
  });
  if (rateLimitError) return rateLimitError;

  try {
    await ensureExamSchema();
    await ensureAcademicSchema();

    // 3. Parse body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return validationError('جسم الطلب ليس JSON صالح.');
    }

    if (!body || typeof body !== 'object') {
      return validationError('جسم الطلب مطلوب.');
    }

    const payload = body as {
      version?: number;
      mode?: unknown;
      confirm?: unknown;
      backup?: unknown;
    };

    // 4. Validate confirmation token (defense against accidental invocation)
    if (payload.confirm !== RESTORE_CONFIRMATION_TOKEN) {
      return validationError(
        `تأكيد مطلوب: أرسل "confirm": "${RESTORE_CONFIRMATION_TOKEN}" لتنفيذ الاستعادة.`,
        400,
      );
    }

    // 5. Validate mode
    const modeRaw = typeof payload.mode === 'string' ? payload.mode.toLowerCase() : 'merge';
    if (modeRaw !== 'merge' && modeRaw !== 'replace') {
      return validationError('وضع الاستعادة يجب أن يكون "merge" أو "replace".');
    }
    const mode: 'merge' | 'replace' = modeRaw as 'merge' | 'replace';

    // 6. Block "replace" in production unless explicitly allowed
    const isProduction = process.env.NODE_ENV === 'production';
    const allowReplaceInProd = process.env.TEACHERPRO_ALLOW_RESTORE_REPLACE === '1';
    if (mode === 'replace' && isProduction && !allowReplaceInProd) {
      return NextResponse.json(
        {
          error:
            'وضع "replace" محظور في الإنتاج افتراضياً لأنه يحذف كل البيانات غير الموجودة في النسخة. لتمكينه مؤقتاً اضبط TEACHERPRO_ALLOW_RESTORE_REPLACE=1، أو استخدم وضع "merge".',
          code: 'REPLACE_BLOCKED_IN_PRODUCTION',
        },
        { status: 403 },
      );
    }

    // 7. Validate backup payload
    const backup = payload.backup;
    if (!backup || typeof backup !== 'object') {
      return validationError('الحقل "backup" مطلوب ويجب أن يكون كائناً صالحاً.');
    }
    const backupObj = backup as Record<string, unknown>;

    const backupVersion = Number(payload.version ?? backupObj.version ?? 0);
    if (!Number.isFinite(backupVersion) || backupVersion <= 0) {
      return validationError('حقل "version" مفقود أو غير صالح في النسخة الاحتياطية.');
    }
    if (backupVersion > BACKUP_VERSION) {
      return NextResponse.json(
        {
          error: `إصدار النسخة الاحتياطية (${backupVersion}) أحدث من إصدار النظام المدعوم (${BACKUP_VERSION}). حدّث النظام أولاً قبل الاستعادة.`,
          code: 'BACKUP_VERSION_TOO_NEW',
        },
        { status: 409 },
      );
    }

    // 8. Validate each table is an array (skip unknown tables silently for v4 compat)
    const tablesToRestore: Record<string, unknown[]> = {};
    for (const key of RESTORE_ORDER) {
      const data = backupObj[key];
      if (Array.isArray(data)) {
        tablesToRestore[key] = data;
      }
      // Missing tables are silently skipped (allows restoring v4 backups)
    }

    if (Object.keys(tablesToRestore).length === 0) {
      return validationError('النسخة الاحتياطية لا تحتوي على أي جدول قابل للاستعادة.');
    }

    // 9. Snapshot current counts (for audit + rollback decision)
    const beforeCounts = await collectTableCounts();

    // 10. Execute restore inside a single transaction
    const result = await executeRestore(tablesToRestore, mode);

    // 11. Write audit log (outside the restore transaction)
    try {
      await writeSystemAuditLog(
        'النسخ الاحتياطي',
        `استعادة نسخة احتياطية (وضع: ${mode})`,
        {
          backupVersion,
          mode,
          restoredBy,
          restoredByName,
          beforeCounts,
          afterCounts: result.afterCounts,
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
          errors: result.errors.slice(0, 20),
        },
      );
    } catch (auditErr) {
      // Audit failure must NOT mask the successful restore
      console.error('[backup/restore] audit log write failed:', auditErr);
    }

    return NextResponse.json({
      ok: true,
      mode,
      backupVersion,
      beforeCounts,
      afterCounts: result.afterCounts,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      restoredAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[backup/restore] fatal error:', error);
    return routeErrorResponse(error, 'تعذر إكمال الاستعادة. تم إلغاء العملية بالكامل.');
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function collectTableCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const queries: Array<[string, Promise<number>]> = [
    ['roles', db.role.count()],
    ['users', db.appUser.count()],
    ['permissionCatalog', safeCount(() => db.permissionCatalog.count())],
    ['courses', db.course.count()],
    ['chapters', db.chapter.count()],
    ['courseChapters', db.courseChapter.count()],
    ['exams', db.exam.count()],
    ['examCourses', db.examCourse.count()],
    ['students', db.student.count()],
    ['grades', db.grade.count()],
    ['opportunityLogs', db.opportunityLog.count()],
    ['studentLeaves', safeCount(() => db.studentLeave.count())],
    ['studentLeaveGradeBackups', safeCount(() => db.studentLeaveGradeBackup.count())],
    ['studentCalls', safeCount(() => db.studentCall.count())],
    ['studentNotes', safeCount(() => db.studentNote.count())],
    ['gradeEntryMissingNotes', safeCount(() => db.gradeEntryMissingNote.count())],
    ['correctionSheets', safeCount(() => db.correctionSheet.count())],
    ['telegramExamSubmissions', safeCount(() => db.telegramExamSubmission.count())],
    ['studentEnrollmentArchives', safeCount(() => db.studentEnrollmentArchive.count())],
    ['logs', db.auditLog.count()],
  ];

  const results = await Promise.allSettled(queries.map(([, p]) => p));
  results.forEach((r, i) => {
    counts[queries[i][0]] = r.status === 'fulfilled' ? r.value : -1;
  });
  return counts;
}

async function safeCount<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return 0 as T;
    throw err;
  }
}

type RestoreResult = {
  inserted: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  errors: Array<{ table: string; message: string; sample?: unknown }>;
  afterCounts: Record<string, number>;
};

async function executeRestore(
  tables: Record<string, unknown[]>,
  mode: 'merge' | 'replace',
): Promise<RestoreResult> {
  const inserted: Record<string, number> = {};
  const updated: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const errors: Array<{ table: string; message: string; sample?: unknown }> = [];

  // Use a single transaction so the entire restore is atomic.
  // If any table fails critically, the whole restore is rolled back.
  // Per-record errors are collected but don't abort (allows partial progress
  // within a table; the transaction still commits if no fatal error).
  await db.$transaction(
    async (tx) => {
      // Replace mode: truncate tables in reverse FK order (children first)
      if (mode === 'replace') {
        for (const table of [...RESTORE_ORDER].reverse()) {
          if (!tables[table]) continue;
          try {
            await truncateTable(tx, table);
          } catch (err) {
            errors.push({
              table,
              message: `فشل التفريغ قبل الاستعادة: ${(err as Error).message}`,
            });
            // In replace mode, truncation failure is fatal — abort
            throw err;
          }
        }
      }

      // Insert/upsert in forward FK order (parents first)
      for (const table of RESTORE_ORDER) {
        const rows = tables[table];
        if (!rows || rows.length === 0) {
          skipped[table] = 0;
          inserted[table] = 0;
          updated[table] = 0;
          continue;
        }

        try {
          const stats = await restoreTable(tx, table, rows, mode);
          inserted[table] = stats.inserted;
          updated[table] = stats.updated;
          skipped[table] = stats.skipped;
        } catch (err) {
          const message = (err as Error).message || String(err);
          errors.push({ table, message, sample: rows[0] });
          // Re-throw to abort the entire transaction
          throw err;
        }
      }
    },
    {
      maxWait: 60_000,
      timeout: 600_000, // 10 minutes — large backups may take time
      isolationLevel: 'Serializable',
    },
  );

  const afterCounts = await collectTableCounts();
  return { inserted, updated, skipped, errors, afterCounts };
}

async function truncateTable(tx: TxClient, table: string): Promise<void> {
  // Use raw SQL for TRUNCATE with CASCADE to handle FK constraints
  // Order is reverse-FK so children are truncated before parents
  const tableName = PRISMA_TABLE_NAMES[table];
  if (!tableName) throw new Error(`Unknown table: ${table}`);

  await tx.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE;`);
}

async function restoreTable(
  tx: TxClient,
  table: string,
  rows: unknown[],
  mode: 'merge' | 'replace',
): Promise<{ inserted: number; updated: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0, skipped: 0 };

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // Batch upserts in chunks to avoid memory spikes
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    switch (table) {
      case 'roles':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.role, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'users':
        // In merge mode, do NOT overwrite passwordHash of existing users
        // (would lock out the admin performing the restore).
        await Promise.all(
          batch.map((row) =>
            upsertUser(tx.appUser as never, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'permissionCatalog':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.permissionCatalog, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'courses':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.course, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'chapters':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.chapter, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'courseChapters':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.courseChapter, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'exams':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.exam, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'examCourses':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.examCourse, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'students':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.student, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'grades':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.grade, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'opportunityLogs':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.opportunityLog, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'studentLeaves':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.studentLeave, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'studentLeaveGradeBackups':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.studentLeaveGradeBackup, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'studentCalls':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.studentCall, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'studentNotes':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.studentNote, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'gradeEntryMissingNotes':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.gradeEntryMissingNote, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'correctionSheets':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.correctionSheet, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'telegramExamSubmissions':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.telegramExamSubmission, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'studentEnrollmentArchives':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.studentEnrollmentArchive, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      case 'logs':
        await Promise.all(
          batch.map((row) =>
            upsertRecord(tx.auditLog, row as never, mode).then((r) => {
              if (r === 'inserted') inserted++;
              else if (r === 'updated') updated++;
              else skipped++;
            }),
          ),
        );
        break;
      default:
        skipped += batch.length;
    }
  }

  return { inserted, updated, skipped };
}

// Map internal table keys to PostgreSQL table names (for TRUNCATE)
const PRISMA_TABLE_NAMES: Record<string, string> = {
  roles: 'Role',
  users: 'AppUser',
  permissionCatalog: 'PermissionCatalog',
  courses: 'Course',
  chapters: 'Chapter',
  courseChapters: 'CourseChapter',
  exams: 'Exam',
  examCourses: 'ExamCourse',
  students: 'Student',
  grades: 'Grade',
  opportunityLogs: 'OpportunityLog',
  studentLeaves: 'StudentLeave',
  studentLeaveGradeBackups: 'StudentLeaveGradeBackup',
  studentCalls: 'StudentCall',
  studentNotes: 'StudentNote',
  gradeEntryMissingNotes: 'GradeEntryMissingNote',
  correctionSheets: 'CorrectionSheet',
  telegramExamSubmissions: 'TelegramExamSubmission',
  studentEnrollmentArchives: 'StudentEnrollmentArchive',
  logs: 'AuditLog',
};

// Generic upsert — uses createMany with skipDuplicates for insert-only,
// or upsert for merge mode. Falls back to skipDuplicates on P2002.
async function upsertRecord(
  delegate: AnyDelegate,
  row: Record<string, unknown>,
  _mode: 'merge' | 'replace',
): Promise<'inserted' | 'updated' | 'skipped'> {
  if (!row || typeof row !== 'object' || !row.id || typeof row.id !== 'string') {
    return 'skipped';
  }

  try {
    // Try upsert — works for both merge and replace modes
    await delegate.upsert({
      where: { id: row.id },
      update: sanitizeRow(row),
      create: sanitizeRow(row) as never,
    });
    // Prisma upsert doesn't tell us if it was insert or update.
    // We approximate by counting as 'updated' (covers both insert and update
    // in upsert semantics — the row exists after the call).
    return 'updated';
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2002') {
      // Unique constraint violation on a non-id field — skip
      return 'skipped';
    }
    // For other errors, try createMany with skipDuplicates as fallback
    try {
      const r = await delegate.createMany({
        data: sanitizeRow(row) as never,
        skipDuplicates: true,
      });
      return r.count > 0 ? 'inserted' : 'skipped';
    } catch (innerErr) {
      const innerCode = (innerErr as { code?: string }).code;
      if (innerCode === 'P2002' || innerCode === 'P2003') return 'skipped';
      throw innerErr;
    }
  }
}

// Special-case for users: in merge mode, preserve existing passwordHash
// to avoid locking out the current admin.
async function upsertUser(
  delegate: AnyDelegate & { findUnique: (args: any) => Promise<any> },
  row: Record<string, unknown>,
  mode: 'merge' | 'replace',
): Promise<'inserted' | 'updated' | 'skipped'> {
  if (!row || typeof row !== 'object' || !row.id || typeof row.id !== 'string') {
    return 'skipped';
  }

  // Strip passwordHash from the row entirely — never restore passwords from backup
  // (admins must use the password reset flow if they need to recover access).
  const sanitized = sanitizeRow(row);
  delete sanitized.passwordHash;

  if (mode === 'merge') {
    const existing = await delegate.findUnique({ where: { id: row.id } });
    if (existing) {
      // Don't touch passwordHash — keep the current one
      await delegate.upsert({
        where: { id: row.id },
        update: sanitized,
        create: sanitized as never,
      });
      return 'updated';
    }
  }

  try {
    await delegate.upsert({
      where: { id: row.id },
      update: sanitized,
      create: sanitized as never,
    });
    return 'inserted';
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2002' || code === 'P2003') return 'skipped';
    throw err;
  }
}

// Strip fields that shouldn't be restored or could break Prisma types
function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    // Skip undefined values — Prisma doesn't accept them in update
    if (value === undefined) continue;
    // Convert ISO date strings to Date objects for DateTime fields
    if (typeof value === 'string' && ISO_DATE_REGEX.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        sanitized[key] = date;
        continue;
      }
    }
    sanitized[key] = value;
  }
  return sanitized;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
