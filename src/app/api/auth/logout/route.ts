export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/server-auth';

// Signing out ends this device's session only. Several people may share one
// account on different laptops; one of them signing out must not sign the
// others out mid-work. A password change still ends every session (the
// database bumps sessionVersion whenever passwordHash changes).
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
