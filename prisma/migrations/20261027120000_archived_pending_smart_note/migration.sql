-- «الطالب مؤرشف» in «مرماز برو»: a grade held on an archived student's file
-- until his restore. Only widens the allowed categories; no row changes.
-- One ALTER TABLE, so the table is never without the check.
ALTER TABLE "GradeSmartNote"
  DROP CONSTRAINT IF EXISTS "GradeSmartNote_category_check",
  ADD CONSTRAINT "GradeSmartNote_category_check" CHECK (
    "category" IN ('DISMISSED_PENDING', 'GRACE_SCORED', 'BEFORE_REGISTRATION_PENDING', 'LEAVE_PENDING', 'ARCHIVED_PENDING')
  );
