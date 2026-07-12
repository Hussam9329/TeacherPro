-- Repair columns that exist in schema.prisma and are read by the dashboard,
-- exam statistics, leaves and grade recalculation, but were never introduced
-- by any historical migration.
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "phoneKey" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "telegramKey" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "baseOpportunities" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "accountingGraceDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CourseChapter" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CourseChapter" ADD COLUMN IF NOT EXISTS "archive" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "academicAccountingChecked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "chapterNameSnapshot" TEXT;

-- Preserve every Student row. Only duplicated derived lookup keys are cleared;
-- user-entered names, phones and Telegram values remain untouched.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "nameKey" ORDER BY "createdAt", "id") AS rn
  FROM "Student" WHERE "nameKey" IS NOT NULL AND "nameKey" <> ''
)
UPDATE "Student" student SET "nameKey" = NULL
FROM ranked WHERE student."id" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "phoneKey" ORDER BY "createdAt", "id") AS rn
  FROM "Student" WHERE "phoneKey" IS NOT NULL AND "phoneKey" <> ''
)
UPDATE "Student" student SET "phoneKey" = NULL
FROM ranked WHERE student."id" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "telegramKey" ORDER BY "createdAt", "id") AS rn
  FROM "Student" WHERE "telegramKey" IS NOT NULL AND "telegramKey" <> ''
)
UPDATE "Student" student SET "telegramKey" = NULL
FROM ranked WHERE student."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Student_nameKey_key" ON "Student"("nameKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Student_phoneKey_key" ON "Student"("phoneKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Student_telegramKey_key" ON "Student"("telegramKey");

-- Rebuild the academic baseline from the single active chapter, which is the
-- authoritative source. Current opportunities are intentionally not changed.
WITH one_active_chapter AS (
  SELECT link."courseId", MAX(chapter."opportunities") AS opportunities
  FROM "CourseChapter" link
  JOIN "Chapter" chapter ON chapter."id" = link."chapterId"
  WHERE link."active" = true AND link."archived" = false
  GROUP BY link."courseId"
  HAVING COUNT(*) = 1
)
UPDATE "Student" student
SET "baseOpportunities" = GREATEST(0, source.opportunities)
FROM one_active_chapter source
WHERE student."courseId" = source."courseId"
  AND student."status" <> 'مؤرشف';
