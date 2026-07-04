export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';

/**
 * Returns distinct location options (locationScope, subSite, mainSite) for student
 * filtering across all students the user is allowed to view. Used by
 * student-registry to populate filter dropdowns without loading all students.
 *
 * Returns: { locations: { scope: string, subSite: string }[] }
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'students.view');
  if (authError) return authError;

  try {
    // Use distinct query instead of loading all students
    const results = await db.student.findMany({
      select: { locationScope: true, subSite: true, mainSite: true },
      distinct: ['locationScope', 'subSite', 'mainSite'],
    });

    const locations = results
      .filter((r) => r.locationScope || r.subSite || r.mainSite)
      .map((r) => ({
        scope: r.locationScope || r.mainSite || '',
        subSite: r.subSite || '',
      }))
      .filter((loc, index, self) =>
        index === self.findIndex((l) => l.scope === loc.scope && l.subSite === loc.subSite)
      );

    return NextResponse.json({ locations });
  } catch (error) {
    console.error('[API] /api/students/filter-options error:', error);
    return NextResponse.json(
      { error: 'تعذر تحميل خيارات الفلترة حالياً.' },
      { status: 500 },
    );
  }
}
