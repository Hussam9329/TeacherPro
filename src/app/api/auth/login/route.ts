export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { findUserByUsername, setAuthCookie, toAuthPrincipal } from '@/lib/server-auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      return NextResponse.json({ error: 'اسم المستخدم وكلمة المرور مطلوبة.' }, { status: 400 });
    }

    const user = await findUserByUsername(username);
    if (!user || !user.active) {
      return NextResponse.json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' }, { status: 401 });
    }

    // المرحلة الحالية تحمي الـ API بجلسة سيرفر. تشفير كلمات المرور يتم في patch منفصل.
    if (String(user.passwordHash || '') !== password) {
      return NextResponse.json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' }, { status: 401 });
    }

    const res = NextResponse.json({ user: toAuthPrincipal(user) });
    await setAuthCookie(res, user.id);
    return res;
  } catch (error) {
    console.error('[API] /api/auth/login error:', error);
    return NextResponse.json({ error: 'تعذر تسجيل الدخول حالياً.' }, { status: 500 });
  }
}
