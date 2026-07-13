export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialAdminSeed } from '@/lib/admin-seed';
import { db } from '@/lib/db';
import { findUserByUsername, setAuthCookie, toAuthPrincipal } from '@/lib/server-auth';
import { hashPassword, isPasswordHash, verifyPassword } from '@/lib/passwords';
import { isPasswordAcceptable } from '@/lib/password-policy';
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
} from '@/lib/login-rate-limit';

function getRequestIdentifier(req: NextRequest, username: string): string {
  // Combine username + IP for a per-(user, location) limit so a single
  // attacker can't burn the limit for one username across IPs, and one
  // botnet IP can't burn the limit for many usernames.
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = (forwarded || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return `${username.toLowerCase()}@${ip}`;
}

export async function POST(req: NextRequest) {
  try {
    await ensureInitialAdminSeed();

    const body = await req.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      return NextResponse.json({ error: 'اسم المستخدم وكلمة المرور مطلوبة.' }, { status: 400 });
    }

    // Rate limit BEFORE doing any DB work to keep cheap brute-force
    // attempts from hitting the database.
    const identifier = getRequestIdentifier(req, username);
    const rate = await checkLoginRateLimit(identifier);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `محاولات كثيرة فاشلة. حاول مرة أخرى بعد ${rate.retryAfterSeconds} ثانية.` },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        },
      );
    }

    const user = await findUserByUsername(username);
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      await recordLoginFailure(identifier);
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

    // Successful login clears the failure counter for this identifier.
    clearLoginFailures(identifier).catch(() => {});

    await db.auditLog.create({
      data: {
        module: 'أمان الحسابات',
        action: 'نجاح تسجيل دخول',
        details: JSON.stringify({ username: user.username }),
        userId: user.id,
        userName: user.name || user.username,
      },
    }).catch((error) => console.warn('[security-audit] login audit failed:', error));

    // Q98 FIX: After successful login, expose a `passwordWeak` flag so the
    // UI can prompt the user to change their password. We do NOT block login
    // — that would lock out users who set weak passwords before the policy
    // existed. They can still log in, but will be encouraged to update.
    const principal = toAuthPrincipal(user);
    const passwordWeak = !isPasswordAcceptable(password);
    const res = NextResponse.json({
      user: principal,
      passwordWeak,
      passwordPolicy: {
        minLength: 8,
        requiresLetter: true,
        requiresDigit: true,
      },
    });
    await setAuthCookie(res, user.id);
    return res;
  } catch (error) {
    console.error('[API] /api/auth/login error:', error);
    return NextResponse.json({ error: 'تعذر تسجيل الدخول حالياً.' }, { status: 500 });
  }
}
