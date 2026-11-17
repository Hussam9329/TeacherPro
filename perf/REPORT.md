# FastMe report: TeacherPro

Branch `claude/fastme-teacherpro`, cut from `origin/main` at `39ceeac`. Measured 2026-11-17/18.

## Result in short

On the slow-mobile profile (4x CPU slowdown, Slow 4G, empty cache), measured on the same laptop, same seed, before build and after build back to back:

- **LCP:** 8.2-9.9 s before, 4.3-7.0 s after (-18% to -48% by page).
- **Page settled** (last request answered): 10.5-12.4 s before, 6.6-7.9 s after (-30% to -42%).
- **Main-thread blocking (TBT):** -45% to -68%.
- **Bytes on a first visit:** 1.36-1.54 MB before, 0.76-0.90 MB after (-40% to -49%). Fonts 743 KB to 252 KB, JavaScript 540 KB to 298-427 KB.
- **First paint (FCP) did not change** (1.8 s), and **layout shift (CLS) was not fixed** (still above 0.1 on five pages of the mobile profile; recommendation 4).
- **Server:** `/api/grades/stats` p50 549 ms to 137 ms (-75%), `/api/logs` 175 ms to 65 ms (-63%), `/api/auth/session` 4 database round trips to 2, `/api/opportunities/stats` -41% once each round trip costs about 16 ms. The other endpoints were not changed.
- **What it cost:** more, smaller JavaScript files, so a cold first load makes 29-35 requests instead of 19-26.

Thirteen code commits plus this report, nothing pushed. Typecheck, lint and the 132 test commands pass; the non-database build passes.

## How to read the numbers

- **Measured** means it came out of `perf/measure-pages.cjs` or `perf/measure-api.cjs` against a production build served locally (`next start`) with a throwaway in-memory PGlite database and synthetic data (3,000 students, 90,000 grades, 60,000 audit rows; `perf/baseline.md` has the full method and the exact throttling settings). No real database was contacted and nothing was deployed.
- The "before" numbers in this file are **not** the ones in `perf/baseline.md`. The laptop was busy with another measurement session during that first run, and once it went quiet every endpoint, touched or not, ran about twice as fast. So the before build (`39ceeac`, exported to a temp folder and built there) was measured again right after the after build, with the same scripts, settings, seed and a fresh database. `baseline.md` keeps the first run as it was taken.
- Even so, two runs of the same code differ. The endpoints this branch did not touch are the control: with the added latency (where every request takes long enough to time properly) they moved between -9% and +4%. Without it, the quick endpoints sit on 15 ms or 30 ms, a step that comes from the Windows timer, so a "-45%" on an untouched endpoint such as `/api/stats` is that step, not a gain. Treat anything inside that band as "no change".
- **Local is not production:** `next start` serves HTTP/1.1 with gzip from this laptop. Vercel serves HTTP/2-3 with Brotli from its CDN, and the functions talk to Neon over a network. The byte counts, request counts and round-trip counts carry over; the millisecond values do not, only their direction.
- PGlite is single-threaded and slower than Postgres on big scans, so endpoint times here overstate heavy queries. The "added DB latency" column delays every database round trip by about 16 ms (a 5 ms timer on Windows) to show what round trips cost when the database is not next to the function.
- **Counted from code, not measured:** the expected effects under "Recommendations" (a region move, a one-query session lookup, a combined startup request).

## Before and after

### Pages, mobile profile (median of 3 cold loads): before -> after

