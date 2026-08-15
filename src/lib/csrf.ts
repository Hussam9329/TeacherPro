import { NextRequest, NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Validates that the request Origin/Referer matches the deployed host
 * for state-changing requests. This blocks CSRF attacks where a
 * third-party site tricks the user's browser into submitting a
 * credentialed request to this API.
 *
 * Cookie-based auth is SameSite=Lax, which already blocks most CSRF
 * from cross-site forms, but this adds defense-in-depth for non-GET
 * methods and for any future change to cookie attributes.
 */
export function checkOrigin(req: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host =
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    '';

  if (!host) {
    // No host header is suspicious on a deployed API; allow only on
    // localhost dev where headers may be minimal.
    return null;
  }

  const normalizeHost = (value: string): string => value.trim().toLowerCase().replace(/\.$/, '');
  const requestHost = normalizeHost(host);
  const requestHostname = normalizeHost(host.split(':')[0] || host);

  const isLocalhost = (value: string): boolean => value === 'localhost' || value === '127.0.0.1';

  const checkUrl = (value: string | null): boolean => {
    if (!value) return false;
    if (value === 'null') return false; // sandboxed iframe origin
    try {
      const url = new URL(value);
      const urlHost = normalizeHost(url.host);
      const urlHostname = normalizeHost(url.hostname);

      // Exact same host including port is always valid.
      if (urlHost === requestHost) return true;

      // Local development may use different ports between tools; keep this
      // exception limited to localhost/127.0.0.1 only.
      if (isLocalhost(requestHostname) && isLocalhost(urlHostname)) return true;

      // Production rule: accept only the deployed host itself or a real
      // subdomain of that host. Never accept the parent domain.
      // Example: app.example.com accepts api.app.example.com, but does NOT
      // accept example.com.
      if (urlHostname === requestHostname) return true;
      if (urlHostname.endsWith(`.${requestHostname}`)) return true;

      return false;
    } catch {
      return false;
    }
  };

  // Prefer Origin header; fall back to Referer for browsers that don't
  // send Origin on same-site requests.
  if (origin) {
    if (checkUrl(origin)) return null;
    return NextResponse.json(
      { error: 'طلب غير مصرح به (Origin غير صالح).' },
      { status: 403 },
    );
  }

  if (referer) {
    if (checkUrl(referer)) return null;
    return NextResponse.json(
      { error: 'طلب غير مصرح به (Referer غير صالح).' },
      { status: 403 },
    );
  }

  // No Origin and no Referer on a state-changing request — block.
  // Modern browsers ALWAYS send Origin on fetch() POST/PUT/DELETE, and
  // always send Referer on form submissions. A request with neither is
  // from a non-browser client (curl, bot, script) which can use the
  // API directly with a bearer token if needed.
  //
  // SameSite=Lax cookies provide backup protection for form POSTs, but
  // we enforce Origin/Referer as the primary CSRF defense.
  return NextResponse.json(
    { error: 'طلب غير مصرح به (لا يوجد Origin/Referer).' },
    { status: 403 },
  );
}
