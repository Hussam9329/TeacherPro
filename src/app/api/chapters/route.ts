export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { requireText, routeErrorResponse, validationError } from '@/lib/route-helpers';

function validateChapterPayload(body: Record<string, unknown>) {
  const nameError = requireText(body.name, 'اسم الفصل');
  if (nameError) return nameError;
  const opportunities = Number(body.opportunities ?? 0);
  if (!Number.isFinite(opportunities) || opportunities < 0) return 'عدد الفرص يجب أن يكون رقماً صحيحاً لا يقل عن صفر';
  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'chapters.view');
  if (authError) return authError;

  try {
    const { isPaginatedRequest, parsePagination } = await import('@/lib/pagination');
    if (isPaginatedRequest(req)) {
      const { page, limit, skip } = parsePagination(req);
      const [chapters, total] = await Promise.all([
        db.chapter.findMany({ orderBy: { name: 'asc' }, include: { courseLinks: true }, skip, take: limit }),
        db.chapter.count(),
      ]);
      return NextResponse.json({ chapters, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    const chapters = await db.chapter.findMany({ orderBy: { name: 'asc' }, include: { courseLinks: true } });
    return NextResponse.json({ chapters });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الفصول حالياً.');
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, 'chapters.add');
  if (authError) return authError;

  try {
    const body = await req.json();
    const validationMessage = validateChapterPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const chapter = await db.chapter.create({
      data: {
        id: body.id,
        name: String(body.name ?? '').trim(),
        opportunities: Number(body.opportunities || 0),
      },
    });
    return NextResponse.json({ chapter }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حفظ الفصل حالياً.');
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, 'chapters.edit');
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return validationError('تعذر تحديد الفصل المطلوب');
    if (data.name !== undefined) {
      const nameError = requireText(data.name, 'اسم الفصل');
      if (nameError) return validationError(nameError);
      data.name = String(data.name ?? '').trim();
    }
    if (data.opportunities !== undefined) {
      const opportunities = Number(data.opportunities);
      if (!Number.isFinite(opportunities) || opportunities < 0) return validationError('عدد الفرص يجب أن يكون رقماً صحيحاً لا يقل عن صفر');
      data.opportunities = opportunities;
    }
    const chapter = await db.chapter.update({ where: { id }, data });
    return NextResponse.json({ chapter });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحديث الفصل حالياً.');
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'chapters.delete');
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return validationError('تعذر تحديد الفصل المطلوب');
    const activeLinks = await db.courseChapter.count({ where: { chapterId: id, active: true } });
    if (activeLinks > 0) return validationError('لا يمكن حذف فصل مفعل حالياً. ألغِ تفعيله أولاً.', 409);
    await db.$transaction(async (tx) => {
      await tx.courseChapter.deleteMany({ where: { chapterId: id } });
      await tx.chapter.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر حذف الفصل حالياً.');
  }
}
