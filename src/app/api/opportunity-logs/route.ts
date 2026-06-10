export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

export async function GET() {
  try {
    const opportunityLogs = await db.opportunityLog.findMany({ orderBy: { date: 'desc' } });
    return NextResponse.json({ opportunityLogs });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل سجل الفرص حالياً.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studentError = requireText(body.studentId, 'الطالب');
    if (studentError) return validationError(studentError);
    const actionError = requireText(body.action, 'نوع الحركة');
    if (actionError) return validationError(actionError);
    const action = String(body.action ?? '');
    const amount = Number(body.amount || 0);
    if (!Number.isFinite(amount) || (amount <= 0 && action !== 'فصل تلقائي')) return validationError('عدد الفرص يجب أن يكون رقماً أكبر من صفر');
    const data = {
      action,
      amount,
      reason: body.reason ? String(body.reason) : null,
      date: body.date ? new Date(body.date) : new Date(),
      chapterId: body.chapterId ? String(body.chapterId) : null,
      studentId: String(body.studentId),
      examId: body.examId ? String(body.examId) : null,
    };
    const log = body.id
      ? await db.opportunityLog.upsert({ where: { id: String(body.id) }, update: data, create: { id: String(body.id), ...data } })
      : await db.opportunityLog.create({ data });
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
    await db.opportunityLog.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف حركة الفرص حالياً.');
  }
}
