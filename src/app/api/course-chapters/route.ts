import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const courseChapters = await db.courseChapter.findMany({
    orderBy: { courseId: 'asc' },
    include: { course: true, chapter: true },
  });
  return NextResponse.json({ courseChapters });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const courseChapter = await db.courseChapter.create({
    data: {
      id: body.id,
      active: body.active ?? false,
      archived: body.archived ?? false,
      archive: body.archive ?? '[]',
      courseId: body.courseId,
      chapterId: body.chapterId,
    },
  });
  return NextResponse.json({ courseChapter }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const courseChapter = await db.courseChapter.update({ where: { id }, data });
  return NextResponse.json({ courseChapter });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.courseChapter.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
