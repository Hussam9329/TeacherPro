import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function normalizePermissions(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return '[]';
}

export async function GET() {
  const users = await db.appUser.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      roleId: true,
      permissions: true,
      active: true,
      createdAt: true,
      roleRef: true,
      correctionSheets: true,
      logs: true,
    },
  });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const user = await db.appUser.create({
    data: {
      id: body.id,
      username: body.username,
      name: body.name,
      passwordHash: body.passwordHash ?? body.password,
      role: body.role,
      roleId: body.roleId,
      permissions: normalizePermissions(body.permissions),
      active: body.active ?? true,
    },
  });
  const { passwordHash: _pw, ...safeUser } = user;
  return NextResponse.json({ user: safeUser }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const updateData: Record<string, unknown> = { ...data };
  if (updateData.permissions !== undefined) updateData.permissions = normalizePermissions(updateData.permissions);
  if (updateData.password !== undefined) {
    updateData.passwordHash = updateData.password;
    delete updateData.password;
  }

  const user = await db.appUser.update({ where: { id }, data: updateData });
  const { passwordHash: _pw, ...safeUser } = user;
  return NextResponse.json({ user: safeUser });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.appUser.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