| Page | FCP ms | LCP ms | TBT ms | CLS | Settled ms | Requests | Transfer KB | JS KB | Font KB |
|---|---|---|---|---|---|---|---|---|---|
| login | 1832 -> 1796 (-2%) | 9148 -> 5164 (-44%) | 522 -> 244 (-53%) | 0.001 -> 0.001 | 10474 -> 7116 (-32%) | 19 -> 29 | 1363 -> 759 (-44%) | 540 -> 427 (-21%) | 743 -> 252 (-66%) |
| dashboard | 1808 -> 1784 (-1%) | 8260 -> 4316 (-48%) | 1040 -> 474 (-54%) | 0.183 -> 0.052 | 11237 -> 7920 (-30%) | 23 -> 34 | 1498 -> 895 (-40%) | 540 -> 427 (-21%) | 743 -> 252 (-66%) |
| student-registry | 1784 -> 1792 (0%) | 9400 -> 7008 (-25%) | 605 -> 246 (-59%) | 0.290 -> 0.284 | 11322 -> 7562 (-33%) | 26 -> 35 | 1528 -> 877 (-43%) | 540 -> 381 (-30%) | 743 -> 252 (-66%) |
| grade-entry | 1792 -> 1780 (-1%) | 8236 -> 4304 (-48%) | 707 -> 388 (-45%) | 0.084 -> 0.084 | 11239 -> 6564 (-42%) | 22 -> 30 | 1510 -> 777 (-49%) | 540 -> 298 (-45%) | 743 -> 252 (-66%) |
| exam-records | 1788 -> 1796 (0%) | 9320 -> 6616 (-29%) | 1100 -> 469 (-57%) | 0.122 -> 0.122 | 12352 -> 7857 (-36%) | 23 -> 32 | 1511 -> 815 (-46%) | 540 -> 335 (-38%) | 743 -> 252 (-66%) |
| grade-records | 1792 -> 1772 (-1%) | 9408 -> 6604 (-30%) | 518 -> 198 (-62%) | 0.270 -> 0.251 | 11244 -> 7147 (-36%) | 23 -> 32 | 1508 -> 809 (-46%) | 540 -> 332 (-39%) | 743 -> 252 (-66%) |
| opportunities | 1784 -> 1808 (1%) | 9604 -> 6884 (-28%) | 793 -> 259 (-67%) | 0.399 -> 0.594 | 11526 -> 7813 (-32%) | 26 -> 35 | 1540 -> 855 (-44%) | 540 -> 345 (-36%) | 743 -> 252 (-66%) |
| follow-up-calls | 1824 -> 1784 (-2%) | 8340 -> 6840 (-18%) | 687 -> 219 (-68%) | 0.090 -> 0.090 | 11289 -> 7289 (-35%) | 21 -> 31 | 1495 -> 834 (-44%) | 540 -> 370 (-32%) | 743 -> 252 (-66%) |
| logs | 1816 -> 1788 (-2%) | 9948 -> 6820 (-31%) | 526 -> 212 (-60%) | 0.187 -> 0.160 | 11219 -> 6614 (-41%) | 22 -> 30 | 1505 -> 794 (-47%) | 540 -> 320 (-41%) | 743 -> 252 (-66%) |

### Pages, desktop profile (median of 3 cold loads): before -> after

