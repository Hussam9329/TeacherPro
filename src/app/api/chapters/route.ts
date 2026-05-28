import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const chapters = await db.chapter.findMany({ orderBy: { name: 'asc' }, include: { courseLinks: true } });
  return NextResponse.json({ chapters });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const chapter = await db.chapter.create({
    data: {
      id: body.id,
      name: body.name,
      opportunities: Number(body.opportunities || 0),
    },
  });
  return NextResponse.json({ chapter }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (data.opportunities !== undefined) data.opportunities = Number(data.opportunities);
  const chapter = await db.chapter.update({ where: { id }, data });
  return NextResponse.json({ chapter });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.chapter.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
