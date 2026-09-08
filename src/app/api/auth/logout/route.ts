export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookie, getAuthPrincipal } from '@/lib/server-auth';
import { db } from '@/lib/db';
export async function POST(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (principal) await db.appUser.update({ where: { id: principal.id }, data: { sessionVersion: { increment: 1 } } });
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