| Page | FCP ms | LCP ms | TBT ms | CLS | Settled ms | Requests | Transfer KB | JS KB | Font KB |
|---|---|---|---|---|---|---|---|---|---|
| login | 92 -> 92 (0%) | 340 -> 256 (-25%) | 14 -> 0 (-100%) | 0.000 -> 0.000 | 305 -> 218 (-29%) | 19 -> 30 | 1363 -> 760 (-44%) | 540 -> 427 (-21%) | 743 -> 252 (-66%) |
| dashboard | 84 -> 84 (0%) | 412 -> 272 (-34%) | 19 -> 0 (-100%) | 0.206 -> 0.008 | 367 -> 358 (-2%) | 23 -> 34 | 1498 -> 895 (-40%) | 540 -> 427 (-21%) | 743 -> 252 (-66%) |
| student-registry | 84 -> 80 (-5%) | 504 -> 444 (-12%) | 16 -> 0 (-100%) | 0.106 -> 0.014 | 493 -> 363 (-26%) | 26 -> 35 | 1528 -> 877 (-43%) | 540 -> 381 (-30%) | 743 -> 252 (-66%) |
| grade-entry | 84 -> 84 (0%) | 380 -> 284 (-25%) | 12 -> 0 (-100%) | 0.069 -> 0.000 | 374 -> 274 (-27%) | 22 -> 30 | 1510 -> 777 (-49%) | 540 -> 298 (-45%) | 743 -> 252 (-66%) |
| exam-records | 80 -> 76 (-5%) | 416 -> 288 (-31%) | 67 -> 11 (-84%) | 0.084 -> 0.012 | 626 -> 578 (-8%) | 23 -> 32 | 1512 -> 816 (-46%) | 540 -> 335 (-38%) | 743 -> 252 (-66%) |
| grade-records | 88 -> 72 (-18%) | 904 -> 760 (-16%) | 11 -> 0 (-100%) | 0.077 -> 0.004 | 1026 -> 670 (-35%) | 23 -> 32 | 1508 -> 809 (-46%) | 540 -> 332 (-39%) | 743 -> 252 (-66%) |
| opportunities | 88 -> 80 (-9%) | 472 -> 436 (-8%) | 15 -> 0 (-100%) | 0.695 -> 0.408 | 556 -> 525 (-6%) | 26 -> 35 | 1540 -> 855 (-44%) | 540 -> 345 (-36%) | 743 -> 252 (-66%) |
| follow-up-calls | 100 -> 88 (-12%) | 348 -> 336 (-3%) | 13 -> 0 (-100%) | 0.060 -> 0.000 | 333 -> 283 (-15%) | 21 -> 31 | 1495 -> 834 (-44%) | 540 -> 370 (-32%) | 743 -> 252 (-66%) |
| logs | 92 -> 84 (-9%) | 676 -> 400 (-41%) | 22 -> 0 (-100%) | 0.073 -> 0.000 | 611 -> 340 (-44%) | 22 -> 30 | 1505 -> 794 (-47%) | 540 -> 320 (-41%) | 743 -> 252 (-66%) |

### Endpoints: before -> after

| Endpoint | DB round trips | p50 ms | p95 ms | p50 ms with added DB latency |
|---|---|---|---|---|
| `/api/auth/session` | 4 -> 2 | 15.3 -> 15.9 (4%) | 21.6 -> 17.6 (-19%) | 77 -> 47 (-39%) |
| `/api/bootstrap` | 11 -> 11 | 31 -> 28.4 (-8%) | 35.8 -> 34.4 (-4%) | 77 -> 78.6 (2%) |
| `/api/sync/version` | 3 -> 3 | 15 -> 15.8 (5%) | 17.4 -> 23.9 (37%) | 61.8 -> 62.9 (2%) |
| `/api/stats` | 9 -> 9 | 29 -> 15.9 (-45%) | 33.1 -> 18.9 (-43%) | 156.3 -> 158.4 (1%) |
| `/api/stats/alerts` | 10 -> 10 | 30.9 -> 30.5 (-1%) | 33.5 -> 33 (-1%) | 76.8 -> 79.3 (3%) |
| `/api/stats/trend?range=month` | 7 -> 7 | 28.5 -> 15.8 (-45%) | 34 -> 29.3 (-14%) | 60.7 -> 63.3 (4%) |
| `/api/course-chapters?page=1&pageSize=500` | 6 -> 6 | 15.4 -> 15.9 (3%) | 17 -> 23.9 (41%) | 76.2 -> 78.5 (3%) |
| `/api/students?opportunityMode=1&page=1&pageSize=10` | 10 -> 10 | 30.8 -> 30.1 (-2%) | 36.4 -> 33.3 (-9%) | 171.8 -> 173.2 (1%) |
| `/api/students/stats` | 7 -> 7 | 29.9 -> 16.4 (-45%) | 33.9 -> 31.1 (-8%) | 62.2 -> 63.1 (1%) |
| `/api/students/filter-options` | 3 -> 3 | 22.8 -> 16.9 (-26%) | 31.1 -> 30.7 (-1%) | 62.3 -> 63 (1%) |
| `/api/grades?groupBy=student&statusFilter=all&page=1&pageSize=10` | 12 -> 12 | 280.7 -> 254.2 (-9%) | 323.4 -> 278.8 (-14%) | 367.9 -> 335.7 (-9%) |
| `/api/grades/stats` | 7 -> 5 | 548.5 -> 136.5 (-75%) | 676.6 -> 147 (-78%) | 605.1 -> 199 (-67%) |
| `/api/exams?page=1&pageSize=10` | 5 -> 5 | 15.3 -> 15.4 (1%) | 23 -> 17.7 (-23%) | 77.2 -> 78.5 (2%) |
| `/api/exams/stats?examIds=<10 ids>` | 7 -> 7 | 78 -> 77.6 (-1%) | 118.6 -> 85.4 (-28%) | 168.6 -> 158.7 (-6%) |
| `/api/opportunity-logs?page=1&pageSize=20` | 6 -> 6 | 15.9 -> 15.6 (-2%) | 32.9 -> 21.4 (-35%) | 77.8 -> 79.4 (2%) |
| `/api/opportunities/stats` | 27 -> 27 | 73.6 -> 61.7 (-16%) | 86.3 -> 68.5 (-21%) | 187.4 -> 111 (-41%) |
| `/api/opportunities/bulk-targets?actionType=add&...` | 8 -> 8 | 44 -> 35.5 (-19%) | 49.8 -> 45.2 (-9%) | 155.1 -> 142.4 (-8%) |
| `/api/logs?page=1&pageSize=20` | 7 -> 6 | 175.3 -> 65.3 (-63%) | 209.4 -> 78 (-63%) | 203.2 -> 110.2 (-46%) |

