export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';

/**
 * Server-side export of ALL matching grades (no pagination limit).
 * Used by the ExportDialog when the user exports from grade-records.
 *
 * Query params: examId, studentId, status, q (search)
 *
 * Returns: { grades: Grade[] (with student + exam includes) }
 * Hard cap: 10,000 grades per export.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.view');
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const examId = url.searchParams.get('examId')?.trim() || '';
    const studentId = url.searchParams.get('studentId')?.trim() || '';
    const status = url.searchParams.get('status')?.trim() || '';
    const q = url.searchParams.get('q')?.trim() || '';

    const where: Record<string, unknown> = {};
    if (examId) where.examId = examId;
    if (studentId) where.studentId = studentId;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { student: { name: { contains: q, mode: 'insensitive' } } },
        { student: { code: { contains: q, mode: 'insensitive' } } },
        { exam: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const grades = await db.grade.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { student: true, exam: true },
      take: 10000,
    });

    return NextResponse.json({ grades, total: grades.length });
  } catch (error) {
    console.error('[API] /api/grades/export error:', error);
    return NextResponse.json(
      { error: 'تعذر تصدير بيانات الدرجات حالياً.' },
      { status: 500 },
    );
  }
}
