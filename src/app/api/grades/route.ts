export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { ensureExamSchema } from '@/lib/exam-schema';

async function validateGradePayload(body: Record<string, unknown>) {
  const studentError = requireText(body.studentId, 'الطالب');
  if (studentError) return studentError;
  const examError = requireText(body.examId, 'الامتحان');
  if (examError) return examError;
  if (!['درجة', 'غائب', 'غش'].includes(String(body.status ?? ''))) return 'حالة الدرجة غير صحيحة';
  if (body.status === 'درجة') {
    const score = Number(body.score);
    const exam = await db.exam.findUnique({ where: { id: String(body.examId) }, select: { fullMark: true } });
    const fullMark = Number(exam?.fullMark ?? 0);
    if (!Number.isFinite(score) || score < 0 || score > fullMark) {
      return `الدرجة يجب أن تكون رقماً بين 0 و ${fullMark}`;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.view');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    // ترحيل آمن للبيانات القديمة: حالة الإجازة صارت تدار من StudentLeave وليس من grades.
    await db.grade.updateMany({ where: { status: 'مجاز' }, data: { status: 'غائب' } }).catch(() => null);
    const grades = await db.grade.findMany({ orderBy: { updatedAt: 'desc' }, include: { student: true, exam: true } });
    return NextResponse.json({ grades });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الدرجات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.add');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    const body = await req.json();
    const validationMessage = await validateGradePayload(body);
    if (validationMessage) return validationError(validationMessage);
    const checked = body.academicAccountingChecked === undefined
      ? undefined
      : Boolean(body.academicAccountingChecked);
    const grade = await db.grade.upsert({
      where: { studentId_examId: { studentId: body.studentId, examId: body.examId } },
      update: {
        status: body.status,
        score: body.score === null || body.score === undefined ? null : Number(body.score),
        notes: body.notes,
        ...(checked !== undefined ? { academicAccountingChecked: checked } : {}),
      },
      create: {
        id: body.id,
        studentId: body.studentId,
        examId: body.examId,
        status: body.status,
        score: body.score === null || body.score === undefined ? null : Number(body.score),
        notes: body.notes,
        academicAccountingChecked: Boolean(body.academicAccountingChecked),
      },
    });
    return NextResponse.json({ grade }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الدرجة حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.edit');
  if (authError) return authError;

  try {
    await ensureExamSchema();

    const body = await req.json();
    const { id, ...data } = body;
    delete data.accountingChecked;

    const gradeId = String(id || '').trim();
    const fallbackStudentId = String(data.studentId || '').trim();
    const fallbackExamId = String(data.examId || '').trim();
    if (!gradeId && (!fallbackStudentId || !fallbackExamId)) return validationError('تعذر تحديد الدرجة المطلوبة');

    if (data.academicAccountingChecked !== undefined) data.academicAccountingChecked = Boolean(data.academicAccountingChecked);
    if (data.status !== undefined && !['درجة', 'غائب', 'غش'].includes(String(data.status))) return validationError('حالة الدرجة غير صحيحة');
    if (data.score !== undefined) data.score = data.score === null ? null : Number(data.score);

    const current = gradeId
      ? await db.grade.findUnique({ where: { id: gradeId }, include: { exam: true } })
      : null;
    const fallbackCurrent = !current && fallbackStudentId && fallbackExamId
      ? await db.grade.findUnique({ where: { studentId_examId: { studentId: fallbackStudentId, examId: fallbackExamId } }, include: { exam: true } })
      : null;
    const targetGrade = current || fallbackCurrent;
    if (!targetGrade) return validationError('سجل الدرجة غير موجود أو تم حذفه مسبقاً', 404);

    if (data.status === 'درجة' || data.score !== undefined) {
      const nextStatus = String(data.status ?? targetGrade.status);
      const nextScore = data.score !== undefined ? data.score : targetGrade.score;
      if (nextStatus === 'درجة') {
        const fullMark = Number(targetGrade.exam.fullMark || 0);
        if (!Number.isFinite(Number(nextScore)) || Number(nextScore) < 0 || Number(nextScore) > fullMark) {
          return validationError(`الدرجة يجب أن تكون رقماً بين 0 و ${fullMark}`);
        }
      }
    }

    const grade = await db.grade.update({ where: { id: targetGrade.id }, data });
    return NextResponse.json({ grade });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الدرجة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.delete');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const studentId = searchParams.get('studentId');
    const examId = searchParams.get('examId');

    const status = searchParams.get('status');

    if (examId && status === 'غائب' && !studentId && !id) {
      const targetGrades = await db.grade.findMany({
        where: { examId, status: 'غائب' },
        select: { id: true, studentId: true },
      });
      if (targetGrades.length === 0) {
        return NextResponse.json({ ok: true, deleted: 0, studentIds: [] });
      }
      const deletedAbsences = await db.grade.deleteMany({
        where: { examId, status: 'غائب' },
      });
      return NextResponse.json({
        ok: true,
        deleted: deletedAbsences.count,
        studentIds: Array.from(new Set(targetGrades.map((grade) => grade.studentId))),
      });
    }

    if (id) {
      const deletedById = await db.grade.deleteMany({ where: { id } });
      if (deletedById.count > 0 || !studentId || !examId) {
        return NextResponse.json({ ok: true, deleted: deletedById.count });
      }
    }
    if (studentId && examId) {
      const deletedByPair = await db.grade.deleteMany({ where: { studentId, examId } });
      return NextResponse.json({ ok: true, deleted: deletedByPair.count });
    }
    return validationError('تعذر تحديد الدرجة المطلوبة');
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الدرجة حالياً.');
  }
}