### Build output

| | Before | After |
|---|---|---|
| JavaScript downloaded by the login screen (gzip, measured) | 540 KB | 427 KB: 231 KB for the screen itself, the rest is the dashboard preloaded in the background |
| JavaScript downloaded by a signed-in page (gzip, measured) | 540 KB on every page | 298-427 KB, by page |
| JavaScript in the build, all chunks | 12 files, 2,048,650 B (582,363 gzip) | 60 files, 2,958,658 B (909,959 gzip) |
| CSS in the build | 3 files, 479,607 B | 3 files, 479,652 B; the two component files are byte-identical to before |
| Fonts | 3 TTF in `public/`, 1,666,464 B, revalidated on every visit | 3 WOFF2 under `/_next/static/media`, 302,472 B, `immutable` |
| Fonts downloaded on a first visit (Cairo + Inter, measured) | 743 KB | 252 KB |

The build as a whole holds more JavaScript than before: code shared by several pages is repeated in their chunks by the bundler. Someone who opens all 15 pages in one sitting downloads more in total than before; someone who opens two or three downloads much less, and nobody waits for all of it before the first page.

## What was applied

| Commit | Change | Measured effect |
|---|---|---|
| `91aa75d` | Measurement scripts and the first baseline | - |
| `cfed1a9` | Each of the 15 pages is its own chunk, loaded when opened and preloaded when its link gets the pointer or focus | JavaScript on first load 540 KB to 298-427 KB; TBT down |
| `cdfbe33` | `/api/auth/session` renews the cookie from the account row it already read | 4 round trips to 2; -39% with added latency |
| `f4f130b` | `/api/opportunities/stats` reads its three groups of counts together | -41% with added latency (27 round trips, now overlapping) |
| `dc0ef25` | `/api/grades/stats`: the database decides who has an entered grade (same rule as `isGradeEnteredUnified`, with a new test) instead of loading every grade | p50 549 ms to 137 ms; 7 round trips to 5 |
| `233c942` | Students page stops re-asking for the location options when the list in memory changes | 9 API requests on open to 8, and one fewer after every list page |
| `9871126` | Fonts: TTF in `public/` to WOFF2 bundled through the stylesheet (lossless) | 1,666 KB to 602 KB on disk; hashed, `immutable` |
| `96ef6c8` | Fonts hold only the characters their `unicode-range` covers | 602 KB to 302 KB on disk; 743 KB to 252 KB on a first visit |
| `b6c8a61` | `/api/logs`: sections and users grouped by the database instead of an in-memory `distinct` over every log row | p50 175 ms to 65 ms; 7 round trips to 6 |
| `e7fe233` | Dashboard reuses alert numbers younger than 30 s instead of asking again right after the sidebar | removes a second `/api/stats/alerts` the split had introduced |
| `463d2c9` | Upstash rate-limit call gets a 3 s deadline, then falls back to the database count | not measured (Upstash is not configured locally) |
| `deadea1` | Stylesheets imported once, from one ordered list, instead of from each component as well | CSS back to 3 files (it had become 19 render-blocking files after the split) |
| `3fe724a` | The opening page's chunk downloads during the session check, not after it | removes a wait the split had introduced (desktop dashboard settled 567 ms to 358 ms) |

