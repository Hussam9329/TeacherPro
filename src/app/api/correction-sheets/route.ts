export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function validateCorrectionSheetPayload(body: Record<string, unknown>) {
  const studentError = requireText(body.studentId, 'الطالب');
  if (studentError) return studentError;
  const examError = requireText(body.examId, 'الامتحان');
  if (examError) return examError;
  const correctorError = requireText(body.correctorId, 'المصحح');
  if (correctorError) return correctorError;
  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'correction.view');
  if (authError) return authError;

  try {
    const correctionSheets = await db.correctionSheet.findMany({
      orderBy: { startedAt: 'desc' },
      include: { student: true, exam: true, corrector: true },
    });
    return NextResponse.json({ correctionSheets });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل أوراق التصحيح حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'correction.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const validationMessage = validateCorrectionSheetPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const existing = await db.correctionSheet.findUnique({
      where: { studentId_examId: { studentId: String(body.studentId), examId: String(body.examId) } },
    });
    if (existing) return validationError('توجد ورقة تصحيح مسجلة لهذا الطالب في نفس الامتحان', 409);
    const correctionSheet = await db.correctionSheet.create({
      data: {
        id: body.id,
        status: body.status || 'قيد التصحيح',
        startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
        finishedAt: body.finishedAt ? new Date(body.finishedAt) : undefined,
        correctionErrors: Number(body.correctionErrors || 0),
        sumErrors: Number(body.sumErrors || 0),
        studentId: body.studentId,
        examId: body.examId,
        correctorId: body.correctorId,
      },
    });
    return NextResponse.json({ correctionSheet }, { status: 201 });
  } catch (error) {
    const err = error as { code?: string };
    if (err?.code === 'P2002') {
      return validationError('توجد ورقة تصحيح مسجلة لهذا الطالب في نفس الامتحان', 409);
    }
    return routeErrorResponse(error, 'تعذر حفظ ورقة التصحيح حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'correction.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد ورقة التصحيح المطلوبة');
    if (data.startedAt !== undefined) data.startedAt = data.startedAt ? new Date(data.startedAt) : null;
    if (data.finishedAt !== undefined) data.finishedAt = data.finishedAt ? new Date(data.finishedAt) : null;
    if (data.correctionErrors !== undefined) data.correctionErrors = Number(data.correctionErrors);
    if (data.sumErrors !== undefined) data.sumErrors = Number(data.sumErrors);
    const correctionSheet = await db.correctionSheet.update({ where: { id }, data });
    return NextResponse.json({ correctionSheet });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث ورقة التصحيح حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'correction.manage');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد ورقة التصحيح المطلوبة');
    await db.correctionSheet.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف ورقة التصحيح حالياً.');
  }
}
