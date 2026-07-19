export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { forbiddenResponse, getAuthPrincipal, requirePermission, unauthorizedResponse, type AuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { recalculateStudentsAcademicState } from '@/lib/academic-recalculate-server';
import { isConfirmed, writeAuditLog } from '@/lib/audit-log-server';
import { withSerializableTransaction } from '@/lib/serializable-transaction';
import { buildMutationPreviewToken } from '@/lib/mutation-preview-token';
import { buildStudentAcademicImpactToken } from '@/lib/student-academic-impact-token';
import type { Prisma } from '@prisma/client';

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

type OpportunityLogClient = typeof db | Prisma.TransactionClient;

async function buildOpportunityLogDeletePreview(
  client: OpportunityLogClient,
  id: string,
) {
  const log = await client.opportunityLog.findUnique({
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
      student: {
        select: {
          name: true,
          code: true,
          createdAt: true,
          accountingGraceDays: true,
          gracePeriodStartDate: true,
        },
      },
    },
  });
  if (!log) return null;
  const academicImpactToken = await buildStudentAcademicImpactToken(client, {
    studentId: log.studentId,
    proposedCreatedAt: log.student.createdAt,
    proposedGraceDays: log.student.accountingGraceDays,
    proposedGraceStartDate: log.student.gracePeriodStartDate,
  });
  return {
    log,
    previewToken: buildMutationPreviewToken(`opportunity-log-delete:${id}`, {
      log,
      academicImpactToken,
    }),
  };
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
    const studentId = String(body.studentId);
    const examId = body.examId ? String(body.examId) : null;
    const chapterId = body.chapterId ? String(body.chapterId) : null;

    const [student, exam, chapter] = await Promise.all([
      db.student.findUnique({ where: { id: studentId }, select: { id: true } }),
      examId ? db.exam.findUnique({ where: { id: examId }, select: { id: true } }) : Promise.resolve(null),
      chapterId ? db.chapter.findUnique({ where: { id: chapterId }, select: { id: true, name: true } }) : Promise.resolve(null),
    ]);
    if (!student) return validationError('الطالب غير موجود أو تم حذفه.', 404);
    if (examId && !exam) return validationError('الامتحان غير موجود أو تم حذفه.', 404);
    if (chapterId && !chapter) return validationError('الفصل غير موجود أو تم حذفه.', 404);

    const data = {
      action,
      amount,
      reason: body.reason ? String(body.reason) : null,
      date: body.date ? new Date(body.date) : new Date(),
      chapterId,
      chapterNameSnapshot: chapter?.name || null,
      studentId,
      examId,
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
    const submittedPreviewToken = String(searchParams.get('previewToken') || '').trim();
    const confirmed = isConfirmed(searchParams.get('confirmImpact'));
    const result = await withSerializableTransaction(async (tx) => {
      const preview = await buildOpportunityLogDeletePreview(tx, id);
      if (!preview) return { notFound: true } as const;
      const existingLog = preview.log;
      if (
        !hasPermission(principal, 'opportunities.manage') &&
        (!isAutomaticOpportunityPayload(existingLog) ||
          !canManageAutomaticAcademicEffects(principal))
      ) {
        return { forbidden: true } as const;
      }
      const isImpactfulLog =
        ['خصم', 'إضافة', 'إعادة تعيين', 'إعادة تفعيل', 'خصم تلقائي', 'فصل تلقائي']
          .includes(String(existingLog.action || '')) ||
        Number(existingLog.amount || 0) > 0 ||
        isAutomaticOpportunityPayload(existingLog);
      if (
        isImpactfulLog &&
        (!confirmed || submittedPreviewToken !== preview.previewToken)
      ) {
        return {
          previewConflict: {
            previewToken: preview.previewToken,
            requiresFreshPreview: Boolean(submittedPreviewToken),
            log: existingLog,
          },
        } as const;
      }
      const deleted = await tx.opportunityLog.deleteMany({ where: { id } });
      const academicRecalculation = deleted.count > 0 && isImpactfulLog
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
    if ('notFound' in result) return NextResponse.json({ ok: true, notFound: true });
    if ('forbidden' in result) return forbiddenResponse();
    if ('previewConflict' in result && result.previewConflict) {
      const { previewToken, requiresFreshPreview, log } = result.previewConflict;
      return NextResponse.json(
        {
          error: requiresFreshPreview
            ? 'تغيرت حالة الطالب الأكاديمية بعد معاينة الحذف. راجع الأثر ثم أكد من جديد.'
            : 'حذف حركة الفرص قد يغير حالة الطالب وفرصه. أكد العملية بعد مراجعة الأثر.',
          requiresConfirmation: true,
          requiresFreshPreview,
          previewToken,
          details: {
            student: log.student.name || log.studentId,
            code: log.student.code,
            action: log.action,
            amount: log.amount,
            reason: log.reason,
            examId: log.examId,
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف حركة الفرص حالياً.');
  }
}
