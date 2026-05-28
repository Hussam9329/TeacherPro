import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const sites = await db.site.findMany({ orderBy: { main: 'asc' }, include: { course: true } });
  return NextResponse.json({ sites });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const site = await db.site.upsert({
      where: { id: body.id },
      update: { main: body.main, sub: body.sub, active: body.active ?? true, courseId: body.courseId },
      create: {
        id: body.id,
        main: body.main,
        sub: body.sub,
        active: body.active ?? true,
        courseId: body.courseId,
      },
    });
    return NextResponse.json({ site }, { status: 201 });
  } catch (e) {
    console.error('[sites POST] Error:', e);
    return NextResponse.json({ error: 'Failed to create site' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const site = await db.site.update({ where: { id }, data });
  return NextResponse.json({ site });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.site.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
