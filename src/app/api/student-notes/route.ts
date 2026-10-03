export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { routeErrorResponse } from '@/lib/route-helpers';
import { withDatabaseSchema } from '@/lib/schema-readiness';
import { RETIRED_FOLLOWUP_NOTE_KIND } from '@/lib/retired-followup-compat';

function readListPagination(req: NextRequest, fallbackPageSize = 100, maxPageSize = 500) {
  const searchParams = new URL(req.url).searchParams;
  const rawPageSize = searchParams.get('pageSize') ?? searchParams.get('limit');
  const rawPage = searchParams.get('page');
  const pageNumber = Number(rawPage ?? 1);
  const pageSizeNumber = Number(rawPageSize ?? fallbackPageSize);
  const page = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1;
  const pageSize = Number.isFinite(pageSizeNumber) && pageSizeNumber > 0
    ? Math.min(Math.floor(pageSizeNumber), maxPageSize)
    : fallbackPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, 'follow-up.view');
  if (authError) return authError;

  try {
    const { page, pageSize, skip } = readListPagination(req);
    const where = { kind: { not: RETIRED_FOLLOWUP_NOTE_KIND } };
    const [totalCount, studentNotes] = await withDatabaseSchema(
      () => Promise.all([
        db.studentNote.count({ where }),
        db.studentNote.findMany({ where, orderBy: { date: 'desc' }, skip, take: pageSize }),
      ]),
      'StudentNote',
    );
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return NextResponse.json({ studentNotes, totalCount, page, pageSize, totalPages, hasMore: page < totalPages });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل الملاحظات حالياً.');
  }
}
