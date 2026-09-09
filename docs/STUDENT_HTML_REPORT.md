# Student opportunity report

The opportunities HTML export is a standalone student report. Selecting a name
opens its details immediately. One remaining-opportunities card precedes the
exam table: exam, exam date, grade, and effect on opportunities. The chapter and
chapter-start cards, status paragraph, registration/snapshot timestamps, and
opportunity-history section are omitted. Tables become labelled cards on phones;
search results stay in normal flow and the profile has one scrolling panel.

## Data and wording

- Retain the owner's explicit rule: an exam without a student grade appears as
  an absence in the grade cell; there is no separate result column. A numeric
  zero remains a grade. Include an absent exam even when it is referenced by another
  student log. This is a report rule, not a database write or a deduction.
- Show actual stored exam deductions/dismissals beside each exam. A score alone
  does not prove that opportunities were deducted. Use «لا يوجد خصم لهذا الامتحان»
  and «تم خصم فرصة لهذا الامتحان» for no deduction and one deduction. Larger
  deductions retain their actual count; saved zero is never treated as a deduction.
- Format displayed dates with `ar-EG-u-nu-latn` and the Baghdad time zone, using
  month names such as يونيو and يوليو.
- Show «تم منح الطالب فرصتين بسبب تعهده» beside the balance when the enrollment
  ledger proves a two-opportunity pledge grant, including historical settlements
  and manual pledges. Read this evidence before filtering exams to the chapter.
  The note describes the past grant and survives later deductions; the displayed
  remaining balance is still the database snapshot, never reset to two. Ordinary
  two-opportunity balances, deductions and maintenance confirmations do not
  establish a pledge. The note wraps inside the existing card on phones.
- Read the displayed current balance and status from the same `profile-log`
  database snapshot as the student's grades and history, overriding the earlier
  list response. This remains an offline snapshot; timestamps are not displayed.
- Describe resets and return balances as a new balance, not an addition. Status
  reactivation is a status event, not a second opportunity grant.
- Use saved `appliedAmount`, `balanceBefore`, and `balanceAfter` when present.
  Preserve zero. Do not reconstruct missing historical running balances, infer
  an opening balance from today's limit, or reconcile any student record.
- Keep movements with no reason in the shared data transformation. The HTML
  omits their table; other consumers retain their existing ledger data.
- Replace internal automatic/settlement wording and link markers with plain
  student language. Notes, phones and other private profile fields are excluded.
- Keep the existing active-chapter boundaries and chapter name in the exam
  heading. Omitting the history section does not change deduction scoping.

The profile endpoint adds three existing ledger fields to its read projection.
There is no schema change, migration, balance repair, or new write route.

## Verification

- Full existing side-effects suite, including HTML script execution, escaping,
  keyboard search, missing-detail handling and active-chapter boundaries.
- Added cases for missing-grade absence, saved zero amounts, reset versus grant,
  current balance from a fresh snapshot, missing reasons, private field exclusion
  and repeated sanitization.
- Simplification checks cover the four headers, omitted sections, single balance
  card, June/July dates at Baghdad midnight, zero grades and exact effect wording.
- Production build using a dummy database URL; ESLint on changed source files.
- Read-only sample profiles from the production database for report generation.
