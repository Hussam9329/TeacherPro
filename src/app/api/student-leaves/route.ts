export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function dateOrNow(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeLeavePayload(body: Record<string, unknown>) {
  return {
    studentId: String(body.studentId ?? ''),
    examId: String(body.examId ?? ''),
    reason: String(body.reason ?? '').trim(),
    studyType: String(body.studyType ?? ''),
    date: dateOrNow(body.date),
    notes: String(body.notes ?? ''),
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.view');
  if (authError) return authError;

  try {
    const studentLeaves = await db.studentLeave.findMany({ orderBy: { date: 'desc' } });
    return NextResponse.json({ studentLeaves });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الإجازات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const data = normalizeLeavePayload(body);
    const studentError = requireText(data.studentId, 'الطالب');
    if (studentError) return validationError(studentError);
    const examError = requireText(data.examId, 'الامتحان');
    if (examError) return validationError(examError);
    const reasonError = requireText(data.reason, 'سبب الإجازة');
    if (reasonError) return validationError(reasonError);

    const id = String(body.id || '').trim();
    const leave = await db.$transaction(async (tx) => {
      const savedLeave = id
        ? await (async () => {
            await tx.studentLeave.deleteMany({
              where: { studentId: data.studentId, examId: data.examId, id: { not: id } },
            });
            return tx.studentLeave.upsert({
              where: { id },
              update: data,
              create: { id, ...data },
            });
          })()
        : await (async () => {
            await tx.studentLeave.deleteMany({ where: { studentId: data.studentId, examId: data.examId } });
            return tx.studentLeave.create({ data });
          })();

      // An approved leave means this exam must no longer be counted as a grade.
      // Keep it in the same transaction so refreshes match the UI.
      await tx.grade.deleteMany({ where: { studentId: data.studentId, examId: data.examId } });
      return savedLeave;
    });

    return NextResponse.json({ studentLeave: leave }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الإجازة حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return validationError('تعذر تحديد الإجازة المطلوبة');
    const data: Record<string, unknown> = {};
    if (body.reason !== undefined) data.reason = String(body.reason ?? '').trim();
    if (body.studyType !== undefined) data.studyType = String(body.studyType ?? '');
    if (body.date !== undefined) data.date = dateOrNow(body.date);
    if (body.notes !== undefined) data.notes = String(body.notes ?? '');
    const studentLeave = await db.studentLeave.update({ where: { id }, data });
    return NextResponse.json({ studentLeave });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الإجازة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الإجازة المطلوبة');
    await db.studentLeave.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الإجازة حالياً.');
  }
}
