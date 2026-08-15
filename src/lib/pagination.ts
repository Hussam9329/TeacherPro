import { NextRequest } from 'next/server';

/**
 * Shared pagination helper for all API endpoints.
 *
 * Usage in a route:
 *   const paginated = isPaginatedRequest(req);
 *   if (paginated) {
 *     const { page, limit, skip } = parsePagination(req);
 *     const [rows, total] = await Promise.all([
 *       db.model.findMany({ skip, take: limit }),
 *       db.model.count(),
 *     ]);
 *     return NextResponse.json({ rows, total, page, limit, totalPages: Math.ceil(total / limit) });
 *   }
 *   // Legacy fallback removed in heavy routes; prefer paginated responses
 *   const rows = await db.model.findMany();
 *   return NextResponse.json({ rows });
 */

export function parsePagination(req: NextRequest): { page: number; limit: number; skip: number } {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('pageSize') || url.searchParams.get('limit') || '50')));
  return { page, limit, skip: (page - 1) * limit };
}

export function isPaginatedRequest(req: NextRequest): boolean {
  const url = new URL(req.url);
  return url.searchParams.has('page') || url.searchParams.has('limit') || url.searchParams.has('pageSize');
}
