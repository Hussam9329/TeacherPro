import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function validateGradePayload(body: Record<string, unknown>) {
  const studentError = requireText(body.studentId, 'الطالب');
  if (studentError) return studentError;
  const examError = requireText(body.examId, 'الامتحان');
  if (examError) return examError;
  if (!['درجة', 'غائب', 'مجاز', 'غش'].includes(String(body.status ?? ''))) return 'حالة الدرجة غير صحيحة';
  if (body.status === 'درجة') {
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 0) return 'الدرجة يجب أن تكون رقماً صحيحاً لا يقل عن صفر';
  }
  return null;
}

export async function GET() {
  try {
    const grades = await db.grade.findMany({ orderBy: { updatedAt: 'desc' }, include: { student: true, exam: true } });
    return NextResponse.json({ grades });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الدرجات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validationMessage = validateGradePayload(body);
    if (validationMessage) return validationError(validationMessage);
    const grade = await db.grade.upsert({
      where: { studentId_examId: { studentId: body.studentId, examId: body.examId } },
      update: {
        status: body.status,
        score: body.score === null || body.score === undefined ? null : Number(body.score),
        accountingChecked: Boolean(body.accountingChecked),
        notes: body.notes,
      },
      create: {
        id: body.id,
        studentId: body.studentId,
        examId: body.examId,
        status: body.status,
        score: body.score === null || body.score === undefined ? null : Number(body.score),
        accountingChecked: Boolean(body.accountingChecked),
        notes: body.notes,
      },
    });
    return NextResponse.json({ grade }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الدرجة حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد الدرجة المطلوبة');
    if (data.score !== undefined) data.score = data.score === null ? null : Number(data.score);
    if (data.accountingChecked !== undefined) data.accountingChecked = Boolean(data.accountingChecked);
    const grade = await db.grade.update({ where: { id }, data });
    return NextResponse.json({ grade });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الدرجة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const studentId = searchParams.get('studentId');
    const examId = searchParams.get('examId');

    if (id) {
      await db.grade.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }
    if (studentId && examId) {
      await db.grade.delete({ where: { studentId_examId: { studentId, examId } } });
      return NextResponse.json({ ok: true });
    }
    return validationError('تعذر تحديد الدرجة المطلوبة');
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الدرجة حالياً.');
  }
}
