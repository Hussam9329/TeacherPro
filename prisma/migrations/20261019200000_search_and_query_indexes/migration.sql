-- Search and hot-query indexes. Additive only: nothing is dropped or changed.
--
-- Searches use ILIKE '%…%' (Prisma "contains", mode insensitive), which a
-- b-tree index cannot serve: every keystroke scanned the whole table. pg_trgm
-- GIN indexes serve those patterns. The b-tree pairs match the shapes the
-- recalculation, the leaves screens and the logs page query by.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Student search (name, its normalized key, school).
CREATE INDEX IF NOT EXISTS "Student_name_trgm_idx" ON "Student" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Student_nameKey_trgm_idx" ON "Student" USING gin ("nameKey" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Student_school_trgm_idx" ON "Student" USING gin ("school" gin_trgm_ops);

-- The logs page searches the details text; profiles and call stats look up
-- a student's or an exam's lines in it.
CREATE INDEX IF NOT EXISTS "AuditLog_details_trgm_idx" ON "AuditLog" USING gin ("details" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "AuditLog_module_action_time_idx" ON "AuditLog" ("module", "action", "time");

-- A student's notes in date order (academic recalculation).
CREATE INDEX IF NOT EXISTS "StudentNote_studentId_date_idx" ON "StudentNote" ("studentId", "date");

-- Period leaves covering a date (absence marking, the leaves window).
CREATE INDEX IF NOT EXISTS "StudentLeave_leaveType_dateFrom_dateTo_idx" ON "StudentLeave" ("leaveType", "dateFrom", "dateTo");
