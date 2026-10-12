-- Additive: requests from the Correction app, kept by their idempotency key
-- so a retried request returns the stored response and never saves a grade
-- twice. A new table only; no existing row or column changes.
CREATE TABLE IF NOT EXISTS "CorrectionReceipt" (
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "request" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionReceipt_pkey" PRIMARY KEY ("key")
);
CREATE INDEX IF NOT EXISTS "CorrectionReceipt_studentId_examId_idx" ON "CorrectionReceipt"("studentId", "examId");
