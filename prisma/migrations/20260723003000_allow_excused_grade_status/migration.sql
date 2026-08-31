ALTER TABLE "Grade" DROP CONSTRAINT IF EXISTS "Grade_status_score_consistency";

ALTER TABLE "Grade"
  ADD CONSTRAINT "Grade_status_score_consistency"
  CHECK (
    "status" IN ('درجة', 'غائب', 'غش', 'مجاز', 'ضمن فترة السماح', 'قبل تسجيل الطالب')
    AND ("status" = 'درجة' OR "score" IS NULL)
  );
