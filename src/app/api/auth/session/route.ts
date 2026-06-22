export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthPrincipal, setAuthCookie } from '@/lib/server-auth';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthPrincipal(req);
    if (!user) return NextResponse.json({ user: null });

    // Keep active users signed in by refreshing the cookie whenever the
    // client verifies the session. This prevents unexpected logout while
    // the application is still open and being used.
    const res = NextResponse.json({ user });
    await setAuthCookie(res, user.id);
    return res;
  } catch (error) {
    console.error('[API] /api/auth/session error:', error);
    return NextResponse.json({ error: 'تعذر التحقق من الجلسة حالياً.' }, { status: 503 });
  }
}
