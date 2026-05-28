import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const demoCopies = await db.demoCopy.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ demoCopies });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const demoCopy = await db.demoCopy.create({
    data: {
      id: body.id,
      name: body.name,
      description: body.description || '',
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      active: body.active ?? true,
      demoUserId: body.demoUserId,
      createdFromData: body.createdFromData ?? false,
      snapshot: typeof body.snapshot === 'string' ? body.snapshot : JSON.stringify(body.snapshot || {}),
      limits: typeof body.limits === 'string' ? body.limits : JSON.stringify(body.limits || {}),
      durationDays: body.durationDays ?? 7,
    },
  });
  return NextResponse.json({ demoCopy }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const updateData: Record<string, unknown> = { ...data };
  if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  if (data.snapshot !== undefined && typeof data.snapshot !== 'string') updateData.snapshot = JSON.stringify(data.snapshot);
  if (data.limits !== undefined && typeof data.limits !== 'string') updateData.limits = JSON.stringify(data.limits);

  const demoCopy = await db.demoCopy.update({ where: { id }, data: updateData });
  return NextResponse.json({ demoCopy });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.demoCopy.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
