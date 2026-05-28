import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const sites = await db.site.findMany({ orderBy: { main: 'asc' }, include: { course: true } });
  return NextResponse.json({ sites });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const site = await db.site.create({
    data: {
      id: body.id,
      main: body.main,
      sub: body.sub,
      active: body.active ?? true,
      courseId: body.courseId,
    },
  });
  return NextResponse.json({ site }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'تعذر تحديد الموقع المطلوب' }, { status: 400 });
  const site = await db.site.update({ where: { id }, data });
  return NextResponse.json({ site });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'تعذر تحديد الموقع المطلوب' }, { status: 400 });
  const site = await db.site.findUnique({ where: { id } });
  if (!site) {
    return NextResponse.json({ error: 'الموقع غير موجود أو تم حذفه مسبقاً' }, { status: 404 });
  }

  const linkedStudentsCount = await db.student.count({
    where: {
      courseId: site.courseId,
      mainSite: site.main,
      subSite: site.sub || '',
    },
  });
  if (linkedStudentsCount > 0) {
    return NextResponse.json(
      { error: 'لا يمكن حذف الموقع لأنه مرتبط بطلاب. انقل الطلاب أولاً ثم حاول الحذف.' },
      { status: 409 },
    );
  }

  await db.site.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
