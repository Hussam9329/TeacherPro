export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthPrincipal, requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'logs.view');
  if (authError) return authError;

  const logs = await db.auditLog.findMany({ orderBy: { time: 'desc' }, take: 500 });
  return NextResponse.json({ logs });
}

/**
 * Audit logs are SERVER-ONLY. The client may send only module/action/details;
 * userId/userName are always taken from the authenticated principal so a
 * logged-in user cannot forge entries attributed to someone else.
 *
 * The id field is also ignored — the server generates it.
 */
export async function POST(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const module = String(body?.module ?? '').trim().slice(0, 120);
  const action = String(body?.action ?? '').trim().slice(0, 120);
  const details = body?.details === undefined || body?.details === null
    ? null
    : String(body.details).slice(0, 2000);

  if (!module || !action) {
    return NextResponse.json({ error: 'الوحدة والإجراء مطلوبان.' }, { status: 400 });
  }

  const log = await db.auditLog.create({
    data: {
      module,
      action,
      details,
      userId: principal.id,
      userName: principal.name || principal.username,
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