Checks were run on the cumulative tree, not once per commit in isolation: typecheck, lint, the full test suite and a build after the first five changes together, then again after each later step (fonts, font subset + logs, alerts + Upstash, stylesheet list, page preload).

### Visual check

The login screen and all 15 pages were captured at 1366x900 and 412x823, as the admin, on the before build and on the final build, running side by side against the same database, and compared pixel by pixel after a forced repaint. **29 of the 32 captures are identical.** The three that differ:

- Dashboard at desktop width: 158 pixels in one 14-pixel band, the colour fringe of anti-aliased text. Positions, sizes and computed font styles of every element on that page are identical in both builds.
- The logs page, both widths: about 400 pixels, the clock times of the sign-in rows that the captures themselves add to the log.

Two captures of the same build are pixel-identical, so the comparison is not noisy. An earlier attempt at the page split did change pixels (the stylesheet order moved) and was reworked until it did not; that is why the styles stay in one ordered list.

The fonts were recompressed and subset, not redrawn: same outlines, axes and layout features, limited to the characters each `@font-face` already declared in `unicode-range`.

## What was skipped, and why

| Step | Decision |
|---|---|
| 3 Rendering mode | Skipped. The app is one client-rendered page behind a login; its shell is already prerendered as static. ISR and revalidation were ruled out by the brief. |
| 4 Code splitting | Applied per page. **Not** applied inside pages: the dashboard still imports its nine windows (calls, leaves, grace periods, closures, ...) and keeps them mounted, so it downloads 427 KB. Recommendation 5. |
| 5 Unused dependencies | Nothing to remove: all 21 runtime dependencies are imported somewhere (checked by search, not with depcheck). No moment/lodash-style heavy library. |
| 6 Third-party scripts | Not applicable: there are none (the CSP allows only `'self'`). |
| 7 Fonts | Already self-hosted with `font-display: swap`. Applied: WOFF2, subset, hashed immutable URL. Not added: a `<link rel="preload">`. Text paints at once in the fallback font, so the font does not hold LCP back, and a preload would compete with the JavaScript on a slow link. |
| 8-9 Images | Not applicable: the repo has no raster image, only a 2 KB SVG logo. Nothing to convert to WebP and nothing to lazy-load. `unoptimized` and Vercel image optimization were not touched. |
| 10 Skeletons | The existing loading card is reused while a page's chunk downloads. The layout shift it causes was measured but not changed (visible design): recommendation 4. |
| 11 Debounce | Already done: `use-debounced-value` and `use-latest-request` are used by the list pages. |
| 12 Duplicate requests | Two fixed (students location options, dashboard alerts). No others in the captured request lists of the nine measured pages. |
| 13 Parallel requests | One fixed (opportunity stats). Bootstrap, alerts and the list routes already read in parallel. |
| 14 Optimistic UI | Not changed. Grade entry already saves optimistically with an offline outbox; extending that to other writes changes behaviour and needs a decision per screen. |
| 15 Virtualized lists | Not needed: lists are paged by the server, 10-20 rows a page. |
| 16 Re-renders | Not profiled per component, so nothing was changed. TBT fell because less JavaScript is parsed. |
| 17 AI streaming | Not applicable: no AI feature. |
| 18 Pagination | Already done on the list routes. |
| 19 Timeouts on external calls | Telegram calls already have one. Added for the Upstash rate-limit call. |
| 20 Background jobs | Recommendation only (a queue is new infrastructure). |
| 21 Redis caching | Not done: ruled out by the brief, and every response is per-user and `no-store`. |
| 22 N+1 | None found in the measured endpoints. The closest thing is the session lookup (account, then role: 2 round trips on every request): recommendation 2. |
| 23 Indexes | None added (the schema and migrations were off limits) and none recommended after checking the plans locally: recommendation 7. |
| 24 Select only needed columns | Applied where it mattered (grade coverage, logs). `/api/bootstrap` still sends whole exam rows (130 KB of JSON for 180 exams): recommendation 8. |
| 25 Connection pooling | Not touched (off limits). One shared Prisma client is already kept per function instance. |
| 26 Compression, 27 CDN | Vercel's job; not verified against production (no request was sent to the live site). |
| 28 Browser caching | `/_next/static` is immutable. The fonts were not (`max-age=0` in `public/`); fixed by bundling them. |
| 29 Region | Recommendation 1: could not be checked without `vercel` or Neon access. |
| 30 Load balancing | Not applicable on serverless. |
| 31 Tracing, 32 Real-user monitoring | Recommendations 9 and 10: both add either a vendor or function invocations. |

