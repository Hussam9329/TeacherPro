export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { PERMISSION_CATALOG } from '@/lib/teacher-store';

export async function GET() {
  return NextResponse.json({ catalog: PERMISSION_CATALOG });
}
