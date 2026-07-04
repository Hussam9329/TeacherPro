export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { normalizeArabicText } from '@/lib/route-helpers';
import { normalizeListFilter } from '@/lib/all-filter';


function buildGradeSearchWhere(rawQuery: string): Prisma.GradeWhereInput | null {
  const query = rawQuery.trim();
  if (!query) return null;

  const normalizedQuery = normalizeArabicText(query);
  const compactQuery = query.replace(/\s+/g, '');
  const telegramQuery = query.startsWith('@') ? query : `@${query}`;

  const studentSearch: Prisma.StudentWhereInput[] = [
    { name: { contains: query, mode: 'insensitive' } },
    { code: { startsWith: query, mode: 'insensitive' } },
    { phone: { startsWith: compactQuery, mode: 'insensitive' } },
    { parentPhone: { startsWith: compactQuery, mode: 'insensitive' } },
    { telegram: { startsWith: telegramQuery, mode: 'insensitive' } },
  ];

  if (normalizedQuery) studentSearch.push({ nameKey: { contains: normalizedQuery, mode: 'insensitive' } });
  if (compactQuery.length >= 7) {
    studentSearch.push(
      { phone: { contains: compactQuery, mode: 'insensitive' } },
      { parentPhone: { contains: compactQuery, mode: 'insensitive' } },
    );
  }

  return {
    OR: [
      { notes: { contains: query, mode: 'insensitive' } },
      { student: { is: { OR: studentSearch } } },
      { exam: { is: { name: { contains: query, mode: 'insensitive' } } } },
    ],
  };
}

function buildNameLetterWhere(letter: string): Prisma.GradeWhereInput | null {
  const rawLetter = letter.trim();
  if (!rawLetter || rawLetter === 'all') return null;
  const normalizedLetter = normalizeArabicText(rawLetter).slice(0, 1);
  const studentWhere: Prisma.StudentWhereInput[] = [
    { name: { startsWith: rawLetter, mode: 'insensitive' } },
  ];
  if (normalizedLetter) studentWhere.push({ nameKey: { startsWith: normalizedLetter, mode: 'insensitive' } });
  return { student: { is: { OR: studentWhere } } };
}

function buildGradeExportWhere(searchParams: URLSearchParams): Prisma.GradeWhereInput {
  const and: Prisma.GradeWhereInput[] = [];
  const examId = normalizeListFilter(searchParams.get('examId'));
  const studentId = normalizeListFilter(searchParams.get('studentId'));
  const status = normalizeListFilter(searchParams.get('status'));
  const courseId = normalizeListFilter(searchParams.get('courseId'));
  const q = String(searchParams.get('q') || '').trim();
  const nameLetter = normalizeListFilter(searchParams.get('nameLetter'));

  if (examId) and.push({ examId });
  if (studentId) and.push({ studentId });
  if (status) and.push({ status });
  if (courseId) and.push({ student: { is: { courseId } } });

  const letterWhere = buildNameLetterWhere(nameLetter);
  if (letterWhere) and.push(letterWhere);

  const searchWhere = buildGradeSearchWhere(q);
  if (searchWhere) and.push(searchWhere);

  return and.length > 0 ? { AND: and } : {};
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'grades.view');
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const where = buildGradeExportWhere(searchParams);
    const [totalCount, grades] = await Promise.all([
      db.grade.count({ where }),
      db.grade.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: { student: true, exam: true },
      }),
    ]);

    return NextResponse.json({ grades, total: grades.length, totalCount, capped: false });
  } catch (error) {
    console.error('[API] /api/grades/export error:', error);
    return NextResponse.json(
      { error: 'تعذر تصدير بيانات الدرجات حالياً.' },
      { status: 500 },
    );
  }
}
