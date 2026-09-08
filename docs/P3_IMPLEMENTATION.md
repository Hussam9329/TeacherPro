# P3 — unused code and dependency cleanup

Date: 2026-09-08. Baseline: `aade360` (P2). Original audit finding: F26.

## Data preservation

This release contains no Prisma schema changes, migrations, balance repair commands,
or production data writes. The owner's instruction remains: preserve all existing
student balances, including the 13 histories protected in P2 with zero-delta ledger
entries. P3 does not alter the academic engine or the explicit reactivation route.
Read-only before/after release checks compare student IDs, opportunities,
baseOpportunities, status and courseId, including archived students.

## Changes

- Removed 20 unused direct production dependencies after checking source imports,
  scripts and build/CSS configuration. The npm lock loses 55 package entries;
  retained package versions are unchanged. Some removed direct dependencies may
  remain transitively required by development tooling.
- Retained `pg` for database scripts, `sharp` for Next image handling, and
  `tailwindcss-animate` for the Tailwind configuration.
- Removed the stale `bun.lock`. Vercel explicitly installs through `npm ci` in
  `vercel.json`; `package-lock.json` is the single maintained dependency lock.
- Resolved all 15 TypeScript unused diagnostics: removed 14 unused local/import
  bindings and explicitly marked the compatibility-only `_baghdadMode` parameter.
  Its positional signature is preserved; the actual mode still comes from course
  configuration. Exam entry reasons remain visible through the existing details
  rendering; only an unused card destructuring was removed.
- Removed `src/lib/log-clear-backups.ts`, an unreferenced old raw-SQL helper.
  Existing database tables, stored backups and history are untouched.
- Removed the unreachable dismissed-to-active branch from academic recalculation.
  The engine preserves dismissed status. Pending dismissed grades are still handled
  by the existing explicit `students/status-action` reactivation route.
- Kept `admin-seed.ts`: although absent from the browser/server route graph, the
  deployment bootstrap script uses it for an empty installation.
- Enabled `noUnusedLocals` and `noUnusedParameters` in TypeScript so the production
  build rejects new unused declarations. Added `npm run typecheck` for local use.
- Extended the existing reactivation centralization check to guard the sole pending
  grade migration path. Existing behavioral tests verify dismissed status is
  preserved and explicit pending-grade reactivation remains idempotent.

Removed direct dependencies:

- `@radix-ui/react-accordion`
- `@radix-ui/react-aspect-ratio`
- `@radix-ui/react-avatar`
- `@radix-ui/react-collapsible`
- `@radix-ui/react-context-menu`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-hover-card`
- `@radix-ui/react-menubar`
- `@radix-ui/react-navigation-menu`
- `@radix-ui/react-popover`
- `@radix-ui/react-progress`
- `@radix-ui/react-slider`
- `@radix-ui/react-switch`
- `@radix-ui/react-toast`
- `@radix-ui/react-toggle`
- `@radix-ui/react-toggle-group`
- `@radix-ui/react-tooltip`
- `date-fns`
- `uuid`
- `zod`

## Validation

- Clean npm install from the revised lock, with lifecycle scripts suppressed locally.
- Prisma Client generated locally using a dummy database URL.
- `npm run test:side-effects`: passed, including academic, reactivation, P1 and P2
  behavioral tests and isolated PostgreSQL tests.
- `npm run build:app`: passed with a dummy database URL; no deployment migrations
  were executed locally.
- `npm run typecheck`: zero unused/type errors.
- ESLint on changed code: zero errors; six pre-existing warnings remain (four
  redundant suppression comments and two hook dependency warnings). Hook dependency
  behavior was preserved in this release.

## Existing limitations retained from P2

This cleanup does not change the daily unattended cron cadence, resolve the one
historically ambiguous exam chapter, rewrite legacy grades/reasons, or reconstruct
unavailable original migration SQL. See `P2_IMPLEMENTATION.md`. None of these is
permission to change historical student balances.
