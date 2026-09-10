# Preserve dismissed students during bulk absence cancellation

Exam eight showed 1907 visible grade records before bulk absence cancellation. The cancellation deleted 371 absence rows, including 23 dismissed students. Subsequent entry created 135 numeric rows and 213 absence rows, leaving 1884 visible records. Numeric entries replaced students who already had absence records; the remaining difference was the 23 dismissed students excluded from bulk registration.

Bulk cancellation now selects only active students with non-protected absence records. The same predicate is used for selection and deletion, and only the selected grade IDs are deleted. Recalculation receives only those active student IDs. Dismissed, archived, and protected records remain intact. Incomplete deletion returns a conflict instead of claiming success.

The button count follows the same eligibility rule. Its confirmation describes the scope, and the entry sheet removes only the grade IDs acknowledged by the server. A compatibility fallback accepts acknowledged student IDs, never a blanket deletion of all cached absences.

The owner separately authorized restoring the 23 original exam-eight absence records. `scripts/contracts/restore-dismissed-exam-eight-absences.sql` restores missing rows from the original snapshot while preserving any newer grade. It checks that all targets are still dismissed and verifies that every Student field and the entire opportunity ledger remain unchanged. It does not call academic recalculation or modify balances/statuses. Completion and original restored rows are recorded under `restore_dismissed_exam8_20260910_v1` in AuditLog. This recovery is explicit and is never run by builds or migrations.

`npm run test:bulk-absence-clear` tests the real DELETE handler, cache reconciliation, and PostgreSQL-compatible recovery, including protected students, newer grades, atomic rollback, and repeated execution.
