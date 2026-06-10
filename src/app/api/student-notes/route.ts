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

function normalizeNotePayload(body: Record<string, unknown>) {
  return {
    studentId: String(body.studentId ?? ''),
    kind: String(body.kind ?? ''),
    text: String(body.text ?? '').trim(),
    date: dateOrNow(body.date),
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.view');
  if (authError) return authError;

  try {
    const studentNotes = await db.studentNote.findMany({ orderBy: { date: 'desc' } });
    return NextResponse.json({ studentNotes });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الملاحظات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const data = normalizeNotePayload(body);
    const studentError = requireText(data.studentId, 'الطالب');
    if (studentError) return validationError(studentError);
    const textError = requireText(data.text, 'نص الملاحظة');
    if (textError) return validationError(textError);
    const id = String(body.id || '').trim();
    const studentNote = id
      ? await db.studentNote.upsert({ where: { id }, update: data, create: { id, ...data } })
      : await db.studentNote.create({ data });
    return NextResponse.json({ studentNote }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الملاحظة حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return validationError('تعذر تحديد الملاحظة المطلوبة');
    const data: Record<string, unknown> = {};
    if (updates.kind !== undefined) data.kind = String(updates.kind ?? '');
    if (updates.text !== undefined) data.text = String(updates.text ?? '').trim();
    if (updates.date !== undefined) data.date = dateOrNow(updates.date);
    const studentNote = await db.studentNote.update({ where: { id: String(id) }, data });
    return NextResponse.json({ studentNote });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الملاحظة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الملاحظة المطلوبة');
    await db.studentNote.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الملاحظة حالياً.');
  }
}
