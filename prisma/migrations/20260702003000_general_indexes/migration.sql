-- General indexes for pagination + filtering on all major tables.
-- All use CREATE INDEX IF NOT EXISTS so re-runs are safe.

-- AuditLog: already has indexes on module + time from original schema.

-- OpportunityLog: already has indexes on studentId + date.

-- CorrectionSheet: add index on startedAt for pagination ordering.
CREATE INDEX IF NOT EXISTS "CorrectionSheet_startedAt_idx" ON "CorrectionSheet"("startedAt");

-- StudentCall: add index on createdAt for pagination ordering.
CREATE INDEX IF NOT EXISTS "StudentCall_createdAt_idx" ON "StudentCall"("createdAt");

-- StudentLeave: indexes on dateFrom + dateTo for period queries.
CREATE INDEX IF NOT EXISTS "StudentLeave_dateFrom_idx" ON "StudentLeave"("dateFrom");
CREATE INDEX IF NOT EXISTS "StudentLeave_dateTo_idx" ON "StudentLeave"("dateTo");

-- Course: index on createdAt for ordering (may already exist via Prisma).
CREATE INDEX IF NOT EXISTS "Course_createdAt_idx" ON "Course"("createdAt");

-- Chapter: index on name for alphabetical ordering.
CREATE INDEX IF NOT EXISTS "Chapter_name_idx" ON "Chapter"("name");
