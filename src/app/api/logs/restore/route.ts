export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
export async function POST(req: NextRequest) {
  const error = await requirePermission(req, 'logs.restore');
  if (error) return error;
  return NextResponse.json({ error: 'أُوقفت أداة مسح واسترجاع السجلات القديمة لحماية دفتر الفرص وسجل التدقيق. السجلات الحالية محفوظة.', code: 'LEDGER_HISTORY_IMMUTABLE' },
    { status: 410, headers: { 'x-teacherpro-retryable': 'false' } });
}
