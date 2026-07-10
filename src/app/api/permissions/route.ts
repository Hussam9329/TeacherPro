export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/server-auth';
import { PERMISSION_CATALOG } from '@/lib/teacher-store';

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['accounts.view', 'accounts.permissions.view']);
  if (authError) return authError;

  return NextResponse.json({ catalog: PERMISSION_CATALOG });
}
