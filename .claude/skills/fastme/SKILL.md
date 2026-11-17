---
name: fastme
description: FastMe — full performance audit and optimization for a web app (frontend, API, database, infrastructure), measured before and after. Use when the user says FastMe, /fastme, "سرّع التطبيق", "التطبيق بطيء", "راجع الأداء", or asks to make an app faster, reduce load time, fix slow pages, slow APIs or slow queries.
---

# FastMe — Performance audit & optimization

Goal: the app must feel fast so users don't leave. Measure first, apply only what fits
this project, verify nothing broke, then show a before/after comparison.

## Ground rules

- **Detect the stack first** (framework, router, ORM/DB, hosting, package manager) by reading
  `package.json` / lockfiles / config files. Every step below is conditional: apply it only if
  it fits this project. If a step doesn't apply or is already done, skip it and record why.
- **Small, separate changes.** One logical change per commit, run the build/lint/tests after
  each. Never trade correctness for speed. If a change breaks something, revert it.
- **Infrastructure steps are recommendations** (CDN, server region, load balancing, managed
  Redis, RUM vendor): write what to do and why; don't create paid accounts or change hosting
  without the user's approval.
- **No new heavy dependencies** unless the gain is clear; prefer what the stack already ships.
- Report to the user in their language (Arabic if they write in Arabic).

---

## Phase 0 — Baseline (before touching anything)

1. Record numbers and save them to `perf/baseline.md` (or the scratchpad if the repo shouldn't hold it):
   - Lighthouse (mobile) per key page: Performance score, LCP, INP/TBT, CLS, FCP, TTFB.
   - JS bundle size per route (build output / analyzer), total transferred bytes, request count.
   - Backend: p50/p95 time of the main API endpoints, slowest DB queries (log or `EXPLAIN ANALYZE`).
2. Repeat the key pages under **slow mobile + weak network** (Playwright/Lighthouse with
   4x CPU slowdown and Slow 4G throttling). Keep the exact settings for Phase 7.

## Phase 1 — Page load (frontend)

3. **Rendering mode per page:** static generation for content that rarely changes, SSR (or
   ISR/streaming SSR) for personalized or fresh data, client-only only where needed.
4. **Code splitting per route**; dynamic `import()` for heavy components (charts, editors, maps, modals).
5. **Remove unused dependencies** (e.g. `npx depcheck` / `knip`); replace heavy libs with
   lighter ones or native APIs when trivial (moment → date-fns/Intl, lodash → per-function).
6. **Defer non-essential third-party scripts** (analytics, chat widgets, pixels): `defer`/`async`,
   `next/script` `lazyOnload`/`afterInteractive`, or load on interaction.
7. **Self-host fonts** (e.g. `next/font` or local `@font-face`), load only the weights/subsets
   used, `font-display: swap`, preload the main one.
8. **Images as WebP/AVIF** with correct `width`/`height`, responsive `srcset`/`sizes`
   (or the framework's image component).
9. **Lazy-load images below the fold** (`loading="lazy"`); the LCP/hero image stays eager with
   `fetchpriority="high"`.
10. **Skeleton loading** on every screen that waits for data, matching the final layout (no CLS).

## Phase 2 — Interaction & smoothness

11. **Debounce** search and autocomplete inputs (~250–400 ms) and cancel stale requests (AbortController).
12. **Deduplicate API calls**: one shared fetch per resource (React Query/SWR/TanStack or a small
    in-flight cache), no double fetching on mount, no fetch waterfalls in effects.
13. **Run independent requests in parallel** (`Promise.all` / `Promise.allSettled`) on client and server.
14. **Optimistic UI** where the outcome is predictable (like, toggle, rename, delete, reorder):
    update immediately, roll back and show a clear error if the request fails.
15. **Virtualize long lists/tables** (e.g. 100+ rows) with `@tanstack/react-virtual` or equivalent.
16. **Prevent unnecessary re-renders**: stable props/keys, `memo`/`useMemo`/`useCallback` where
    profiling shows a cost, split contexts, keep state close to where it's used.
17. **Stream AI responses** (SSE / ReadableStream / SDK streaming) and render tokens as they
    arrive, with a stop button and error state, instead of waiting for the full reply.

## Phase 3 — API & backend

18. **Paginate API results** (cursor-based preferred; limit + offset acceptable), with a sane max page size.
19. **Timeouts on all external API calls** (e.g. `AbortSignal.timeout(…)`), plus limited retry with
    backoff where safe, and a graceful fallback.
20. **Move slow work to a background job queue** (emails, PDF/report generation, image processing,
    imports, AI batch work): BullMQ, Inngest, QStash, Vercel/Cloudflare queues, or DB-backed jobs.
    Return immediately and show progress/status.
21. **Redis caching** for frequently requested, rarely changing data, with TTLs and invalidation on
    write. If no Redis is available, use the platform cache / in-memory LRU and recommend Redis.

## Phase 4 — Database

22. **Fix N+1 queries**: use joins/`include`/`select` with relations, batch loading, or `IN (...)`.
23. **Add indexes** for frequent `WHERE` / `ORDER BY` / `JOIN` columns (check with `EXPLAIN`);
    add them through the project's migration system.
24. **Select only needed columns** (no `SELECT *` or full-row ORM loads for lists).
25. **Connection pooling** (PgBouncer/Supabase pooler/Prisma Accelerate/driver pool); one shared
    client instance, especially on serverless.

## Phase 5 — Delivery & infrastructure

26. **Brotli (preferred) or gzip** compression for text responses (often handled by the host/CDN — verify headers).
27. **Serve static files through a CDN.**
28. **Browser caching for static assets**: hashed filenames + `Cache-Control: public, max-age=31536000, immutable`;
    short/`no-cache` for HTML.
29. **App servers in the same region as the database** (check host + DB regions; recommend a move if they differ).
30. **Load balancing across multiple app instances** only if load requires it (recommendation + config).

## Phase 6 — Monitoring

31. **OpenTelemetry tracing** on the backend to catch slow requests and slow DB/external calls
    (export to whatever the project uses, or log spans above a threshold).
32. **Real User Monitoring**: report Core Web Vitals from real users (`web-vitals` → analytics
    endpoint, or the host's built-in analytics such as Vercel Speed Insights).

## Phase 7 — Verify & compare

33. Re-run exactly the Phase 0 measurements, including the slow-mobile + weak-network run.
34. **Before/after report** to the user:
    - Table: metric | before | after | change % (per page and per main endpoint).
    - What was applied (with commit refs), what was skipped and why.
    - Recommendations that need the user's action or approval (infra, paid services, region moves).
    - Save it as `perf/REPORT.md` and show the summary in chat.

When finished, push the branch and open a draft PR with the report in its description.
