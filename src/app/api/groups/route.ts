import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const groups = await db.group.findMany({ orderBy: { name: 'asc' }, include: { course: true } });
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const group = await db.group.create({
    data: {
      id: body.id,
      name: body.name,
      electronicGroup: body.electronicGroup,
      active: body.active ?? true,
      courseId: body.courseId,
    },
  });
  return NextResponse.json({ group }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const group = await db.group.update({ where: { id }, data });
  return NextResponse.json({ group });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.group.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
