# Student opportunity report

The opportunities HTML export is a standalone student report. Selecting a name
opens its details immediately. A compact summary precedes the chronological
opportunity history and exam results. Tables become labelled cards on phones;
search results stay in normal flow and the profile has one scrolling panel.

## Data and wording

- Retain the owner's explicit rule: an exam without a student grade appears as
  an absence. Include it even when the exam is already referenced by another
  student log. This is a report rule, not a database write or a deduction.
- Show actual stored exam deductions/dismissals beside each exam. A score alone
  does not prove that opportunities were deducted.
- Read the displayed current balance and status from the same `profile-log`
  database snapshot as the student's grades and history, overriding the earlier
  list response. Display when the snapshot was generated.
- Describe resets and return balances as a new balance, not an addition. Status
  reactivation is a status event, not a second opportunity grant.
- Use saved `appliedAmount`, `balanceBefore`, and `balanceAfter` when present.
  Preserve zero. Do not reconstruct missing historical running balances, infer
  an opening balance from today's limit, or reconcile any student record.
- Keep movements with no reason and explicitly describe missing information.
- Replace internal automatic/settlement wording and link markers with plain
  student language. Notes, phones and other private profile fields are excluded.
- Keep the existing active-chapter boundaries. Its `since` value is labelled as
  the start of opportunity accounting, not the first lesson or first exam.
  Unknown start dates stay unknown. The file is a dated snapshot, not live data.

The profile endpoint adds three existing ledger fields to its read projection.
There is no schema change, migration, balance repair, or new write route.

## Verification

- Full existing side-effects suite, including HTML script execution, escaping,
  keyboard search, missing-detail handling and active-chapter boundaries.
- Added cases for missing-grade absence, saved zero amounts, reset versus grant,
  current balance from a fresh snapshot, missing reasons, private field exclusion
  and repeated sanitization.
- Production build using a dummy database URL; ESLint on changed source files.
- Read-only sample profiles from the production database for report generation.
