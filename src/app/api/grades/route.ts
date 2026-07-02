export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { Prisma } from '@prisma/client';
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

  // تحقق أن الطالب موجود فعلاً ضمن قائمة courseIds للامتحان
  const [exam, student] = await Promise.all([
    db.exam.findUnique({ where: { id: String(body.examId) }, select: { fullMark: true, courseIds: true } }),
    db.student.findUnique({ where: { id: String(body.studentId) }, select: { id: true, courseId: true } }),
  ]);
  if (!exam) return 'الامتحان غير موجود';
  if (!student) return 'الطالب غير موجود';

  let courseIds: string[] = [];
  try {
    const parsed = JSON.parse(exam.courseIds || '[]');
    if (Array.isArray(parsed)) courseIds = parsed.map(String).filter(Boolean);
  } catch {
    courseIds = [];
  }
  if (courseIds.length > 0 && !courseIds.includes(student.courseId)) {
    return 'الطالب ليس ضمن دورات هذا الامتحان';
  }

  if (body.status === 'درجة') {
    const score = Number(body.score);
    const fullMark = Number(exam.fullMark || 0);
    if (!Number.isFinite(score) || score < 0 || score > fullMark) {
      return `الدرجة يجب أن تكون رقماً بين 0 و ${fullMark}`;
    }
  }
  return null;
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.view');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const examId = String(searchParams.get('examId') || '').trim();
    const studentId = String(searchParams.get('studentId') || '').trim();
    const status = String(searchParams.get('status') || '').trim();
    const hasListParams = ['examId', 'studentId', 'status', 'page', 'pageSize'].some((key) => searchParams.has(key));

    const where: Prisma.GradeWhereInput = {};
    if (examId) where.examId = examId;
    if (studentId) where.studentId = studentId;
    if (status) where.status = status;

    // Important: GET must stay read-only. Legacy data repair is handled by
    // Prisma migration 20260702002000_grade_status_cleanup_and_indexes, not by
    // this read endpoint.
    if (!hasListParams) {
      const grades = await db.grade.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { student: true, exam: true },
      });
      return NextResponse.json({ grades });
    }

    const page = parsePositiveInt(searchParams.get('page'), 1, 1_000_000);
    const pageSize = parsePositiveInt(searchParams.get('pageSize'), 100, 500);
    const skip = (page - 1) * pageSize;

    const [totalCount, grades] = await Promise.all([
      db.grade.count({ where }),
      db.grade.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
        include: { student: true, exam: true },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return NextResponse.json({
      grades,
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
    });
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
