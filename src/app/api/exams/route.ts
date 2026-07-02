export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { parseBaghdadDateTime } from '@/lib/baghdad-time';
import { ensureExamSchema } from '@/lib/exam-schema';

function parseCourseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function validateExamPayload(body: Record<string, unknown>) {
  const nameError = requireText(body.name, 'اسم الامتحان');
  if (nameError) return nameError;
  if (!['يومي', 'تراكمي', 'فاينل'].includes(String(body.type ?? ''))) return 'نوع الامتحان غير صحيح';
  if (parseCourseIds(body.courseIds).length === 0) return 'يجب اختيار دورة واحدة على الأقل';
  const noDiscount = parseBoolean(body.noDiscount);
  const fullMark = Number(body.fullMark ?? 100);
  const passMark = Number(body.passMark ?? 50);
  const discountMark = noDiscount ? 0 : Number(body.discountMark ?? 0);
  if (![fullMark, passMark, discountMark].every(Number.isFinite)) return 'درجات الامتحان يجب أن تكون أرقاماً صحيحة';
  if (fullMark <= 0) return 'الدرجة الكاملة يجب أن تكون أكبر من صفر';
  if (passMark < 0 || passMark > fullMark) return 'درجة النجاح يجب أن تكون بين صفر والدرجة الكاملة';
  if (!noDiscount && (discountMark < 0 || discountMark > fullMark)) return 'درجة الخصم يجب أن تكون بين صفر والدرجة الكاملة';
  if (!noDiscount && String(body.type) !== 'فاينل' && passMark <= discountMark) return 'درجة النجاح يجب أن تكون أكبر من درجة الخصم';
  if (!noDiscount && String(body.type) !== 'فاينل' && Number(body.opportunitiesPenalty ?? 1) <= 0) return 'خصم الفرص يجب أن يكون أكبر من صفر';
  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.view');
  if (authError) return authError;

  try {
    await ensureExamSchema();
    const { isPaginatedRequest, parsePagination } = await import('@/lib/pagination');
    if (isPaginatedRequest(req)) {
      const { page, limit, skip } = parsePagination(req);
      const [exams, total] = await Promise.all([
        db.exam.findMany({ orderBy: { date: 'desc' }, skip, take: limit }),
        db.exam.count(),
      ]);
      return NextResponse.json({ exams, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    // Default: return all exams WITHOUT grades (grades fetched separately via /api/grades)
    const exams = await db.exam.findMany({ orderBy: { date: 'desc' } });
    return NextResponse.json({ exams });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الامتحانات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.add');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    const body = await req.json();
    const validationMessage = validateExamPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const noDiscount = parseBoolean(body.noDiscount);
    const exam = await db.exam.create({
      data: {
        name: String(body.name ?? '').trim(),
        type: body.type,
        courseIds: JSON.stringify(parseCourseIds(body.courseIds)),
        mainSite: body.mainSite,
        date: body.date ? new Date(body.date) : new Date(),
        fullMark: Number(body.fullMark || 100),
        passMark: Number(body.passMark || 50),
        discountMark: noDiscount ? 0 : Number(body.discountMark || 0),
        opportunitiesPenalty: noDiscount ? '0' : String(body.opportunitiesPenalty ?? 1),
        dismissalGrade: !noDiscount && String(body.type) === 'فاينل' && body.dismissalGrade !== null && body.dismissalGrade !== undefined ? Number(body.dismissalGrade) : null,
        noDiscount,
        active: body.active ?? true,
        scheduledActivateAt: body.scheduledActivateAt ? parseBaghdadDateTime(String(body.scheduledActivateAt)) : null,
        scheduledDeactivateAt: body.scheduledDeactivateAt ? parseBaghdadDateTime(String(body.scheduledDeactivateAt)) : null,
      },
    });
    return NextResponse.json({ exam }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الامتحان حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.edit');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    const body = await req.json();
    const { id, ...data } = body;
    for (const obsoleteKey of ["attendance", "attendanceClosed", "groupId"]) {
      delete data[obsoleteKey];
    }
    if (!id) return validationError('تعذر تحديد الامتحان المطلوب');
    const existingExam = await db.exam.findUnique({ where: { id } });
    if (!existingExam) return validationError('الامتحان المطلوب غير موجود');
    if (data.name !== undefined) {
      const nameError = requireText(data.name, 'اسم الامتحان');
      if (nameError) return validationError(nameError);
      data.name = String(data.name ?? '').trim();
    }
    if (data.courseIds !== undefined) data.courseIds = JSON.stringify(parseCourseIds(data.courseIds));
    if (data.date !== undefined) data.date = data.date ? new Date(data.date) : new Date();
    if (data.fullMark !== undefined) data.fullMark = Number(data.fullMark);
    if (data.passMark !== undefined) data.passMark = Number(data.passMark);
    if (data.discountMark !== undefined) data.discountMark = Number(data.discountMark);
    if (data.opportunitiesPenalty !== undefined) data.opportunitiesPenalty = String(data.opportunitiesPenalty);
    if (data.dismissalGrade !== undefined) data.dismissalGrade = data.dismissalGrade === null || data.dismissalGrade === "" ? null : Number(data.dismissalGrade);
    if (data.noDiscount !== undefined) data.noDiscount = parseBoolean(data.noDiscount);
    if (data.scheduledActivateAt !== undefined) data.scheduledActivateAt = data.scheduledActivateAt ? parseBaghdadDateTime(String(data.scheduledActivateAt)) : null;
    if (data.scheduledDeactivateAt !== undefined) data.scheduledDeactivateAt = data.scheduledDeactivateAt ? parseBaghdadDateTime(String(data.scheduledDeactivateAt)) : null;

    const candidateValidationMessage = validateExamPayload({
      name: data.name ?? existingExam.name,
      type: data.type ?? existingExam.type,
      courseIds: data.courseIds ?? existingExam.courseIds,
      fullMark: data.fullMark ?? existingExam.fullMark,
      passMark: data.passMark ?? existingExam.passMark,
      discountMark: data.discountMark ?? existingExam.discountMark,
      opportunitiesPenalty: data.opportunitiesPenalty ?? existingExam.opportunitiesPenalty,
      noDiscount: data.noDiscount ?? existingExam.noDiscount,
    });
    if (candidateValidationMessage) return validationError(candidateValidationMessage);
    const effectiveNoDiscount = Boolean(data.noDiscount ?? existingExam.noDiscount);
    if (effectiveNoDiscount) {
      data.discountMark = 0;
      data.opportunitiesPenalty = '0';
      data.dismissalGrade = null;
    } else if (String(data.type ?? existingExam.type) !== 'فاينل') {
      data.dismissalGrade = null;
    }

    const exam = await db.exam.update({ where: { id }, data });
    return NextResponse.json({ exam });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الامتحان حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'exams.delete');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الامتحان المطلوب');

    await db.$transaction(async (tx) => {
      await tx.correctionSheet.deleteMany({ where: { examId: id } });
      await tx.opportunityLog.deleteMany({ where: { examId: id } });
      await tx.grade.deleteMany({ where: { examId: id } });
      await tx.exam.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الامتحان وسجلاته التابعة حالياً.');
  }
}
