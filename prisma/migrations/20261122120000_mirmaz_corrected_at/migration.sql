-- «مرماز برو»: when the corrector sent each paper and how long the correction
-- took, as Mirmaz Pro gives them. Two empty columns; no row changes.
ALTER TABLE "MirmazHold"
  ADD COLUMN IF NOT EXISTS "correctedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "correctionSeconds" INTEGER;
