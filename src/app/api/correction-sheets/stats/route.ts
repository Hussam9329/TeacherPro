export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { ensureExamSchema } from '@/lib/exam-schema';
import { routeErrorResponse } from '@/lib/route-helpers';

/**
 * إحصائيات أوراق التصحيح من بيانات النظام مباشرة.
 * لا تعتمد على correctionSheets الموجودة في الصفحة لأنها قد تكون صفحة محملة جزئياً.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'correction.view');
  if (authError) return authError;

  try {
    await ensureExamSchema();
    const [total, completed, pending, totals] = await Promise.all([
      db.correctionSheet.count(),
      db.correctionSheet.count({ where: { status: 'مكتمل' } }),
      db.correctionSheet.count({ where: { NOT: { status: 'مكتمل' } } }),
      db.correctionSheet.aggregate({
        _sum: {
          correctionErrors: true,
          sumErrors: true,
        },
      }),
    ]);

    return NextResponse.json({
      total,
      completed,
      pending,
      totalErrors: Number(totals._sum.correctionErrors || 0) + Number(totals._sum.sumErrors || 0),
      source: 'database' as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل إحصائيات التصحيح من بيانات النظام.');
  }
}
