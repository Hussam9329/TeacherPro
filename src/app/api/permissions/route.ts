import { NextResponse } from 'next/server';
import { PERMISSION_CATALOG } from '@/lib/teacher-store';

export async function GET() {
  return NextResponse.json({ catalog: PERMISSION_CATALOG });
}