## Things that went up, so nothing is hidden

- **Requests on a cold first load:** 19 to 29-30 on the login screen, 21-26 to 30-35 on signed-in pages. All of the extra ones are hashed JavaScript chunks, cached for good after the first visit; API requests per page are the same or one fewer. On Vercel these count as edge requests.
- **Total JavaScript in the build** (table above).
- **The login screen also downloads the dashboard's code** in the background (the page that opens after signing in): 427 KB of JavaScript instead of the 231 KB the login screen needs by itself. It does not delay the login form, and it is still less than the 540 KB before.
- `/fonts/*.ttf` no longer exists. Nothing in this repo referenced those URLs except `globals.css`; anything outside it that linked to them (a bot page, an exported file) needs the new files.
- A new stylesheet must now be added to `src/components/teacher-pro/section-styles.ts`; importing it from its component alone would bring the 19-file split back.

## Recommendations that need your decision

Effects here are counted from the code and from the round-trip measurements, not measured end to end.

1. **Function region next to the database.** `vercel.json` sets no region, so the functions run in Vercel's default region unless the project settings say otherwise; neither that nor the Neon region could be checked from here. Every API request makes at least 3 database round trips (2 of them the session lookup), the students list 10, bootstrap 11, opportunity stats 27. With about 16 ms per round trip, `/api/stats` went from 29 ms to 156 ms in the test. If the two regions differ, moving the functions (not the database) is the largest server-side gain available, and it costs nothing.
2. **Session lookup in one round trip.** `findUserById` uses `include: { roleRef: true }`, which Prisma runs as two queries. One query (a raw `LEFT JOIN`, or Prisma's `relationJoins` preview feature in the generator block of `schema.prisma`, which is not a database change) saves one round trip on every API request. It touches the login code, the test mocks of `appUser.findUnique`, and possibly `schema.prisma`, so it is yours to decide.
3. **One request at startup instead of two.** The app asks `/api/auth/session`, waits, then asks `/api/bootstrap`, which checks the same session again. Returning the account from `/api/bootstrap` (and renewing the cookie there) removes one request and one full network round trip from every app open: about 0.56 s on the slow-mobile profile, and one function invocation less. It changes the store's startup and the tests that pin it (`test-read-loading`, `test-bootstrap-behavior`).
4. **Layout shift from the loading card.** `{dbLoading && <LoadingState />}` sits above the page and is removed when bootstrap arrives, so whatever is already drawn below it jumps up. Measured CLS did not improve in any reliable way: it depends on whether the page's code or the bootstrap answer arrives first, and the opportunities page still measured 0.41 (desktop) and 0.59 (mobile). Google's "good" limit is 0.1. Showing the card in place of the page, or keeping its height reserved, fixes it, but it is a visible change.
5. **Dashboard windows on first open.** The dashboard's nine windows are imported and mounted up front, including the whole calls workspace. Loading each when it is first opened would bring the dashboard's 427 KB of JavaScript close to the lightest pages (about 300 KB). Each window keeps state while closed, so each one needs a look.
6. **`/api/stats` in one statement.** It opens a repeatable-read transaction and runs four counts one after another: 9 round trips. One `groupBy` on `status` is a single statement (one snapshot by definition) and 3 round trips. `test-dashboard-behavior.mjs` asserts the transaction and the four counts on purpose, so it was left alone.
7. **Indexes.**
   None. The candidates were checked with `EXPLAIN (ANALYZE)` on the local database (same migrations, 60,000 audit rows, 90,000 grades): the log filters already use `AuditLog_userName_idx`, `AuditLog_time_idx` and the `(module, action, time)` index; a composite `("userName", "time" DESC)` index took the newest-20-of-one-user query from 0.5 ms to 0.1 ms, which is not worth an index; and grouping all log rows by user is a 20 ms sequential scan with or without it. Real Postgres with the real data distribution may differ: if `/api/logs` or `/api/grades` shows up slow in Neon's query statistics, start from `EXPLAIN ANALYZE` of that query there.
8. **Smaller bootstrap.** `/api/bootstrap` returns every exam with all its columns and course links on every app open and on every "core" refresh. Trimming it needs a field-by-field check of what the pages read from the store.
9. **Real-user Web Vitals without a paid add-on.** The `web-vitals` package can post to an API route of your own, but every page view then costs one more function invocation. Vercel Speed Insights is the paid alternative. Neither was added.
10. **Tracing.** `instrumentation.ts` with OpenTelemetry, logging only requests slower than a threshold, would show slow queries in production. It adds log volume and usually a vendor, so it is a decision, not a default.
11. **Grades list.** `/api/grades?groupBy=student` is now the heaviest request a page sends on open (254 ms here): six group-by scans of the grades table, two of them identical for the default filter. Worth an `EXPLAIN ANALYZE` on real Postgres before changing anything.

## State of the checks

Run in the worktree on Node 24.18 / npm 11.16 (CI uses Node 22), at `3fe724a`, the last code commit:

| Command (what CI runs, plus the build) | Result |
|---|---|
| `npm ci --legacy-peer-deps` | OK (npm needed `--script-shell` set to Git Bash on Windows for the `postinstall` script; nothing in the repo was changed for it) |
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 22 warnings (the same 22 as on `origin/main`) |
| `npm test` | pass, 132/132 commands (one of them new: `scripts/test-grade-entered-where.cjs`) |
| `npm run build:app` | pass |

`vercel-build` was not run (it runs migrations). `package-lock.json` is unchanged; `package.json` changed only to add the new test to `test:grade-records-behavior`. `prisma/schema.prisma`, the migrations, `vercel.json`, `next.config.ts` and `src/lib/db.ts` are untouched. No `.env*` file, database file or tool dependency is committed.

## Not verified

- Nothing was measured on Vercel or against Neon. Production TTFB, Brotli, CDN caching and cold starts are unverified.
- No Lighthouse score (Lighthouse is not installed); the lab metrics come from Playwright + CDP.
- Signed-in pages were exercised only as far as opening each one as the admin on synthetic data. Writes (saving grades, registering students, the calls workspace, exports) were not exercised by hand in the browser; the repo's test suite covers their logic.
- Dark mode and the non-admin roles were not captured.
- The Upstash timeout path was not exercised (Upstash is not configured locally); it reuses the existing failure path.

## Running the measurements again

```
# tools live outside the repo: @electric-sql/pglite, @electric-sql/pglite-socket, playwright-core in <tools>
NODE_PATH=<tools>/node_modules PERF_ADMIN_PASSWORD=<a test password> node perf/db-server.cjs --port 54871
# .env.local (never committed):
#   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54871/postgres?sslmode=disable"
#   TEACHERPRO_AUTH_SECRET="<any local value>"
npm run build:app && npx next start -p 3187
PERF_ADMIN_PASSWORD=... node perf/measure-api.cjs --samples 30 --out api.json
PERF_ADMIN_PASSWORD=... node perf/measure-api.cjs --samples 10 --latency 5 --out api-latency.json
NODE_PATH=<tools>/node_modules CHROME_PATH=<chrome.exe> PERF_ADMIN_PASSWORD=... node perf/measure-pages.cjs --profile mobile --out pages-mobile.json
NODE_PATH=<tools>/node_modules CHROME_PATH=<chrome.exe> PERF_ADMIN_PASSWORD=... node perf/measure-pages.cjs --profile desktop --out pages-desktop.json
```
