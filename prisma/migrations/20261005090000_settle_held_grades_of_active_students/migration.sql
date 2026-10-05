-- A student who is not dismissed keeps no grade held from a dismissal
-- (GradeSmartNote category DISMISSED_PENDING). For active students only:
--   1. a held score with no grade for its exam becomes a grade with no
--      academic effect (the same row a return creates);
--   2. a held attempt that now has its grade is marked processed;
--   3. every other held attempt is deleted: its exam already has an official
--      grade, or its score is outside the exam's range.
-- Official grades, opportunities, dismissals and dismissed or archived
-- students are not touched. Re-running it changes nothing.
BEGIN;

INSERT INTO "Grade" (
  "id", "status", "score", "notes",
  "academicAccountingChecked", "academicEffectExcluded",
  "academicEffectExclusionReason", "academicEffectExclusionSource",
  "createdAt", "updatedAt", "studentId", "examId", "smartNoteId"
)
SELECT
  'held-' || n."id", 'درجة', n."score", 'درجة مؤجلة أثناء الفصل',
  false, true,
  'أُدخلت الدرجة أثناء فصل الطالب، وحُفظت بعد إعادة التفعيل للتوثيق فقط دون أي خصم أو فصل أو محاسبة أكاديمية.',
  'GradeSmartNote:DISMISSED_PENDING:' || n."id",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, n."studentId", n."examId", n."id"
FROM "GradeSmartNote" n
JOIN "Student" s ON s."id" = n."studentId" AND s."status" = 'نشط'
JOIN "Exam" e ON e."id" = n."examId"
WHERE n."category" = 'DISMISSED_PENDING'
  AND n."status" <> 'PROCESSED'
  AND n."score" IS NOT NULL
  AND n."score" BETWEEN 0 AND e."fullMark"
  AND NOT EXISTS (
    SELECT 1 FROM "Grade" g
    WHERE g."studentId" = n."studentId" AND g."examId" = n."examId"
  )
ON CONFLICT DO NOTHING;

UPDATE "GradeSmartNote" n
SET "status" = 'PROCESSED',
    "resolution" = 'نُقلت الدرجة بعد إعادة التفعيل للتوثيق فقط، وهي مستبعدة دائماً من الخصم والفصل والمحاسبة الأكاديمية.',
    "resolutionById" = NULL,
    "resolutionByName" = 'النظام',
    "resolvedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Student" s, "Grade" g
WHERE n."category" = 'DISMISSED_PENDING'
  AND n."status" <> 'PROCESSED'
  AND s."id" = n."studentId" AND s."status" = 'نشط'
  AND g."smartNoteId" = n."id";

DELETE FROM "GradeSmartNote" n
USING "Student" s
WHERE n."category" = 'DISMISSED_PENDING'
  AND n."status" <> 'PROCESSED'
  AND s."id" = n."studentId" AND s."status" = 'نشط';

COMMIT;
