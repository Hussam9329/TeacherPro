export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { ensureFollowupTables, withFollowupTables } from '@/lib/followup-schema';

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

function dateOnly(value: unknown): string {
  return dateOrNow(value).toISOString().slice(0, 10);
}

function dayAfter(value: Date): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function normalizeLeavePayload(body: Record<string, unknown>) {
  const leaveType = body.leaveType === 'period' ? 'period' : 'exam';
  const rawFrom = body.dateFrom ?? body.date;
  const rawTo = body.dateTo ?? rawFrom;
  const fromKey = dateOnly(rawFrom);
  const toKey = dateOnly(rawTo);
  const dateFrom = dateOrNow(fromKey <= toKey ? fromKey : toKey);
  const dateTo = dateOrNow(fromKey <= toKey ? toKey : fromKey);
  const date = leaveType === 'period' ? dateFrom : dateOrNow(body.date ?? dateFrom);

  return {
    studentId: String(body.studentId ?? ''),
    examId: leaveType === 'exam' ? String(body.examId ?? '') : null,
    leaveType,
    reason: String(body.reason ?? '').trim(),
    studyType: String(body.studyType ?? ''),
    date,
    dateFrom,
    dateTo,
    notes: String(body.notes ?? ''),
  };
}

async function getAffectedExamIds(
  tx: { exam: { findMany: (args: { where: { date: { gte: Date; lt: Date } }; select: { id: true } }) => Promise<Array<{ id: string }>> } },
  data: ReturnType<typeof normalizeLeavePayload>,
): Promise<string[]> {
  if (data.leaveType === 'exam') return data.examId ? [data.examId] : [];
  const exams = await tx.exam.findMany({
    where: {
      date: {
        gte: data.dateFrom,
        lt: dayAfter(data.dateTo),
      },
    },
    select: { id: true },
  });
  return exams.map((exam) => exam.id);
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.view');
  if (authError) return authError;

  try {
    const { page, pageSize, skip } = readListPagination(req);
    const [totalCount, studentLeaves] = await withFollowupTables(
      () => Promise.all([
        db.studentLeave.count(),
        db.studentLeave.findMany({
          orderBy: [{ dateFrom: 'desc' }, { date: 'desc' }],
          skip,
          take: pageSize,
          include: {
            student: true,
            exam: true,
          },
        }),
      ]),
      'StudentLeave',
    );
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return NextResponse.json({ studentLeaves, totalCount, page, pageSize, totalPages, hasMore: page < totalPages });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الإجازات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    await ensureFollowupTables();
    const body = await req.json();
    const data = normalizeLeavePayload(body);
    const studentError = requireText(data.studentId, 'الطالب');
    if (studentError) return validationError(studentError);
    if (data.leaveType === 'exam') {
      const examError = requireText(String(data.examId || ''), 'الامتحان');
      if (examError) return validationError(examError);
    }
    const reasonError = requireText(data.reason, 'سبب الإجازة');
    if (reasonError) return validationError(reasonError);

    const leave = await withFollowupTables(() => db.$transaction(async (tx) => {
      const affectedExamIds = await getAffectedExamIds(tx, data);
      // Never trust client-provided IDs on create. The server owns primary keys.
      if (data.leaveType === 'exam' && data.examId) {
        await tx.studentLeave.deleteMany({ where: { studentId: data.studentId, examId: data.examId } });
      }
      const savedLeave = await tx.studentLeave.create({
        data,
        include: {
          student: true,
          exam: true,
        },
      });

      if (affectedExamIds.length) {
        await tx.grade.deleteMany({ where: { studentId: data.studentId, examId: { in: affectedExamIds } } });
      }
      return savedLeave;
    }), 'StudentLeave');

    return NextResponse.json({ studentLeave: leave }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الإجازة حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.manage');
  if (authError) return authError;

  try {
    await ensureFollowupTables();
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return validationError('تعذر تحديد الإجازة المطلوبة');
    const normalized = normalizeLeavePayload(body);
    const data: Record<string, unknown> = {};
    if (body.studentId !== undefined) data.studentId = normalized.studentId;
    if (body.examId !== undefined || body.leaveType !== undefined) data.examId = normalized.examId;
    if (body.leaveType !== undefined) data.leaveType = normalized.leaveType;
    if (body.reason !== undefined) data.reason = normalized.reason;
    if (body.studyType !== undefined) data.studyType = normalized.studyType;
    if (body.date !== undefined) data.date = normalized.date;
    if (body.dateFrom !== undefined || body.leaveType !== undefined) data.dateFrom = normalized.dateFrom;
    if (body.dateTo !== undefined || body.leaveType !== undefined) data.dateTo = normalized.dateTo;
    if (body.notes !== undefined) data.notes = normalized.notes;
    const studentLeave = await withFollowupTables(
      () => db.studentLeave.update({
        where: { id },
        data,
        include: {
          student: true,
          exam: true,
        },
      }),
      'StudentLeave',
    );
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
    await withFollowupTables(() => db.studentLeave.delete({ where: { id } }), 'StudentLeave');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الإجازة حالياً.');
  }
}
