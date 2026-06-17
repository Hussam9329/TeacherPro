-- Add a per-exam no-discount flag. When enabled, grades/absence do not create opportunity deductions or academic dismissal.
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "noDiscount" BOOLEAN NOT NULL DEFAULT false;
