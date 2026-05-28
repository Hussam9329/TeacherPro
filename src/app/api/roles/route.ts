import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const roles = await db.role.findMany({
    orderBy: { name: 'asc' },
    include: { users: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ roles });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const role = await db.role.create({
    data: {
      id: body.id,
      name: body.name,
      isDefault: body.isDefault ?? false,
      permissions: JSON.stringify(body.permissions ?? []),
    },
  });
  return NextResponse.json({ role }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (data.permissions && Array.isArray(data.permissions)) {
    data.permissions = JSON.stringify(data.permissions);
  }
  const role = await db.role.update({ where: { id }, data });
  return NextResponse.json({ role });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const role = await db.role.findUnique({ where: { id } });
  if (role?.isDefault) return NextResponse.json({ error: 'لا يمكن حذف دور افتراضي' }, { status: 403 });
  await db.role.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
