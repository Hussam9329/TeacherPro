-- StudentCall perfect integrity patch
-- 1) Keep the newest row for each logical call key.
-- 2) Add a normal Prisma-compatible unique key.
-- 3) Add a PostgreSQL expression unique key so examId = NULL notes are also unique.

WITH ranked_calls AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "studentId", COALESCE("examId", '__teacherpro_no_exam__'), "category"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "StudentCall"
)
DELETE FROM "StudentCall" call
USING ranked_calls ranked
WHERE call."id" = ranked."id"
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "StudentCall_studentId_examId_category_key"
  ON "StudentCall" ("studentId", "examId", "category");

CREATE UNIQUE INDEX IF NOT EXISTS "StudentCall_studentId_examId_category_coalesced_key"
  ON "StudentCall" ("studentId", COALESCE("examId", '__teacherpro_no_exam__'), "category");
