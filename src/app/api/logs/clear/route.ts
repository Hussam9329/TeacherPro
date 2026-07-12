export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getAuthPrincipal } from '@/lib/server-auth';
import { verifyPassword } from '@/lib/passwords';
import { routeErrorResponse } from '@/lib/route-helpers';
import { ensureInitialAdminSeed } from '@/lib/admin-seed';
import { writeSecurityAudit } from '@/lib/security-audit';
import { ensureLogClearBackupTable, insertLogClearBackup } from '@/lib/log-clear-backups';
import { API_RATE_LIMITS, checkApiRateLimit } from '@/lib/api-rate-limit';
import { recalculateStudentsAcademicState } from '@/lib/academic-recalculate-server';
import { lockStudentsAcademicState } from '@/lib/academic-student-lock-server';

const CLEAR_SCOPE_DEFINITIONS = {
  'audit-all': {
    label: 'كل سجلات الإجراءات',
    modules: null,
    includesAudit: true,
    includesOpportunity: false,
  },
  'audit-grades': {
    label: 'إجراءات الدرجات',
    modules: ['الدرجات'],
    includesAudit: true,
    includesOpportunity: false,
  },
  'audit-students': {
    label: 'إجراءات الطلاب والتسجيل',
    modules: ['تسجيل الطلاب', 'سجل الطلاب', 'الطلاب'],
    includesAudit: true,
    includesOpportunity: false,
  },
  'audit-exams': {
    label: 'إجراءات صناعة الامتحان والدورات والفصول',
    modules: ['الامتحانات', 'الدورات', 'الفصول والفرص'],
    includesAudit: true,
    includesOpportunity: false,
  },
  'audit-followup': {
    label: 'إجراءات المكالمات والمتابعة والإجازات',
    modules: ['المتابعة'],
    includesAudit: true,
    includesOpportunity: false,
  },
  'audit-correction': {
    label: 'إجراءات التصحيح الإلكتروني',
    modules: ['التصحيح الإلكتروني'],
    includesAudit: true,
    includesOpportunity: false,
  },
  'audit-accounts': {
    label: 'إجراءات الحسابات والصلاحيات والأمان وتسجيل الدخول',
    modules: ['الحسابات', 'أمان الحسابات', 'تسجيل الدخول', 'الصلاحيات', 'إدارة الحسابات'],
    includesAudit: true,
    includesOpportunity: false,
  },
  'audit-exports': {
    label: 'إجراءات التصدير والنسخ الاحتياطي',
    modules: ['تصدير', 'النسخ الاحتياطي'],
    includesAudit: true,
    includesOpportunity: false,
  },
  'opportunity-logs': {
    label: 'سجل حركات الفرص',
    modules: [],
    includesAudit: false,
    includesOpportunity: true,
  },
} as const;

type ClearScopeId = keyof typeof CLEAR_SCOPE_DEFINITIONS;
const CLEAR_SCOPE_IDS = Object.keys(CLEAR_SCOPE_DEFINITIONS) as ClearScopeId[];

function parseScopeIds(value: unknown): ClearScopeId[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<ClearScopeId>();
  value.forEach((item) => {
    const id = String(item || '').trim() as ClearScopeId;
    if (CLEAR_SCOPE_IDS.includes(id)) unique.add(id);
  });
  return [...unique];
}

function parseDateOnly(value: unknown, fieldLabel: string): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${fieldLabel} غير صالح. استخدم صيغة YYYY-MM-DD.`);
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldLabel} غير صالح.`);
  }
  return parsed;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildDateFilter(field: 'time' | 'date', from: Date | null, toExclusive: Date | null) {
  const range: { gte?: Date; lt?: Date } = {};
  if (from) range.gte = from;
  if (toExclusive) range.lt = toExclusive;
  return Object.keys(range).length ? { [field]: range } : {};
}

function buildAuditWhere(scopes: ClearScopeId[], dateFrom: Date | null, dateToExclusive: Date | null): Prisma.AuditLogWhereInput | null {
  const auditScopes = scopes.filter((scope) => CLEAR_SCOPE_DEFINITIONS[scope].includesAudit);
  if (!auditScopes.length) return null;

  const hasAllAudit = auditScopes.includes('audit-all');
  const moduleNames = hasAllAudit
    ? []
    : auditScopes.flatMap((scope) => CLEAR_SCOPE_DEFINITIONS[scope].modules || []);

  const where: Prisma.AuditLogWhereInput = {
    ...buildDateFilter('time', dateFrom, dateToExclusive),
  };

  if (!hasAllAudit) {
    const uniqueModules = [...new Set(moduleNames)];
    if (!uniqueModules.length) return null;
    where.module = { in: uniqueModules };
  }

  return where;
}

