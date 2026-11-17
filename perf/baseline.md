# FastMe baseline (before any change)

Commit measured: `39ceeac` (origin/main), measured 2026-11-17 on the owner's Windows 11 laptop.

## What was measured, and how

Everything in this file is **measured** unless a line says otherwise.

- **Stack:** Next.js 16.2 (App Router, Turbopack build), React 19, Prisma 6.19 through the `pg` driver, Zustand. One client-rendered page (`/`) that switches 15 sections with `?section=`, plus the API routes.
- **Server:** production build (`npm run build:app`) served locally with `next start -p 3187`. No Vercel and no CDN: TTFB and compression are those of a local Node server (gzip), not of production (Brotli at the edge).
- **Database:** a throwaway in-memory PGlite (PostgreSQL compiled to WebAssembly) started by `perf/db-server.cjs`, schema from the repo's 89 migrations, synthetic seed: 3,000 students, 6 courses, 180 exams, 90,000 grades, 20,000 opportunity movements, 60,000 audit rows, 6,000 calls, 3,000 notes, 400 leaves, 9 accounts. **No real database was contacted.** PGlite is single-threaded, slower than real Postgres on heavy queries, and has no network distance, so the absolute endpoint times are not production times; the round-trip counts and the before/after ratios are what carry over.
- **DB round trips:** counted by the proxy in `perf/db-server.cjs` (one per Sync/Query message the app sends) for one request, session lookup included.
- **"Added DB latency" column:** the same proxy delays every round trip with a 5 ms timer. Windows timers fire about every 15.6 ms, so the real added delay is about 16 ms per round trip. It stands in for a database that is not next to the function.
- **Pages** (`perf/measure-pages.cjs`, Playwright 1.65 driving Chromium build 1254 over CDP, a fresh browser context per run = empty cache, median of 3 runs):
  - **mobile profile:** viewport 412x823, DPR 2.625, mobile UA, **CPU slowdown 4x**, **Slow 4G** (latency 562.5 ms, download 180,000 B/s, upload 84,375 B/s: the DevTools/Lighthouse applied-throttling values).
  - **desktop profile:** viewport 1366x768, no throttling.
  - FCP/LCP/CLS from PerformanceObserver; TBT = long-task time over 50 ms after FCP; "Settled" = navigation start until no request has been in flight for 1.5 s; bytes = encoded (on the wire) from CDP.
  - Signed-in pages sign in first as the seeded admin through `/api/auth/login`.
- **Endpoints** (`perf/measure-api.cjs`): one signed-in client, 3 warm-up requests, then 30 sequential requests each (10 for the latency run); p50/p95 of the whole HTTP request on localhost.
- **Not measured:** the Lighthouse performance score (Lighthouse is not installed; the same lab metrics were collected with Playwright + CDP), INP (needs real interaction; TBT is the lab stand-in), production TTFB, real-user Web Vitals.

## Build output

Next 16 with Turbopack prints no per-route sizes, and the app has a single page, so every section shares the same first-load files:

| File group | Raw bytes | Gzip bytes |
|---|---|---|
| JavaScript, 12 chunks (one 1,342,477-byte chunk holds all 15 sections) | 2,048,650 | 582,363 |
| CSS, 3 files | 479,607 | 71,406 |
| Fonts in `public/fonts` (TTF): Cairo 599,548 + Inter 879,708 + JetBrains Mono 187,208 | 1,666,464 | Cairo + Inter load on every first visit: 743 KB on the wire |

### Pages, mobile profile (median of 3 cold loads)

| Page | TTFB ms | FCP ms | LCP ms | TBT ms | CLS | Load ms | Settled ms | Requests | API requests | Transfer KB | JS KB | CSS KB | Font KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| login | 566 | 2052 | 9944 | 1240 | 0.001 | 8607 | 11145 | 19 | 1 | 1363 | 540 | 72 | 743 |
| dashboard | 565 | 1980 | 8752 | 2385 | 0.182 | 8475 | 11771 | 23 | 6 | 1498 | 540 | 72 | 743 |
| student-registry | 564 | 1908 | 10908 | 2328 | 0.288 | 8397 | 12835 | 26 | 9 | 1528 | 540 | 72 | 743 |
| grade-entry | 566 | 1872 | 8700 | 1563 | 0.084 | 8910 | 12530 | 22 | 5 | 1510 | 540 | 72 | 743 |
| exam-records | 564 | 1828 | 10080 | 2174 | 0.122 | 8454 | 13394 | 23 | 6 | 1511 | 540 | 72 | 743 |
| grade-records | 565 | 1936 | 10004 | 1220 | 0.270 | 8350 | 11734 | 23 | 6 | 1508 | 540 | 72 | 743 |
| opportunities | 565 | 1904 | 10748 | 1901 | 0.395 | 8431 | 12077 | 26 | 9 | 1540 | 540 | 72 | 743 |
| follow-up-calls | 565 | 1852 | 8956 | 1330 | 0.090 | 8470 | 11925 | 21 | 4 | 1495 | 540 | 72 | 743 |
| logs | 565 | 1840 | 10804 | 1369 | 0.187 | 8416 | 11818 | 22 | 5 | 1505 | 540 | 72 | 743 |

