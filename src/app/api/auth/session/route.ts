export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/server-auth';

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return NextResponse.json({ user: null });

    // Keep active users signed in by refreshing the cookie whenever the
    // client verifies the session. This prevents unexpected logout while
    // the application is still open and being used.
    const res = NextResponse.json({ user: session.principal });
    await session.renewCookie(res);
    return res;
  } catch (error) {
    console.error('[API] /api/auth/session error:', error);
    return NextResponse.json({ error: 'تعذر التحقق من الجلسة حالياً.' }, { status: 503 });
  }
}
