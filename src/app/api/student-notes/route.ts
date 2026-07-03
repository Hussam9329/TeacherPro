export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { withFollowupTables } from '@/lib/followup-schema';

function readListPagination(req: NextRequest, fallbackPageSize = 100, maxPageSize = 200) {
  const searchParams = new URL(req.url).searchParams;
  const rawPageSize = searchParams.get('pageSize') ?? searchParams.get('limit');
  const rawPage = searchParams.get('page');
  const pageNumber = Number(rawPage ?? 1);
  const pageSizeNumber = Number(rawPageSize ?? fallbackPageSize);
  const page = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1;
  const pageSize = Number.isFinite(pageSizeNumber) && pageSizeNumber > 0
    ? Math.min(Math.floor(pageSizeNumber), maxPageSize)
    : fallbackPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function dateOrNow(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function optionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeNotePayload(body: Record<string, unknown>) {
  return {
    studentId: String(body.studentId ?? ''),
    kind: String(body.kind ?? ''),
    text: String(body.text ?? '').trim(),
    date: dateOrNow(body.date),
    sourceType: String(body.sourceType ?? ''),
    sourceId: String(body.sourceId ?? ''),
    dismissalKey: String(body.dismissalKey ?? ''),
    dismissalType: String(body.dismissalType ?? ''),
    dismissalReason: String(body.dismissalReason ?? ''),
    dismissalDate: optionalDate(body.dismissalDate),
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.view');
  if (authError) return authError;

  try {
    const { page, pageSize, skip } = readListPagination(req);
    const [totalCount, studentNotes] = await withFollowupTables(
      () => Promise.all([
        db.studentNote.count(),
        db.studentNote.findMany({ orderBy: { date: 'desc' }, skip, take: pageSize }),
      ]),
      'StudentNote',
    );
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return NextResponse.json({ studentNotes, totalCount, page, pageSize, totalPages, hasMore: page < totalPages });
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
    // Never trust client-provided IDs on create. The server owns primary keys.
    const studentNote = await withFollowupTables(
      () => db.studentNote.create({ data }),
      'StudentNote',
    );
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
    if (updates.sourceType !== undefined) data.sourceType = String(updates.sourceType ?? '');
    if (updates.sourceId !== undefined) data.sourceId = String(updates.sourceId ?? '');
    if (updates.dismissalKey !== undefined) data.dismissalKey = String(updates.dismissalKey ?? '');
    if (updates.dismissalType !== undefined) data.dismissalType = String(updates.dismissalType ?? '');
    if (updates.dismissalReason !== undefined) data.dismissalReason = String(updates.dismissalReason ?? '');
    if (updates.dismissalDate !== undefined) data.dismissalDate = optionalDate(updates.dismissalDate);
    const studentNote = await withFollowupTables(
      () => db.studentNote.update({ where: { id: String(id) }, data }),
      'StudentNote',
    );
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
    await withFollowupTables(() => db.studentNote.delete({ where: { id } }), 'StudentNote');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الملاحظة حالياً.');
  }
}
