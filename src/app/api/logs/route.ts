export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'logs.view');
  if (authError) return authError;

  const logs = await db.auditLog.findMany({ orderBy: { time: 'desc' }, take: 500 });
  return NextResponse.json({ logs });
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const body = await req.json();
  const log = await db.auditLog.create({
    data: {
      id: body.id,
      module: body.module,
      action: body.action,
      details: body.details,
      userName: body.userName,
      userId: body.userId,
    },
  });
  return NextResponse.json({ log }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, 'logs.view');
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.auditLog.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
