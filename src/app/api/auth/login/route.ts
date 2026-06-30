export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialAdminSeed } from '@/lib/admin-seed';
import { db } from '@/lib/db';
import { findUserByUsername, setAuthCookie, toAuthPrincipal } from '@/lib/server-auth';
import { hashPassword, isPasswordHash, verifyPassword } from '@/lib/passwords';

export async function POST(req: NextRequest) {
  try {
    await ensureInitialAdminSeed();

    const body = await req.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      return NextResponse.json({ error: 'اسم المستخدم وكلمة المرور مطلوبة.' }, { status: 400 });
    }

    const user = await findUserByUsername(username);
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      await db.auditLog.create({
        data: {
          module: 'أمان الحسابات',
          action: 'فشل تسجيل دخول',
          details: JSON.stringify({ username }),
          userName: username || 'غير محدد',
        },
      }).catch((error) => console.warn('[security-audit] failed login audit failed:', error));
      return NextResponse.json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' }, { status: 401 });
    }

    // Legacy migration: old rows stored passwords as plain text. After a
    // successful login, convert that one account to a proper hash silently.
    if (!isPasswordHash(user.passwordHash)) {
      const passwordHash = await hashPassword(password);
      await db.appUser.update({ where: { id: user.id }, data: { passwordHash } });
      user.passwordHash = passwordHash;
    }

    await db.auditLog.create({
      data: {
        module: 'أمان الحسابات',
        action: 'نجاح تسجيل دخول',
        details: JSON.stringify({ username: user.username }),
        userId: user.id,
        userName: user.name || user.username,
      },
    }).catch((error) => console.warn('[security-audit] login audit failed:', error));

    const res = NextResponse.json({ user: toAuthPrincipal(user) });
    await setAuthCookie(res, user.id);
    return res;
  } catch (error) {
    console.error('[API] /api/auth/login error:', error);
    return NextResponse.json({ error: 'تعذر تسجيل الدخول حالياً.' }, { status: 500 });
  }
}
