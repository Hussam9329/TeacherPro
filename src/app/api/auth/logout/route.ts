export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/server-auth';
// Logging out ends this device's session only. Bumping the account's
// sessionVersion here also signed out every other phone/computer using the
// same account, and their next grade save failed with «يجب تسجيل الدخول أولاً».
// A password change or deactivation still revokes every session (DB trigger).
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
