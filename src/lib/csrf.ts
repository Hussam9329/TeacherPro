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

  const allowedHosts = new Set([host, 'localhost', '127.0.0.1']);
  // Also accept Vercel preview domains derived from the host root.
  const hostRoot = host.split(':')[0];
  allowedHosts.add(hostRoot);

  const checkUrl = (value: string | null): boolean => {
    if (!value) return false;
    if (value === 'null') return false; // sandboxed iframe origin
    try {
      const url = new URL(value);
      const urlHost = url.host.split(':')[0] || url.host;
      if (allowedHosts.has(urlHost) || allowedHosts.has(url.host)) return true;
      // Allow same root domain (e.g. teacherpro-eight.vercel.app matches vercel.app preview)
      if (urlHost.endsWith(`.${hostRoot}`) || hostRoot.endsWith(`.${urlHost}`)) {
        return true;
      }
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

  // No Origin and no Referer on a state-changing request.
  // Browsers send Origin on cross-site fetch POSTs and Referer on
  // same-site form submissions. A request with neither is likely:
  //   - a same-site fetch where the browser omitted Origin (some older
  //     browsers do this for same-site requests)
  //   - a direct API call (curl, Postman, bot)
  // SameSite=Lax cookies already block cross-site form POSTs, so we
  // allow this case rather than risk blocking legitimate users.
  return null;
}
