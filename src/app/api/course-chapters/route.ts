export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['chapters.view', 'courses.view']);
  if (authError) return authError;

  try {
    const courseChapters = await db.courseChapter.findMany({
      orderBy: { courseId: 'asc' },
      include: { course: true, chapter: true },
    });
    return NextResponse.json({ courseChapters });
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
        id: body.id,
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
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد رابط الفصل بالدورة');
    const courseChapter = await db.courseChapter.update({ where: { id }, data });
    return NextResponse.json({ courseChapter });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث رابط الفصل بالدورة حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['chapters.edit', 'courses.edit']);
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
