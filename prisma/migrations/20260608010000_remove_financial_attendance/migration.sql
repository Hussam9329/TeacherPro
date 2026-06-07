-- Remove all financial, installment, attendance, and accounting-review data from the schema.
ALTER TABLE "Student" DROP COLUMN IF EXISTS "receiptNo";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "codeSequence";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "totalAmount";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "paidAmount";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "installments";
ALTER TABLE "Student" DROP COLUMN IF EXISTS "accountingStart";

ALTER TABLE "Exam" DROP COLUMN IF EXISTS "attendanceClosed";
ALTER TABLE "Exam" DROP COLUMN IF EXISTS "attendance";

ALTER TABLE "Grade" DROP COLUMN IF EXISTS "accountingChecked";
