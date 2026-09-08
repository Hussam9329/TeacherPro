# Startup loading incident — 2026-09-08

Baseline: `92375cb`.

## Evidence

Authenticated production student, student statistics, course, exam and sync reads
returned HTTP 200 and the expected student counts. The registry eventually
rendered its rows; the data was present.

The startup `/api/users` request returned **23,545,718 bytes**, including **56,021
user audit-log entries** through `safeUserSelect().logs`. The same account metadata
without those unused log relations measured **1,481 bytes**. The shared startup
loader waited for a second session check followed by five resource HTTP requests.
Its GET requests had no deadline, so a stalled response or body could leave loading
visible indefinitely. The large log collection was an existing read path that
previous release smoke checks did not exercise; this investigation does not prove
that P3 introduced that query.

## Fix

- Stop selecting full audit history in account responses. Existing log/history
  tables and the dedicated paginated log routes are unchanged.
- Load only permission-filtered startup metadata through `/api/bootstrap`, with
  one HTTP request and one server session lookup. Preserve the existing resource
  permissions, safe account projections, chapter links and exam mutation tokens.
- Keep Student, Grade, opportunity history and other growing tables out of startup.
- Select only chapter-link identifiers and state flags at startup, excluding the
  nested archive JSON. Dedicated chapter/archive reads retain their full history.
- Bound shared GET requests and response-body parsing to 30 seconds, retaining
  caller cancellation and never retrying a mutation. Session restoration uses
  the same bounded reader.
- Preserve the current authenticated account and roles when the response omits
  account data for a user without permission to list accounts.
- Show a read-only retry button when startup fails.

## Validation

- Behavioral checks cover stalled fetches and JSON bodies, cancelled/successful
  reads, one-request startup and unauthorized responses.
- Bootstrap behavioral checks cover one auth lookup, narrow permissions, exact
  exam tokens, omission of passwords/session revisions/audit logs, and no Student
  or Grade reads or writes.
- Full `npm run test:side-effects` suite passed, including the new loading tests.
- Production build with a dummy database URL passed.
- No Prisma schema changes, migrations or balance repair commands are included.

Production verification of `d4f5e6b` confirmed the READY deployment and matching
alias, HTTP 200 for startup/users/students/grades, a 1,481-byte account response,
and identical IDs, balances, statuses and courses across 2,997 stored student rows
(including archived rows). The first bootstrap response was 633,413 bytes;
most of its remaining size came from chapter-link archive JSON, now excluded.
