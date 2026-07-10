export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { PERMISSION_CATALOG, SECTION_PERMISSIONS } from '@/lib/teacher-store';

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'accounts.view');
  if (authError) return authError;

  return NextResponse.json({ catalog: PERMISSION_CATALOG, sectionPermissions: SECTION_PERMISSIONS, source: 'database' });
}
