export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthPrincipal } from '@/lib/server-auth';
import { routeErrorResponse } from '@/lib/route-helpers';

const LOG_RESET_PASSWORD = '204871';

export async function POST(req: NextRequest) {
  try {
    const principal = await getAuthPrincipal(req);
    if (!principal) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً.' }, { status: 401 });
    }
    if (!principal.isAdmin) {
      return NextResponse.json({ error: 'هذه العملية متاحة لمدير النظام فقط.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as { password?: unknown };
    const password = String(body.password ?? '').trim();
    if (password !== LOG_RESET_PASSWORD) {
      return NextResponse.json({ error: 'الباسوورد الخاص غير صحيح.' }, { status: 403 });
    }

    const result = await db.auditLog.deleteMany({});
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تصفير السجلات حالياً.');
  }
}
