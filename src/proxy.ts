import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { requireBotToken } from '@/lib/bot-integration-auth';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global CSRF guard. Any non-GET request to /api/* must come with a
 * valid Origin or Referer that matches the deployed host.
 */
export function proxy(req: NextRequest) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/')) return NextResponse.next();
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return NextResponse.next();
  }
  if (['/api/bot/opportunities', '/api/bot/students/resolve', '/api/bot/students/link'].includes(url.pathname) && req.method === 'POST') {
    return requireBotToken(req) || NextResponse.next();
  }
  const error = checkOrigin(req);
  if (error) return error;
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