### Pages, desktop profile (median of 3 cold loads)

| Page | TTFB ms | FCP ms | LCP ms | TBT ms | CLS | Load ms | Settled ms | Requests | API requests | Transfer KB | JS KB | CSS KB | Font KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| login | 5 | 140 | 828 | 72 | 0.000 | 397 | 605 | 19 | 1 | 1363 | 540 | 72 | 743 |
| dashboard | 7 | 156 | 792 | 207 | 0.206 | 428 | 789 | 23 | 6 | 1498 | 540 | 72 | 743 |
| student-registry | 9 | 148 | 1076 | 204 | 0.084 | 396 | 1023 | 26 | 9 | 1528 | 540 | 72 | 743 |
| grade-entry | 11 | 212 | 780 | 208 | 0.070 | 737 | 1054 | 22 | 5 | 1510 | 540 | 72 | 743 |
| exam-records | 12 | 152 | 952 | 529 | 0.084 | 860 | 1898 | 23 | 6 | 1512 | 540 | 72 | 743 |
| grade-records | 9 | 108 | 1820 | 42 | 0.080 | 276 | 2172 | 23 | 6 | 1508 | 540 | 72 | 743 |
| opportunities | 6 | 152 | 1000 | 112 | 0.418 | 394 | 1040 | 26 | 9 | 1540 | 540 | 72 | 743 |
| follow-up-calls | 6 | 128 | 648 | 63 | 0.060 | 338 | 663 | 21 | 4 | 1495 | 540 | 72 | 743 |
| logs | 8 | 156 | 1024 | 80 | 0.073 | 363 | 934 | 22 | 5 | 1505 | 540 | 72 | 743 |

### Endpoints (sequential requests, 30 samples; latency run 10 samples)

| Endpoint | DB round trips | p50 ms | p95 ms | p50 ms with added DB latency | Response bytes |
|---|---|---|---|---|---|
| `/api/auth/session` | 4 | 28 | 35.6 | 73.5 | 683 |
| `/api/bootstrap` | 11 | 48.1 | 61.8 | 89.5 | 130722 |
| `/api/sync/version` | 3 | 16.6 | 36.7 | 61.4 | 1030 |
| `/api/stats` | 9 | 22.2 | 35.7 | 155.6 | 152 |
| `/api/stats/alerts` | 10 | 33.6 | 41.1 | 77.4 | 203 |
| `/api/stats/trend?range=month` | 7 | 32.8 | 47.3 | 64.4 | 1478 |
| `/api/course-chapters?page=1&pageSize=500` | 6 | 28.7 | 36.4 | 76.8 | 14647 |
| `/api/students?opportunityMode=1&page=1&pageSize=10` | 10 | 39.5 | 50.9 | 170.4 | 13928 |
| `/api/students/stats` | 7 | 31.3 | 43.7 | 75.8 | 447 |
| `/api/students/filter-options` | 3 | 32 | 43 | 69.7 | 497 |
| `/api/grades?groupBy=student&statusFilter=all&page=1&pageSize=10` | 12 | 504.5 | 573.9 | 753.3 | 12074 |
| `/api/grades/stats` | 7 | 976.1 | 1222.5 | 1468.9 | 68 |
| `/api/exams?page=1&pageSize=10` | 5 | 16.2 | 29.8 | 78.7 | 6413 |
| `/api/exams/stats?examIds=<10 ids>` | 7 | 141.6 | 161.4 | 253.4 | 910 |
| `/api/opportunity-logs?page=1&pageSize=20` | 6 | 31.2 | 40 | 78.6 | 12841 |
| `/api/opportunities/stats` | 27 | 111 | 151.1 | 234.9 | 862 |
| `/api/opportunities/bulk-targets?actionType=add&...` | 8 | 64.3 | 83.2 | 172.8 | 368 |
| `/api/logs?page=1&pageSize=20` | 7 | 349.5 | 494.3 | 430.9 | 10276 |

## What the baseline shows

1. **First load is dominated by two things:** 540 KB (gzip) of JavaScript that contains every section, and 743 KB of TTF fonts. On the mobile profile that is about 1.3 MB over a 180 KB/s link: LCP 8.7-10.9 s on every page, the login screen included.
2. **Startup is a chain of requests:** HTML, then JS, then `/api/auth/session`, then `/api/bootstrap` (with alerts and the sync version), then the section data (`/api/course-chapters`) and the page's own requests.
3. **Round trips:** every API request spends 2 round trips on the session lookup (the account, then its role). `/api/auth/session` reads the account twice (4). `/api/opportunities/stats` needs 27 in three groups that wait for each other. `/api/stats` runs 4 counts one after another inside a transaction (9).
4. **Heaviest endpoint:** `/api/grades/stats` loads every grade of every visible student (90,000 rows here) to answer three numbers.
5. **Duplicate request:** the students page asks for `/api/students/filter-options` twice on open, and again after every page of the list.
6. **Layout shift:** CLS is above 0.1 on most signed-in pages (0.39-0.42 on opportunities).
