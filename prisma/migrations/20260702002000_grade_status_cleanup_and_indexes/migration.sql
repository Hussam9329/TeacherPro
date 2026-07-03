-- One-time maintenance for old Grade records.
-- GET /api/grades must remain read-only; legacy repair belongs in migrations.
UPDATE "Grade"
SET "status" = 'غائب'
WHERE "status" = 'مجاز';

-- Speed up grade filters and paginated reads.
CREATE INDEX IF NOT EXISTS "Grade_status_idx" ON "Grade"("status");
CREATE INDEX IF NOT EXISTS "Grade_updatedAt_idx" ON "Grade"("updatedAt");
