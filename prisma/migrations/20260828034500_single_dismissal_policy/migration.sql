-- TeacherPro single-dismissal policy.
-- Runtime now has one dismissal state only (Student.status = 'مفصول').
-- The new Prisma schema no longer maps legacy dismissal-type columns. Keep the
-- physical DB columns during this rollout only for zero-downtime compatibility
-- with an older deployment, but clear their values and remove the old enum
-- constraint so they cannot remain an authority for academic behavior.

ALTER TABLE "Student"
  DROP CONSTRAINT IF EXISTS "Student_dismissal_type_allowed";

UPDATE "Student"
SET "dismissalType" = NULL
WHERE "dismissalType" IS NOT NULL;

UPDATE "StudentNote"
SET "dismissalType" = ''
WHERE COALESCE("dismissalType", '') <> '';

-- Final-exam dismissal is represented by exam type/rules, never by a textual
-- dismissal type stored in opportunitiesPenalty.
UPDATE "Exam"
SET "opportunitiesPenalty" = '0'
WHERE "opportunitiesPenalty" IN ('فصل مؤقت', 'فصل نهائي');

-- Convert the historical one-opportunity pledge marker to the new canonical
-- two-opportunity reactivation baseline. The academic engine replays later
-- events chronologically, so future recalculations preserve subsequent losses.
UPDATE "OpportunityLog"
SET
  "action" = 'رصيد بعد تعهد',
  "amount" = 2,
  "reason" = 'إرجاع الطالب بعد تعهد ولي الأمر برصيد فرصتين'
WHERE "action" = 'فرصة أخيرة بعد تعهد';

-- Normalize user-visible legacy wording so historical records can no longer
-- imply that a previous dismissal or pledge changes the type of a later one.
UPDATE "Student"
SET "dismissalReason" = REPLACE(
  REPLACE(
    REPLACE(REPLACE(COALESCE("dismissalReason", ''), 'فصل مؤقت', 'فصل'), 'فصل نهائي', 'فصل'),
    'عدم الالتزام بالتعهد السابق - ',
    ''
  ),
  'الفصل الثاني للطالب - ',
  ''
)
WHERE COALESCE("dismissalReason", '') LIKE '%فصل مؤقت%'
   OR COALESCE("dismissalReason", '') LIKE '%فصل نهائي%'
   OR COALESCE("dismissalReason", '') LIKE 'عدم الالتزام بالتعهد السابق - %'
   OR COALESCE("dismissalReason", '') LIKE 'الفصل الثاني للطالب - %';

UPDATE "StudentNote"
SET
  "text" = REPLACE(
    REPLACE(
      REPLACE(REPLACE("text", 'فصل مؤقت', 'فصل'), 'فصل نهائي', 'فصل'),
      'عدم الالتزام بالتعهد السابق - ',
      ''
    ),
    'الفصل الثاني للطالب - ',
    ''
  ),
  "dismissalReason" = REPLACE(
    REPLACE(
      REPLACE(REPLACE(COALESCE("dismissalReason", ''), 'فصل مؤقت', 'فصل'), 'فصل نهائي', 'فصل'),
      'عدم الالتزام بالتعهد السابق - ',
      ''
    ),
    'الفصل الثاني للطالب - ',
    ''
  )
WHERE "text" LIKE '%فصل مؤقت%'
   OR "text" LIKE '%فصل نهائي%'
   OR "text" LIKE '%عدم الالتزام بالتعهد السابق - %'
   OR "text" LIKE '%الفصل الثاني للطالب - %'
   OR COALESCE("dismissalReason", '') LIKE '%فصل مؤقت%'
   OR COALESCE("dismissalReason", '') LIKE '%فصل نهائي%'
   OR COALESCE("dismissalReason", '') LIKE 'عدم الالتزام بالتعهد السابق - %'
   OR COALESCE("dismissalReason", '') LIKE 'الفصل الثاني للطالب - %';

UPDATE "OpportunityLog"
SET "reason" = REPLACE(
  REPLACE(
    REPLACE(REPLACE("reason", 'فصل مؤقت', 'فصل'), 'فصل نهائي', 'فصل'),
    'عدم الالتزام بالتعهد السابق - ',
    ''
  ),
  'الفصل الثاني للطالب - ',
  ''
)
WHERE "reason" LIKE '%فصل مؤقت%'
   OR "reason" LIKE '%فصل نهائي%'
   OR "reason" LIKE '%عدم الالتزام بالتعهد السابق - %'
   OR "reason" LIKE '%الفصل الثاني للطالب - %';

UPDATE "AuditLog"
SET "details" = REPLACE(
  REPLACE(
    REPLACE(REPLACE("details", 'فصل مؤقت', 'فصل'), 'فصل نهائي', 'فصل'),
    'عدم الالتزام بالتعهد السابق - ',
    ''
  ),
  'الفصل الثاني للطالب - ',
  ''
)
WHERE "details" LIKE '%فصل مؤقت%'
   OR "details" LIKE '%فصل نهائي%'
   OR "details" LIKE '%عدم الالتزام بالتعهد السابق - %'
   OR "details" LIKE '%الفصل الثاني للطالب - %';

-- Enrollment/chapter archives are serialized JSON text. Keep the historical
-- facts, but normalize only the obsolete policy wording so old cards/reports
-- cannot surface a temporary/final classification after the rollout.
UPDATE "StudentEnrollmentArchive"
SET "snapshot" = REPLACE(
  REPLACE(
    REPLACE(REPLACE("snapshot", 'فصل مؤقت', 'فصل'), 'فصل نهائي', 'فصل'),
    'عدم الالتزام بالتعهد السابق - ',
    ''
  ),
  'الفصل الثاني للطالب - ',
  ''
)
WHERE "snapshot" LIKE '%فصل مؤقت%'
   OR "snapshot" LIKE '%فصل نهائي%'
   OR "snapshot" LIKE '%عدم الالتزام بالتعهد السابق - %'
   OR "snapshot" LIKE '%الفصل الثاني للطالب - %';

UPDATE "CourseChapter"
SET "archive" = REPLACE(
  REPLACE(
    REPLACE(REPLACE("archive", 'فصل مؤقت', 'فصل'), 'فصل نهائي', 'فصل'),
    'عدم الالتزام بالتعهد السابق - ',
    ''
  ),
  'الفصل الثاني للطالب - ',
  ''
)
WHERE "archive" LIKE '%فصل مؤقت%'
   OR "archive" LIKE '%فصل نهائي%'
   OR "archive" LIKE '%عدم الالتزام بالتعهد السابق - %'
   OR "archive" LIKE '%الفصل الثاني للطالب - %';
