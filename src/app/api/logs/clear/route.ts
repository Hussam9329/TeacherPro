export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthPrincipal } from '@/lib/server-auth';
import { verifyPassword } from '@/lib/passwords';
import { routeErrorResponse } from '@/lib/route-helpers';
import { ensureInitialAdminSeed } from '@/lib/admin-seed';

export async function POST(req: NextRequest) {
  try {
    const principal = await getAuthPrincipal(req);
    if (!principal) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
    }
    if (!principal.isAdmin) {
      return NextResponse.json({ error: 'هذه العملية متاحة لمدير النظام فقط.' }, { status: 403 });
    }

    await ensureInitialAdminSeed();

    const body = await req.json().catch(() => ({})) as { password?: unknown };
    const password = String(body.password ?? '').trim();
    if (!password) {
      return NextResponse.json({ error: 'أدخل رمز حساب الأدمن لتأكيد التصفير.' }, { status: 400 });
    }

    const adminUser = await db.appUser.findUnique({
      where: { id: principal.id },
      select: { passwordHash: true },
    });
    if (!adminUser || !(await verifyPassword(password, adminUser.passwordHash))) {
      return NextResponse.json({ error: 'رمز حساب الأدمن غير صحيح.' }, { status: 403 });
    }

    const [auditLogsResult, opportunityLogsResult] = await db.$transaction([
      db.auditLog.deleteMany({}),
      db.opportunityLog.deleteMany({}),
    ]);

    return NextResponse.json({
      ok: true,
      deleted: auditLogsResult.count + opportunityLogsResult.count,
      deletedAuditLogs: auditLogsResult.count,
      deletedOpportunityLogs: opportunityLogsResult.count,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تصفير السجلات حالياً.');
  }
}
