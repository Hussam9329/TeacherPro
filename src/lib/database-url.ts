/**
 * The connection string handed to the `pg` driver.
 *
 * pg 8 already treats sslmode=prefer, require and verify-ca exactly like
 * verify-full (certificate and host name are checked), but warns about it on
 * every cold start, and Vercel logs that warning as an error. Naming the mode
 * it actually uses keeps the same connection without the warning.
 */
const PG_VERIFY_FULL_ALIASES = new Set(["prefer", "require", "verify-ca"]);

export function pgConnectionString(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return databaseUrl;
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }
  const sslmode = url.searchParams.get("sslmode");
  if (!sslmode || !PG_VERIFY_FULL_ALIASES.has(sslmode)) return databaseUrl;
  // libpq compatibility mode gives these modes their weaker libpq meaning; keep it as configured.
  if (url.searchParams.get("uselibpqcompat") === "true") return databaseUrl;
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
