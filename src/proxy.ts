import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global CSRF guard. Any non-GET request to /api/* must come with a
 * valid Origin or Referer that matches the deployed host.
 */
export function proxy(req: NextRequest) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/')) return NextResponse.next();
  if (url.pathname.startsWith('/api/telegram-exam-submissions')) {
    // Bot endpoint uses bearer token, not cookies; CSRF doesn't apply.
    return NextResponse.next();
  }
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return NextResponse.next();
  }
  const error = checkOrigin(req);
  if (error) return error;
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
