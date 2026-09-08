export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { routeErrorResponse } from '@/lib/route-helpers';
import { assertDatabaseSchemaReady } from '@/lib/schema-readiness';

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'opportunities.view');
  if (authError) return authError;

  try {
    await assertDatabaseSchemaReady();

    const { parsePagination } = await import('@/lib/pagination');
    const { page, limit, skip } = parsePagination(req);
    const { searchParams } = new URL(req.url);
    const studentId = String(searchParams.get('studentId') || '').trim();
    const where = studentId ? { studentId } : {};
    const [opportunityLogs, totalCount] = await Promise.all([
      db.opportunityLog.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
        include: {
          student: { select: { id: true, name: true, code: true, courseId: true, status: true } },
          exam: { select: { id: true, name: true, date: true, type: true } },
        },
      }),
      db.opportunityLog.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    return NextResponse.json({
      opportunityLogs,
      total: totalCount,
      totalCount,
      page,
      limit,
      pageSize: limit,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل سجل الفرص حالياً.');
  }
}

async function retiredMutation(req: NextRequest) {
  const authError = await requirePermission(req, 'opportunities.manage');
  if (authError) return authError;
  return NextResponse.json({ error: 'سجل الفرص دفتر حسابي دائم. استخدم إجراء الفرص أو التراجع الموثق من إدارة الفرص.', code: 'OPPORTUNITY_LEDGER_COMMAND_REQUIRED' },
    { status: 410, headers: { 'x-teacherpro-retryable': 'false' } });
}
export const POST = retiredMutation;
export const DELETE = retiredMutation;
