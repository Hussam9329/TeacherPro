-- Add a dedicated academic-accounting flag for failing-but-not-deducted grades.
ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "academicAccountingChecked" BOOLEAN NOT NULL DEFAULT false;
