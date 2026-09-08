# P2 implementation and historical reconciliation

Based on P1 `b0fed26`, production snapshot reviewed on 2026-09-08. No student names, passwords, connection strings, or API tokens belong in this document.

## Delivered

| Audit | Change | Validation / boundary |
| --- | --- | --- |
| F10 | One numeric parser rejects null, blank, undefined and booleans; numeric zero remains valid. Removed the unused server classifier and its helper chain. | Behavior tests cover missing final-exam marks versus a real zero. |
| F11 | Shared historical-settlement exclusions, structured settled-grade IDs, read-only effective-impact annotations on grade listings/filters/exports, and settlement-aware student profiles. Preserved ledger timestamps in the client. | Educational scores remain stored. Old inferred reactivation links retain legacy treatment unless explicitly superseded by a reviewed settlement. Profiles distinguish classification from recorded opportunity movements. |
| F12 | Exam creation timestamp with provenance, fixed per-course chapter associations, and an assignment trigger for future exam/course links. Reports and engine use explicit associations; structured chapter transitions use grade IDs rather than a same-day cutoff. | 61 of 62 historical exam/course associations assigned from title/report evidence. One remains explicitly unknown because enforcing the inferred chapter changes 23 balances. Historical first-grade evidence is labeled as evidence, not an invented creation timestamp. |
| F17 | Signed sessions carry a database revision. Password/active-state changes revoke old tokens via a database trigger; logout revokes every session of that account. Backup cannot restore revisions backwards. | Signed-token revocation and real PostgreSQL credential trigger tests; P1 backup round-trip tests retained. Existing pre-version tokens work only while revision remains zero. |
| F22 | Preview fingerprints include student location, exam site, grade notes/exclusions and chapter associations. | Site changes invalidate the token. |
| F23 | Chapter activation writes a v2 settlement with the actual archived balance and settled grade IDs. | A→B→A preserves balances; late-entered and same-day grades are not silently overwritten by a prior reset. |
| F24 | Exam and dashboard GET handlers no longer execute accounting mutations. A permission-gated POST worker settles due exams while an authorized operator has the app open; authenticated daily server cron remains independent. | Production Vercel plan is Hobby. Background settlement with no authorized client open retains daily cadence; minute-level unattended execution is not claimed. No paid service or plan upgrade introduced. |
| F25 | Removed 38 Store mutation/export methods and their declarations, unreachable private helper chains, and two unreachable components. | Type checking, complete regression suite, production build. Accounts/roles actions and live logging remain. |
| F27 | Historical GradeEntryMissingNote and operational historical columns remain recoverable. Empty DemoCopy/Site tables have a guarded post-deployment contract, with schema evidence written to AuditLog. | No CASCADE; nonempty tables or external dependencies abort the contract transaction. Historical notes and neutralized dismissal fields are preserved. |
| F28 | Six historical write-repair entrypoints now refuse execution; exact original text retained under docs/retired-maintenance. Active protected-grade, zero-balance and call-history maintenance tools remain. | P2 balance reconciliation is transactional, audited, fingerprint-guarded and versioned. |
| F29 | Added behavioral/database tests for null marks, settlements, chapter cycling, late/same-day grades, session revocation, preview inputs, concurrent login attempts and deployment policy. | Actual PostgreSQL semantics via PGlite; existing complete regression suite retained. |
| F30 | Public login no longer runs administrator seeding. Fresh deployments use an explicit bootstrap that skips existing accounts. Login attempts are atomically reserved in PostgreSQL across serverless instances; no in-memory fallback. Weak-password flag reaches the UI. | Twenty concurrent attempts admit only five; daily maintenance expires buckets. Database errors fail login closed. |
| F31 | Exact bot POST routes accept their own validated server token without browser Origin. Opportunity response includes status, dismissal reason, active chapter and current-chapter movement metadata. | Browser-authenticated endpoints still require normal CSRF checks; no messages sent to anyone. |
| F32 | Pending migrations require a checksum-bound expand/data-reconciliation policy. Build rejects destructive/contract changes and historical replay on populated databases. Current schema is checked after deployment migrations. | Empty-table retirement is a separate post-READY contract, never part of the Vercel build. |
| F33 | Preserve 60 grades outside current enrollment scope and 12 numeric grades overlapping leaves for eight students. A post-deployment audit records their IDs and disposition. | A transfer or later leave can explain historical overlap; modification timestamps alone cannot prove an erroneous score. No grades deleted or pending smart notes auto-promoted. |

## Protecting the 13 historical balance mismatches without changing balances

The owner's final instruction prohibits changing any of the 2,993 nonarchived students' balances. **No balance correction is applied, including the previously discussed 13 cases.**

The migration appends thirteen v2 protection entries at each student's existing balance, with zero applied delta. Original grades and ledger entries remain intact. Each protection entry settles the already-present grade IDs, preventing a later recalculation from replaying that history against the current balance. Before/after balances are identical.

A fingerprint covers each affected student's full row, grades, ledger, leaves, notes, exams and chapter links. Changed inputs abort before any protection entry is committed. An additional transaction-level comparison verifies that **every student's balance, base balance, status and course remain unchanged**, including archived students. The migration contains no Student UPDATE. Absent reviewed IDs on a fresh database are a no-op.

A full replay with these protections and chapter metadata checks 2,993 nonarchived students: **zero balance differences and zero status differences**. Seventy-nine pre-existing dismissal-description-only differences are deliberately not rewritten.

## The five unavailable migration texts

Original SQL was not found in the repository history. We do not fabricate originals, edit their production checksums, or pretend their provenance is recovered. `legacy-migration-manifest.json` preserves their exact recorded identity and checksum. Current behavior is established by forward migrations, tested fresh-database reconstruction, a current schema contract, and the migration-history guard. The runtime no longer depends on retrieving those missing texts to reconstruct its current schema.

## One unresolved historical chapter association

Exam `cmt1hg0sx0000l104pb1asisz` (الامتحان العاشر - الصيفية الثانية), course `c_mqry9o7z_78jc7b`, retains `chapterId = null`, `chapterSource = ambiguous-accounting-history`. Historical report evidence places it in the earlier chapter, while 23 current balances still incorporate its penalties without a corresponding chapter settlement. Treating the inference as certain would silently increase those balances. Existing accounting remains intact, with evidence-based report fallback. Future exam/course links are explicitly assigned at creation.

## Release gates and contract

1. `npm run test:side-effects`, `npm run build:app`, modified-file lint/type checking.
2. Push main; Vercel applies only the three new forward migrations and verifies schema/history.
3. Confirm deployment READY and production alias at the same commit.
4. Run `scripts/contracts/retire-empty-schema.sql` and `scripts/contracts/review-legacy-grade-history.sql` in a transaction. These scripts are idempotent or refuse conflicting/nonempty state.
5. Verify thirteen zero-delta protection/audit records, zero balance changes, grade/student counts unchanged, exam projection intact, and retired tables absent.

Rollback: code can be rolled back without dropping the new fields/tables. Do not blindly reverse protection entries; their AuditLog snapshots support a new reviewed compensating operation if necessary. Do not restore old executable repair scripts or modify applied migration SQL.
