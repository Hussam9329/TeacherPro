import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { requireBotToken } from '@/lib/bot-integration-auth';
import { CORRECTION_INTEGRATION_PATHS, requireCorrectionToken } from '@/lib/correction-integration-auth';

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
  // The student mobile app is not a browser either: no Origin header. Its
  // routes authenticate with their own device token inside the handler.
  if (url.pathname.startsWith('/api/student-app/') && req.method === 'POST') {
    return NextResponse.next();
  }
  // The Correction app is a server, not a browser: its own token, no Origin.
  if (CORRECTION_INTEGRATION_PATHS.includes(url.pathname) && req.method === 'POST') {
    return requireCorrectionToken(req) || NextResponse.next();
  }
  const error = checkOrigin(req);
  if (error) return error;
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
