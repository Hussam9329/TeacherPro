export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { forbiddenResponse, getAuthPrincipal, requirePermission, unauthorizedResponse, type AuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { routeErrorResponse, validationError } from '@/lib/route-helpers';
import { recalculateStudentsAcademicState } from '@/lib/academic-recalculate-server';
import { confirmationRequiredResponse, isConfirmed, writeAuditLog } from '@/lib/audit-log-server';

function hasPermission(principal: AuthPrincipal, permission: string): boolean {
  return principal.isAdmin || principal.permissions.includes(permission);
}

function hasAnyPermission(principal: AuthPrincipal, permissions: string[]): boolean {
  return permissions.some((permission) => hasPermission(principal, permission));
}

function isAutomaticOpportunityPayload(value: { action?: unknown; reason?: unknown } | null | undefined): boolean {
  const action = String(value?.action || '');
  const reason = String(value?.reason || '');
  return (
    action === 'خصم تلقائي'
    || action === 'فصل تلقائي'
    || reason.startsWith('تلقائي:')
    || reason.includes('[academic-reactivation-link:')
  );
}

function canManageAutomaticAcademicEffects(principal: AuthPrincipal): boolean {
  return hasAnyPermission(principal, [
    'grades.add',
    'grades.edit',
    'grades.delete',
    'exams.edit',
    'exams.delete',
    'opportunities.manage',
  ]);
}

async function requireOpportunityMutation(req: NextRequest, payload?: { action?: unknown; reason?: unknown } | null) {
  const principal = await getAuthPrincipal(req);
  if (!principal) return { principal: null, error: unauthorizedResponse() };
  if (hasPermission(principal, 'opportunities.manage')) return { principal, error: null };
  if (payload && isAutomaticOpportunityPayload(payload) && canManageAutomaticAcademicEffects(principal)) return { principal, error: null };
  return { principal, error: forbiddenResponse() };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'opportunities.view');
  if (authError) return authError;

  try {
    // تأكد من وجود الأعمدة/الجداول الجديدة (chapterNameSnapshot, ExamCourse)
    // قبل الاستعلام. هذا self-healing يمنع خطأ 500 عند عدم تشغيل migration.
    await db.$executeRawUnsafe(`ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "chapterNameSnapshot" TEXT`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OpportunityLog_chapterId_idx" ON "OpportunityLog"("chapterId")`);
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ExamCourse" (
      "id" TEXT NOT NULL,
      "examId" TEXT NOT NULL,
      "courseId" TEXT NOT NULL,
      CONSTRAINT "ExamCourse_pkey" PRIMARY KEY ("id")
    )`);
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ExamCourse_examId_courseId_key" ON "ExamCourse"("examId", "courseId")`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ExamCourse_courseId_idx" ON "ExamCourse"("courseId")`);

    const { parsePagination } = await import('@/lib/pagination');
    const { page, limit, skip } = parsePagination(req);
    const { searchParams } = new URL(req.url);
    const studentId = String(searchParams.get('studentId') || '').trim();
    const where = studentId ? { studentId } : {};
    const [opportunityLogs, totalCount] = await Promise.all([
      db.opportunityLog.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
        include: {
          student: { select: { id: true, name: true, code: true, courseId: true, status: true } },
          exam: { select: { id: true, name: true, date: true, type: true } },
        },
      }),
      db.opportunityLog.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    return NextResponse.json({
      opportunityLogs,
      total: totalCount,
      totalCount,
      page,
      limit,
      pageSize: limit,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل سجل الفرص حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireOpportunityMutation(req);
  if (auth.error) return auth.error;
  return NextResponse.json(
    {
      error:
        "تم إيقاف إنشاء حركات الفرص المباشر. استخدم إجراء الفرص الفردي أو الجماعي ليشتق الخادم الرصيد والحركة الفعلية ويعيد الاحتساب داخل معاملة واحدة.",
      code: "LEGACY_DIRECT_OPPORTUNITY_LOG_DISABLED",
    },
    { status: 410 },
  );
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد حركة الفرص المطلوبة');

    const principal = await getAuthPrincipal(req);
    if (!principal) return unauthorizedResponse();

    const existingLog = await db.opportunityLog.findUnique({
      where: { id },
      select: {
        id: true,
        studentId: true,
        examId: true,
        action: true,
        amount: true,
        reason: true,
        date: true,
        chapterId: true,
        student: { select: { name: true, code: true } },
      },
    });
    if (!existingLog) return NextResponse.json({ ok: true, notFound: true });

    if (!hasPermission(principal, 'opportunities.manage')) {
      if (!isAutomaticOpportunityPayload(existingLog) || !canManageAutomaticAcademicEffects(principal)) {
        return forbiddenResponse();
      }
    }

    const isImpactfulLog = ['خصم', 'إضافة', 'إعادة تعيين', 'إعادة تفعيل', 'خصم تلقائي', 'فصل تلقائي'].includes(String(existingLog.action || ''))
      || Number(existingLog.amount || 0) > 0
      || isAutomaticOpportunityPayload(existingLog);
    if (isImpactfulLog && !isConfirmed(searchParams.get('confirmImpact'))) {
      return confirmationRequiredResponse(
        'حذف حركة الفرص قد يغير حالة الطالب وفرصه. أكد العملية ليتم الحذف وإعادة الاحتساب.',
        {
          student: existingLog.student?.name || existingLog.studentId,
          code: existingLog.student?.code,
          action: existingLog.action,
          amount: existingLog.amount,
          reason: existingLog.reason,
          examId: existingLog.examId,
        },
      );
    }

    const result = await db.$transaction(async (tx) => {
      const deleted = await tx.opportunityLog.deleteMany({ where: { id } });
      const academicRecalculation = deleted.count > 0
        ? await recalculateStudentsAcademicState([existingLog.studentId], { tx })
        : null;
      await writeAuditLog(
        principal,
        'إدارة الفرص',
        'حذف حركة فرص وإعادة احتساب الطالب',
        {
          studentId: existingLog.studentId,
          studentName: existingLog.student?.name,
          studentCode: existingLog.student?.code,
          action: existingLog.action,
          amount: existingLog.amount,
          reason: existingLog.reason,
          examId: existingLog.examId,
          deleted: deleted.count,
        },
        { tx },
      );
      return { ok: true, deleted: deleted.count, studentIds: [existingLog.studentId], academicRecalculation };
    });
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف حركة الفرص حالياً.');
  }
}
