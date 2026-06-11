export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { withFollowupTables } from '@/lib/followup-schema';

function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOrNow(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeCallPayload(body: Record<string, unknown>) {
  return {
    studentId: String(body.studentId ?? ''),
    examId: String(body.examId ?? ''),
    category: String(body.category ?? ''),
    target: String(body.target ?? ''),
    phone: String(body.phone ?? ''),
    completed: Boolean(body.completed),
    completedAt: dateOrNull(body.completedAt),
    notes: String(body.notes ?? ''),
    createdAt: dateOrNow(body.createdAt),
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.view');
  if (authError) return authError;

  try {
    const studentCalls = await withFollowupTables(
      () => db.studentCall.findMany({ orderBy: { createdAt: 'desc' } }),
      'StudentCall',
    );
    return NextResponse.json({ studentCalls });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل المكالمات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const data = normalizeCallPayload(body);
    const studentError = requireText(data.studentId, 'الطالب');
    if (studentError) return validationError(studentError);
    const examError = requireText(data.examId, 'الامتحان');
    if (examError) return validationError(examError);
    const id = String(body.id || '').trim();
    const studentCall = await withFollowupTables(
      () => id
        ? db.studentCall.upsert({ where: { id }, update: data, create: { id, ...data } })
        : db.studentCall.create({ data }),
      'StudentCall',
    );
    return NextResponse.json({ studentCall }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ المكالمة حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return validationError('تعذر تحديد المكالمة المطلوبة');
    const data: Record<string, unknown> = {};
    if (updates.category !== undefined) data.category = String(updates.category ?? '');
    if (updates.target !== undefined) data.target = String(updates.target ?? '');
    if (updates.phone !== undefined) data.phone = String(updates.phone ?? '');
    if (updates.completed !== undefined) data.completed = Boolean(updates.completed);
    if (updates.completedAt !== undefined) data.completedAt = dateOrNull(updates.completedAt);
    if (updates.notes !== undefined) data.notes = String(updates.notes ?? '');
    const studentCall = await withFollowupTables(
      () => db.studentCall.update({ where: { id: String(id) }, data }),
      'StudentCall',
    );
    return NextResponse.json({ studentCall });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث المكالمة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد المكالمة المطلوبة');
    await withFollowupTables(() => db.studentCall.delete({ where: { id } }), 'StudentCall');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف المكالمة حالياً.');
  }
}
