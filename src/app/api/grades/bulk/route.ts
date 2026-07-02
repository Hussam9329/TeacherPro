export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { routeErrorResponse, validationError } from '@/lib/route-helpers';
import { ensureExamSchema } from '@/lib/exam-schema';
import { API_RATE_LIMITS, checkApiRateLimit } from '@/lib/api-rate-limit';

type BulkGradeInput = {
  id?: unknown;
  studentId?: unknown;
  examId?: unknown;
  status?: unknown;
  score?: unknown;
  notes?: unknown;
  academicAccountingChecked?: unknown;
};

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.add');
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.bulkGrades);
  if (rateLimitError) return rateLimitError;

  try {
    await ensureExamSchema();

    const body = await req.json().catch(() => ({}));
    const rawGrades = Array.isArray(body?.grades) ? body.grades as BulkGradeInput[] : [];
    if (rawGrades.length === 0) return validationError('لا توجد درجات للحفظ');
    if (rawGrades.length > 2000) return validationError('عدد الدرجات كبير جداً في دفعة واحدة. قسمها إلى دفعات أصغر.');

    const examIds = Array.from(new Set(rawGrades.map((grade) => asText(grade.examId)).filter(Boolean)));
    const studentIds = Array.from(new Set(rawGrades.map((grade) => asText(grade.studentId)).filter(Boolean)));
    if (examIds.length === 0) return validationError('تعذر تحديد الامتحان');
    if (studentIds.length === 0) return validationError('تعذر تحديد الطلاب');

    const exams = await db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, fullMark: true, courseIds: true } });
    const examsById = new Map(exams.map((exam) => [exam.id, exam]));
    if (examsById.size !== examIds.length) return validationError('أحد الامتحانات غير موجود', 404);

    const students = await db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, courseId: true } });
    const studentsById = new Map(students.map((student) => [student.id, student]));
    const seenGradeKeys = new Set<string>();

    const normalizedGrades = rawGrades.map((raw, index) => {
      const studentId = asText(raw.studentId);
      const examId = asText(raw.examId);
      const exam = examsById.get(examId);
      if (!studentId) throw new Error(`السطر ${index + 1}: الطالب غير محدد`);
      if (!studentsById.has(studentId)) throw new Error(`السطر ${index + 1}: الطالب غير موجود`);
      if (!exam) throw new Error(`السطر ${index + 1}: الامتحان غير صحيح`);
      const gradeKey = `${studentId}:${examId}`;
      if (seenGradeKeys.has(gradeKey)) throw new Error(`السطر ${index + 1}: الطالب مكرر لنفس الامتحان في الدفعة`);
      seenGradeKeys.add(gradeKey);
      const student = studentsById.get(studentId);
      if (student && !exam.courseIds.includes(student.courseId)) throw new Error(`السطر ${index + 1}: الطالب ليس ضمن دورات هذا الامتحان`);
      const status = asText(raw.status || 'درجة');
      if (!['درجة', 'غائب', 'غش'].includes(status)) throw new Error(`السطر ${index + 1}: حالة الدرجة غير صحيحة`);
      const score = status === 'درجة' ? Number(raw.score) : null;
      if (status === 'درجة' && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > Number(exam.fullMark || 0))) {
        throw new Error(`السطر ${index + 1}: الدرجة يجب أن تكون رقماً بين 0 و ${exam.fullMark}`);
      }
      return {
        id: asText(raw.id) || undefined,
        studentId,
        examId: exam.id,
        status,
        score,
        notes: asText(raw.notes),
        academicAccountingChecked: Boolean(raw.academicAccountingChecked),
      };
    });

    const savedGrades = await db.$transaction(
      normalizedGrades.map((grade) => db.grade.upsert({
        where: { studentId_examId: { studentId: grade.studentId, examId: grade.examId } },
        update: {
          status: grade.status,
          score: grade.score,
          notes: grade.notes,
          academicAccountingChecked: grade.academicAccountingChecked,
        },
        create: {
          ...(grade.id ? { id: grade.id } : {}),
          studentId: grade.studentId,
          examId: grade.examId,
          status: grade.status,
          score: grade.score,
          notes: grade.notes,
          academicAccountingChecked: grade.academicAccountingChecked,
        },
      })),
    );

    return NextResponse.json({ ok: true, count: savedGrades.length, grades: savedGrades });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('السطر ')) {
      return validationError(error.message);
    }
    return routeErrorResponse(error, 'تعذر حفظ الدرجات الجماعية حالياً.');
  }
}
