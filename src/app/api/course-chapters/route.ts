export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';
import { API_RATE_LIMITS, checkApiRateLimit } from '@/lib/api-rate-limit';

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

type ArchiveEntry = { studentId: string; opportunities: number; date?: string };

function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return Boolean(value);
}

function normalizeOpportunityValue(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function parseArchiveEntries(value: unknown): ArchiveEntry[] {
  const source = typeof value === 'string' ? value : JSON.stringify(value ?? []);
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        studentId: String((entry as { studentId?: unknown }).studentId || '').trim(),
        opportunities: normalizeOpportunityValue((entry as { opportunities?: unknown }).opportunities),
        date: (entry as { date?: unknown }).date ? String((entry as { date?: unknown }).date) : undefined,
      }))
      .filter((entry) => entry.studentId);
  } catch {
    return [];
  }
}

function normalizeArchiveText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim() ? value : '[]';
  }
  try {
    return JSON.stringify(Array.isArray(value) ? value : []);
  } catch {
    return '[]';
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['chapters.view', 'courses.view']);
  if (authError) return authError;

  try {
    const { page, pageSize, skip } = readListPagination(req);
    const [totalCount, courseChapters] = await Promise.all([
      db.courseChapter.count(),
      db.courseChapter.findMany({
        orderBy: { courseId: 'asc' },
        include: { course: true, chapter: true },
        skip,
        take: pageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return NextResponse.json({ courseChapters, totalCount, page, pageSize, totalPages, hasMore: page < totalPages });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل روابط الفصول بالدورات حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['chapters.edit', 'courses.edit']);
  if (authError) return authError;

  try {
    const body = await req.json();
    const courseError = requireText(body.courseId, 'الدورة');
    if (courseError) return validationError(courseError);
    const chapterError = requireText(body.chapterId, 'الفصل');
    if (chapterError) return validationError(chapterError);
    const existing = await db.courseChapter.findFirst({
      where: { courseId: String(body.courseId), chapterId: String(body.chapterId), archived: false },
    });
    if (existing) return validationError('الفصل مرتبط مسبقاً بهذه الدورة', 409);
    const courseChapter = await db.courseChapter.create({
      data: {
        active: body.active ?? false,
        archived: body.archived ?? false,
        archive: body.archive ?? '[]',
        courseId: String(body.courseId),
        chapterId: String(body.chapterId),
      },
    });
    return NextResponse.json({ courseChapter }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر ربط الفصل بالدورة حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['chapters.edit', 'courses.edit']);
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return validationError('تعذر تحديد رابط الفصل بالدورة');

    const syncStudentOpportunities = body.syncStudentOpportunities === true;
    if (syncStudentOpportunities) {
      const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.studentOpportunitySync);
      if (rateLimitError) return rateLimitError;
    }

    const updateData: {
      active?: boolean;
      archived?: boolean;
      archive?: string;
      courseId?: string;
      chapterId?: string;
    } = {};

    const activeValue = normalizeBoolean(body.active);
    const archivedValue = normalizeBoolean(body.archived);
    if (activeValue !== undefined) updateData.active = activeValue;
    if (archivedValue !== undefined) updateData.archived = archivedValue;
    if (body.archive !== undefined) updateData.archive = normalizeArchiveText(body.archive);
    if (body.courseId !== undefined && !syncStudentOpportunities) updateData.courseId = String(body.courseId);
    if (body.chapterId !== undefined && !syncStudentOpportunities) updateData.chapterId = String(body.chapterId);

    const result = await db.$transaction(async (tx) => {
      const courseChapter = await tx.courseChapter.update({ where: { id: String(id) }, data: updateData });
      let affectedStudents = 0;

      if (syncStudentOpportunities) {
        const courseId = String(body.courseId || courseChapter.courseId || '').trim();
        if (!courseId) {
          throw new Error('تعذر تحديد دورة الفصل لتحديث فرص الطلاب');
        }

        if (courseChapter.active) {
          const baseOpportunities = normalizeOpportunityValue(body.chapterOpportunities);
          const baseUpdate = await tx.student.updateMany({
            where: { courseId },
            data: { opportunities: baseOpportunities, baseOpportunities },
          });
          affectedStudents = baseUpdate.count;

          const archiveEntries = parseArchiveEntries(courseChapter.archive);
          for (const entry of archiveEntries) {
            await tx.student.updateMany({
              where: { id: entry.studentId, courseId },
              data: {
                opportunities: entry.opportunities,
                baseOpportunities,
              },
            });
          }
        } else {
          const resetUpdate = await tx.student.updateMany({
            where: { courseId },
            data: { opportunities: 0, baseOpportunities: 0 },
          });
          affectedStudents = resetUpdate.count;
        }
      }

      return { courseChapter, affectedStudents };
    });

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث رابط الفصل بالدورة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['chapters.delete', 'courses.delete']);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد رابط الفصل بالدورة');
    const link = await db.courseChapter.findUnique({ where: { id } });
    if (!link) return validationError('رابط الفصل غير موجود أو تم حذفه مسبقاً', 404);
    if (link.active) return validationError('لا يمكن حذف ربط فصل مفعل. ألغِ التفعيل أولاً.', 409);
    await db.courseChapter.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف رابط الفصل بالدورة حالياً.');
  }
}
