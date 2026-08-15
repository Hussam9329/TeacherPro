ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT '';
UPDATE "StudentCall"
SET "status" = CASE WHEN "completed" THEN 'تم الاتصال' ELSE 'لم يرد' END
WHERE COALESCE("status", '') = '';
