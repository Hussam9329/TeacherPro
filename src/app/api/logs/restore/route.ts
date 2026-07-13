export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getAuthPrincipal } from '@/lib/server-auth';
import { verifyPassword } from '@/lib/passwords';
import { routeErrorResponse } from '@/lib/route-helpers';
import { ensureInitialAdminSeed } from '@/lib/admin-seed';
import { writeSecurityAudit } from '@/lib/security-audit';
import {
  ensureLogClearBackupTable,
  parseBackupJsonArray,
  type LogClearBackupRow,
} from '@/lib/log-clear-backups';
import { API_RATE_LIMITS, checkApiRateLimit } from '@/lib/api-rate-limit';
import { recalculateStudentsAcademicState } from '@/lib/academic-recalculate-server';

function safeDate(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function textOrEmpty(value: unknown): string {
  return String(value ?? '');
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(req: NextRequest) {
  try {
    const principal = await getAuthPrincipal(req);
    if (!principal) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
    }
    if (!principal.isAdmin) {
      return NextResponse.json({ error: 'هذه العملية متاحة لمدير النظام فقط.' }, { status: 403 });
    }

    const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.adminHeavy);
    if (rateLimitError) return rateLimitError;

    await ensureInitialAdminSeed();

    const body = await req.json().catch(() => ({})) as { password?: unknown; backupId?: unknown };
    const password = String(body.password ?? '').trim();
    if (!password) {
      return NextResponse.json({ error: 'أدخل رمز حساب الأدمن لتأكيد الاستعادة.' }, { status: 400 });
    }

    const adminUser = await db.appUser.findUnique({
      where: { id: principal.id },
      select: { passwordHash: true },
    });
    if (!adminUser || !(await verifyPassword(password, adminUser.passwordHash))) {
      return NextResponse.json({ error: 'رمز حساب الأدمن غير صحيح.' }, { status: 403 });
    }

    await ensureLogClearBackupTable();

    const requestedBackupId = String(body.backupId ?? '').trim();
    const backups = requestedBackupId
      ? await db.$queryRaw<LogClearBackupRow[]>`
          SELECT * FROM "LogClearBackup"
          WHERE "id" = ${requestedBackupId} AND "restoredAt" IS NULL
          LIMIT 1
        `
      : await db.$queryRaw<LogClearBackupRow[]>`
          SELECT * FROM "LogClearBackup"
          WHERE "restoredAt" IS NULL
          ORDER BY "createdAt" DESC
          LIMIT 1
        `;

    const backup = backups[0];
    if (!backup) {
      return NextResponse.json({ error: 'لا توجد نسخة قابلة للاستعادة من آخر تصفير.' }, { status: 404 });
    }

    const auditLogs = parseBackupJsonArray<Record<string, unknown>>(backup.auditLogs);
    const opportunityLogs = parseBackupJsonArray<Record<string, unknown>>(backup.opportunityLogs);

    const auditUserIds = [...new Set(auditLogs.map((log) => textOrNull(log.userId)).filter(Boolean) as string[])];
    const existingAuditUsers = auditUserIds.length
      ? new Set((await db.appUser.findMany({ where: { id: { in: auditUserIds } }, select: { id: true } })).map((user) => user.id))
      : new Set<string>();

    const opportunityStudentIds = [...new Set(opportunityLogs.map((log) => textOrNull(log.studentId)).filter(Boolean) as string[])];
    const existingStudents = opportunityStudentIds.length
      ? new Set((await db.student.findMany({ where: { id: { in: opportunityStudentIds } }, select: { id: true } })).map((student) => student.id))
      : new Set<string>();

    const opportunityExamIds = [...new Set(opportunityLogs.map((log) => textOrNull(log.examId)).filter(Boolean) as string[])];
    const existingExams = opportunityExamIds.length
      ? new Set((await db.exam.findMany({ where: { id: { in: opportunityExamIds } }, select: { id: true } })).map((exam) => exam.id))
      : new Set<string>();

    const opportunityChapterIds = [...new Set(opportunityLogs.map((log) => textOrNull(log.chapterId)).filter(Boolean) as string[])];
    const chapterNameById = opportunityChapterIds.length
      ? new Map((await db.chapter.findMany({ where: { id: { in: opportunityChapterIds } }, select: { id: true, name: true } })).map((chapter) => [chapter.id, chapter.name]))
      : new Map<string, string>();

    const auditData: Prisma.AuditLogCreateManyInput[] = auditLogs.map((log) => {
      const userId = textOrNull(log.userId);
      return {
        id: textOrEmpty(log.id) || undefined,
        module: textOrEmpty(log.module) || 'غير محدد',
        action: textOrEmpty(log.action) || 'استعادة سجل',
        details: textOrNull(log.details),
        time: safeDate(log.time),
        userId: userId && existingAuditUsers.has(userId) ? userId : null,
        userName: textOrNull(log.userName),
      };
    });

    const opportunityData: Prisma.OpportunityLogCreateManyInput[] = opportunityLogs
      .map((log): Prisma.OpportunityLogCreateManyInput | null => {
        const studentId = textOrNull(log.studentId);
        if (!studentId || !existingStudents.has(studentId)) return null;
        const examId = textOrNull(log.examId);
        return {
          id: textOrEmpty(log.id) || undefined,
          action: textOrEmpty(log.action) || 'استعادة حركة فرصة',
          amount: numberOrZero(log.amount),
          reason: textOrNull(log.reason),
          date: safeDate(log.date),
          chapterId: textOrNull(log.chapterId) && chapterNameById.has(String(textOrNull(log.chapterId))) ? textOrNull(log.chapterId) : null,
          chapterNameSnapshot: textOrNull(log.chapterId) && chapterNameById.has(String(textOrNull(log.chapterId)))
            ? chapterNameById.get(String(textOrNull(log.chapterId))) || null
            : textOrNull(log.chapterNameSnapshot),
          studentId,
          examId: examId && existingExams.has(examId) ? examId : null,
        };
      })
      .filter((row): row is Prisma.OpportunityLogCreateManyInput => Boolean(row));

    const result = await db.$transaction(async (tx) => {
      const restoredAuditLogs = auditData.length
        ? await tx.auditLog.createMany({ data: auditData, skipDuplicates: true })
        : { count: 0 };
      const restoredOpportunityLogs = opportunityData.length
        ? await tx.opportunityLog.createMany({ data: opportunityData, skipDuplicates: true })
        : { count: 0 };

      await tx.$executeRaw`
        UPDATE "LogClearBackup"
        SET
          "restoredAt" = NOW(),
          "restoredById" = ${principal.id},
          "restoredByName" = ${principal.name || principal.username || 'admin'}
        WHERE "id" = ${backup.id} AND "restoredAt" IS NULL
      `;

      // Q93 FIX: After restoring opportunity logs, re-run academic
      // recalculation for all affected students so their opportunity
      // balances and dismissal status reflect the restored logs.
      // Previously, restored logs appeared in the list but
      // student.opportunities and student.status were not updated.
      let academicRecalculation: { students: Array<{ id: string }> } | null = null;
      if (opportunityData.length > 0) {
        const affectedStudentIds = [...new Set(opportunityData.map((log) => log.studentId))];
        if (affectedStudentIds.length > 0) {
          academicRecalculation = await recalculateStudentsAcademicState(
            affectedStudentIds,
            { tx },
          ) as { students: Array<{ id: string }> } | null;
        }
      }

      return { restoredAuditLogs, restoredOpportunityLogs, academicRecalculation };
    });

    await writeSecurityAudit(principal, 'استعادة آخر تصفير للسجلات', {
      backupId: backup.id,
      originalRange: backup.rangeLabel,
      restoredAuditLogs: result.restoredAuditLogs.count,
      restoredOpportunityLogs: result.restoredOpportunityLogs.count,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });

    return NextResponse.json({
      ok: true,
      backupId: backup.id,
      restored: result.restoredAuditLogs.count + result.restoredOpportunityLogs.count,
      restoredAuditLogs: result.restoredAuditLogs.count,
      restoredOpportunityLogs: result.restoredOpportunityLogs.count,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
      skippedOpportunityLogs: opportunityLogs.length - opportunityData.length,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر استعادة آخر تصفير حالياً.');
  }
}
