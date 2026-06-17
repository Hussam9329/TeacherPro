export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthPrincipal } from '@/lib/server-auth';

export async function GET(req: NextRequest) {
  const user = await getAuthPrincipal(req);
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user });
}
