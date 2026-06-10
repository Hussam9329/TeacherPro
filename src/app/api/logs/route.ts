export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const logs = await db.auditLog.findMany({ orderBy: { time: 'desc' }, take: 500 });
  return NextResponse.json({ logs });
}

export async function POST(req: NextRequest) {
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
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await db.auditLog.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
