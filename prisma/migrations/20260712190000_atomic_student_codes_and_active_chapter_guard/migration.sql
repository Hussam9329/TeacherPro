-- Atomic student codes + hard database guards for chapter links.

-- 1) PostgreSQL sequence seeded above every existing BIO code.
CREATE SEQUENCE IF NOT EXISTS "Student_code_seq"
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1;

SELECT setval(
  '"Student_code_seq"',
  GREATEST(
    COALESCE(
      (
        SELECT MAX((substring("code" from '^BIO-([0-9]+)$'))::bigint) + 1
        FROM "Student"
        WHERE "code" ~ '^BIO-[0-9]+$'
      ),
      1
    ),
    (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM "Student_code_seq")
  ),
  false
);

-- 2) Preserve duplicate legacy links by archiving extras instead of deleting them.
-- Prefer the active record when one exists, then use a deterministic id order.
WITH ranked_links AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "courseId", "chapterId"
      ORDER BY "active" DESC, "id" ASC
    ) AS row_number
  FROM "CourseChapter"
  WHERE "archived" = false
)
UPDATE "CourseChapter" link
SET "active" = false,
    "archived" = true
FROM ranked_links ranked
WHERE link."id" = ranked."id"
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "CourseChapter_courseId_chapterId_unarchived_key"
  ON "CourseChapter"("courseId", "chapterId")
  WHERE "archived" = false;

-- 3) Repair historical active conflicts before enforcing the invariant.
-- Keep the link whose chapter opportunity count best matches current student
-- baselines; ties are deterministic. No rows or archives are deleted.
WITH ranked_active_links AS (
  SELECT
    link."id",
    ROW_NUMBER() OVER (
      PARTITION BY link."courseId"
      ORDER BY
        (
          SELECT COUNT(*)
          FROM "Student" student
          JOIN "Chapter" chapter ON chapter."id" = link."chapterId"
          WHERE student."courseId" = link."courseId"
            AND student."status" <> 'مؤرشف'
            AND student."baseOpportunities" = chapter."opportunities"
        ) DESC,
        link."id" ASC
    ) AS row_number
  FROM "CourseChapter" link
  WHERE link."active" = true
    AND link."archived" = false
)
UPDATE "CourseChapter" link
SET "active" = false
FROM ranked_active_links ranked
WHERE link."id" = ranked."id"
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "CourseChapter_one_active_per_course_key"
  ON "CourseChapter"("courseId")
  WHERE "active" = true AND "archived" = false;