function buildOpportunityWhere(scopes: ClearScopeId[], dateFrom: Date | null, dateToExclusive: Date | null): Prisma.OpportunityLogWhereInput | null {
  if (!scopes.some((scope) => CLEAR_SCOPE_DEFINITIONS[scope].includesOpportunity)) return null;
  return {
    ...buildDateFilter('date', dateFrom, dateToExclusive),
  };
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

    const body = await req.json().catch(() => ({})) as {
      password?: unknown;
      scopeIds?: unknown;
      dateFrom?: unknown;
      dateTo?: unknown;
      confirmImpact?: unknown;
      confirmText?: unknown;
    };
    const password = String(body.password ?? '').trim();
    if (!password) {
      return NextResponse.json({ error: 'أدخل رمز حساب الأدمن لتأكيد التصفير.' }, { status: 400 });
    }

    const scopeIds = parseScopeIds(body.scopeIds);
    if (!scopeIds.length) {
      return NextResponse.json({ error: 'اختر نوع واحد على الأقل من السجلات المراد تصفيرها.' }, { status: 400 });
    }

    let dateFrom: Date | null = null;
    let dateTo: Date | null = null;
    try {
      dateFrom = parseDateOnly(body.dateFrom, 'تاريخ البداية');
      dateTo = parseDateOnly(body.dateTo, 'تاريخ النهاية');
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'الفترة الزمنية غير صالحة.' }, { status: 400 });
    }

    if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
      return NextResponse.json({ error: 'تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية.' }, { status: 400 });
    }

    const adminUser = await db.appUser.findUnique({
      where: { id: principal.id },
      select: { passwordHash: true },
    });
    if (!adminUser || !(await verifyPassword(password, adminUser.passwordHash))) {
      return NextResponse.json({ error: 'رمز حساب الأدمن غير صحيح.' }, { status: 403 });
    }

    const dateToExclusive = dateTo ? addDays(dateTo, 1) : null;
    const auditWhere = buildAuditWhere(scopeIds, dateFrom, dateToExclusive);
    const opportunityWhere = buildOpportunityWhere(scopeIds, dateFrom, dateToExclusive);

    if (!auditWhere && !opportunityWhere) {
      return NextResponse.json({ error: 'لم يتم تحديد سجلات قابلة للتصفير.' }, { status: 400 });
    }
    if (opportunityWhere && (body.confirmImpact !== true || String(body.confirmText || '').trim() !== 'حذف سجل الفرص وإعادة الاحتساب')) {
      return NextResponse.json({
        error: 'سجل الفرص جزء من الحساب الأكاديمي وليس تنظيفاً بصرياً. أكد الحذف وإعادة الاحتساب بكتابة «حذف سجل الفرص وإعادة الاحتساب».',
        confirmationRequired: true,
      }, { status: 409 });
    }

    const selectedLabels = scopeIds.map((scope) => CLEAR_SCOPE_DEFINITIONS[scope].label);
    const rangeLabel = dateFrom || dateTo
      ? `${body.dateFrom ? String(body.dateFrom) : 'أول سجل'} إلى ${body.dateTo ? String(body.dateTo) : 'آخر سجل'}`
      : 'كل المدة';

    await ensureLogClearBackupTable();

    const backupId = `lcb_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const { auditLogsResult, opportunityLogsResult, savedBackupId, academicRecalculation, studentImpact } = await db.$transaction(async (tx) => {
      const auditLogsToDelete = auditWhere
        ? await tx.auditLog.findMany({ where: auditWhere })
        : [];
      const opportunityLogsToDelete = opportunityWhere
        ? await tx.opportunityLog.findMany({ where: opportunityWhere })
        : [];
      const affectedStudentIds: string[] = Array.from(
        new Set(
          opportunityLogsToDelete
            .map((log) => String((log as { studentId?: unknown }).studentId || ""))
            .filter(Boolean),
        ),
      ) as string[];
      if (affectedStudentIds.length) await lockStudentsAcademicState(tx, affectedStudentIds);
      const beforeStudents = affectedStudentIds.length
        ? await tx.student.findMany({ where: { id: { in: affectedStudentIds } }, select: { id: true, opportunities: true, status: true } })
        : [];

      const hasBackupRows = auditLogsToDelete.length > 0 || opportunityLogsToDelete.length > 0;
      if (hasBackupRows) {
        await insertLogClearBackup(tx, {
          id: backupId,
          createdById: principal.id,
          createdByName: principal.name || principal.username || 'admin',
          scopeIds,
          scopeLabels: selectedLabels,
          dateFrom: body.dateFrom ? String(body.dateFrom) : '',
          dateTo: body.dateTo ? String(body.dateTo) : '',
          rangeLabel,
          auditLogs: auditLogsToDelete,
          opportunityLogs: opportunityLogsToDelete,
        });
      }

      const auditLogsResult = auditWhere
        ? await tx.auditLog.deleteMany({ where: auditWhere })
        : { count: 0 };
      const opportunityLogsResult = opportunityWhere
        ? await tx.opportunityLog.deleteMany({ where: opportunityWhere })
        : { count: 0 };
      const academicRecalculation = affectedStudentIds.length
        ? await recalculateStudentsAcademicState(affectedStudentIds, { tx })
        : null;
      const afterStudents = affectedStudentIds.length
        ? await tx.student.findMany({ where: { id: { in: affectedStudentIds } }, select: { id: true, opportunities: true, status: true } })
        : [];
      const afterById = new Map(afterStudents.map((student) => [student.id, student]));
      const studentImpact = beforeStudents.map((before) => ({ before, after: afterById.get(before.id) || null }));
      return {
        auditLogsResult,
        opportunityLogsResult,
        savedBackupId: hasBackupRows ? backupId : null,
        academicRecalculation,
        studentImpact,
      };
    });

    await writeSecurityAudit(principal, 'تصفير سجلات محددة', {
      scopes: selectedLabels,
      range: rangeLabel,
      deletedAuditLogs: auditLogsResult.count,
      deletedOpportunityLogs: opportunityLogsResult.count,
      backupId: savedBackupId,
      affectedStudents: studentImpact,
      recalculatedStudents: academicRecalculation?.students?.length || 0,
    });

    return NextResponse.json({
      ok: true,
      deleted: auditLogsResult.count + opportunityLogsResult.count,
      deletedAuditLogs: auditLogsResult.count,
      deletedOpportunityLogs: opportunityLogsResult.count,
      scopeIds,
      dateFrom: body.dateFrom ? String(body.dateFrom) : '',
      dateTo: body.dateTo ? String(body.dateTo) : '',
      backupId: savedBackupId,
      canRestore: Boolean(savedBackupId),
      academicRecalculation,
      studentImpact,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تصفير السجلات حالياً.');
  }
}
