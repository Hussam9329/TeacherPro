export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server-auth';
import { db } from '@/lib/db';

/**
 * Lightweight stats endpoint for the dashboard.
 *
 * Returns only the counts the dashboard needs (via efficient COUNT(*)
 * queries) instead of forcing the client to load all students, grades,
 * and correction sheets just to compute .filter().length.
 *
 * Response:
 *   {
 *     activeStudents: number,
 *     dismissedStudents: number,
 *     totalStudents: number,
 *     pendingCorrectionSheets: number,
 *     recentLogs: AuditLog[]  // latest 6, for the activity feed
 *   }
 */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    // Run all count queries in parallel for maximum speed.
    const [
      activeCount,
      dismissedCount,
      totalCount,
      pendingSheetsCount,
      recentLogs,
    ] = await Promise.all([
      db.student.count({ where: { status: 'نشط' } }),
      db.student.count({ where: { status: 'مفصول' } }),
      db.student.count(),
      db.correctionSheet.count({ where: { NOT: { status: 'مكتمل' } } }),
      db.auditLog.findMany({
        orderBy: { time: 'desc' },
        take: 6,
      }),
    ]);

    return NextResponse.json({
      activeStudents: activeCount,
      dismissedStudents: dismissedCount,
      totalStudents: totalCount,
      pendingCorrectionSheets: pendingSheetsCount,
      recentLogs,
    });
  } catch (error) {
    console.error('[API] /api/stats error:', error);
    return NextResponse.json(
      { error: 'تعذر تحميل الإحصائيات حالياً.' },
      { status: 500 },
    );
  }
}
