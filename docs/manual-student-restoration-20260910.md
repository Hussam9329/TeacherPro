# Manual recovery of a dismissed student

Adding opportunities to one dismissed student now explicitly restores that student with the requested positive balance, up to the active chapter limit. The saved reason is «استعادة الطالب المفصول يدويا بسبب خطأ عفوي», with any additional reason retained. This operation requires both opportunity management and student edit permission. Other opportunity commands cannot implicitly restore dismissed or archived students.

Dismissed management has a separate «استعادة الطالب المفصول» button beside the pledge button. It asks for the balance and a required, editable reason. The existing pledge still grants two opportunities. Both manual recovery entry points use `restoreDismissedStudentManually` inside their serializable transaction; the new mode shares the status endpoint's status and mutation-token guards.

Recovery changes only the selected student, records the status transition and exact balance in the opportunity ledger, retains the previous dismissal reason and notes, and records the actor in the audit log. Existing grade rows remain intact. Pending grades follow the existing explicit-reactivation process: existing official grades win conflicts, and newly migrated scores remain excluded from academic penalties. All existing grade IDs are recorded as settled so later recalculation cannot spend the new balance on them again.

The engine reads a version-2 reactivation balance's explicit `balanceAfter`. Pledges and historical markers without that field retain the existing two-opportunity policy. New exams after recovery follow the existing zero-balance law. Invalid amounts, stale snapshots, archived students and repeated restoration requests return validation/conflict responses rather than creating duplicate grants.

No schema migration or production data repair is included. Deployment changes behavior for future user actions only. Tests exercise both real handlers against PostgreSQL-compatible migrations and replay stored recovery records through the academic engine, including rollback, permissions, existing-grade conflicts, balances of one/two/three, same-day settled grades, future penalties, and legacy pledges.
