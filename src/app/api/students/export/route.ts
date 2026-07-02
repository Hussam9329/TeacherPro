export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';

/**
 * Server-side export of ALL matching students (no pagination limit).
 * Used by the ExportDialog when the user exports from student-registry.
 *
 * Query params: same search/filter params as /api/students (q, courseId,
 * status, courseProgram, studyType, locationScope, etc.)
 *
 * Returns: { students: Student[] } — all matches, no take limit.
 * Rate limited to prevent abuse (handled by middleware).
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'students.view');
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.trim() || '';
    const courseId = url.searchParams.get('courseId')?.trim() || '';
    const status = url.searchParams.get('status')?.trim() || '';
    const courseProgram = url.searchParams.get('courseProgram')?.trim() || '';
    const studyType = url.searchParams.get('studyType')?.trim() || '';
    const locationScope = url.searchParams.get('locationScope')?.trim() || '';

    // Build where clause (same logic as /api/students)
    const where: Record<string, unknown> = {};
    if (courseId) where.courseId = courseId;
    if (status) where.status = status;
    if (courseProgram) where.courseProgram = courseProgram;
    if (studyType) where.studyType = studyType;
    if (locationScope) where.locationScope = locationScope;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { parentPhone: { contains: q } },
        { telegram: { contains: q, mode: 'insensitive' } },
        { school: { contains: q, mode: 'insensitive' } },
      ];
    }

    const students = await db.student.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { course: true },
      // Hard cap to prevent abuse: max 10,000 students per export
      take: 10000,
    });

    return NextResponse.json({ students, total: students.length });
  } catch (error) {
    console.error('[API] /api/students/export error:', error);
    return NextResponse.json(
      { error: 'تعذر تصدير بيانات الطلاب حالياً.' },
      { status: 500 },
    );
  }
}
