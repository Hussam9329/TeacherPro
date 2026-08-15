-- Make cumulative exams follow the same discount/opportunity rules as daily exams.
-- Existing cumulative exams used dismissalGrade as their threshold, so keep that
-- value by moving it to discountMark when discountMark was previously disabled.
UPDATE "Exam"
SET
  "discountMark" = CASE
    WHEN "dismissalGrade" IS NOT NULL AND COALESCE("discountMark", 0) = 0 THEN "dismissalGrade"
    ELSE "discountMark"
  END,
  "opportunitiesPenalty" = CASE
    WHEN "opportunitiesPenalty" IS NULL
      OR trim("opportunitiesPenalty") = ''
      OR "opportunitiesPenalty" = 'فصل مؤقت'
    THEN '1'
    ELSE "opportunitiesPenalty"
  END,
  "dismissalGrade" = NULL
WHERE "type" = 'تراكمي';
