-- Performance indexes — adds 4 missing indexes identified by the
-- performance audit. These indexes target WHERE/ORDER BY clauses that
-- currently cause Seq Scan + Sort on tables with 2K-19K rows.

-- 1. Student.createdAt — used by orderBy: { createdAt: "desc" } in
--    every student list query. Without this index, Postgres does a
--    full Seq Scan + Sort on 2,430 rows.
CREATE INDEX IF NOT EXISTS "Student_createdAt_idx"
    ON "Student"("createdAt" DESC);

-- 2. OpportunityLog.examId — used by recalculateStudentsForExam() and
--    opportunity-logs listing when filtering by exam. Currently only
--    studentId/date/chapterId are indexed.
CREATE INDEX IF NOT EXISTS "OpportunityLog_examId_idx"
    ON "OpportunityLog"("examId");

-- 3. AuditLog.userName — used by logs/route.ts when filtering by
--    userName. AuditLog has 18,954 rows and this column had no index.
CREATE INDEX IF NOT EXISTS "AuditLog_userName_idx"
    ON "AuditLog"("userName");

-- 4. Exam.active (partial index) — used by stats/route.ts and
--    exam listing when filtering WHERE active = true. Only 24 rows
--    but the partial index keeps it tiny and fast.
CREATE INDEX IF NOT EXISTS "Exam_active_idx"
    ON "Exam"("active")
    WHERE "active" = true;
