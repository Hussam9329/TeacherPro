-- Additive: the kept part of «إحصائيات المكالمات»'s required number, only
-- the «المخصومين» with an entered grade (students with no grade yet are added
-- live). Rows written before it keep NULL and are counted again; no existing
-- value changes.
ALTER TABLE "CallExamTarget" ADD COLUMN IF NOT EXISTS "recorded" INTEGER;
