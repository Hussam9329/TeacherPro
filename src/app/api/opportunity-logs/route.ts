export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { forbiddenResponse, getAuthPrincipal, requirePermission, unauthorizedResponse, type AuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
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
    const { parsePagination } = await import('@/lib/pagination');
    const { page, limit, skip } = parsePagination(req);
    const [opportunityLogs, totalCount] = await Promise.all([
      db.opportunityLog.findMany({ orderBy: { date: 'desc' }, skip, take: limit }),
      db.opportunityLog.count(),
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
  try {
    const body = await req.json();
    const auth = await requireOpportunityMutation(req, body);
    if (auth.error) return auth.error;
    const studentError = requireText(body.studentId, 'الطالب');
    if (studentError) return validationError(studentError);
    const actionError = requireText(body.action, 'نوع الحركة');
    if (actionError) return validationError(actionError);
    const action = String(body.action ?? '');
    const amount = Number(body.amount || 0);
    const allowsZeroAmount = action === 'فصل تلقائي' || action === 'إعادة تفعيل';
    if (!Number.isFinite(amount) || amount < 0 || (amount === 0 && !allowsZeroAmount)) return validationError('عدد الفرص يجب أن يكون رقماً أكبر من صفر');
    const data = {
      action,
      amount,
      reason: body.reason ? String(body.reason) : null,
      date: body.date ? new Date(body.date) : new Date(),
      chapterId: body.chapterId ? String(body.chapterId) : null,
      studentId: String(body.studentId),
      examId: body.examId ? String(body.examId) : null,
    };
    // Never trust client-provided IDs on create. The server owns primary keys.
    const log = await db.opportunityLog.create({ data });
    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ حركة الفرص حالياً.');
  }
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
