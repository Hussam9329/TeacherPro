-- Speed up Student registry filtering/search on larger datasets.
CREATE INDEX IF NOT EXISTS "Student_parentPhone_idx" ON "Student"("parentPhone");
CREATE INDEX IF NOT EXISTS "Student_mainSite_idx" ON "Student"("mainSite");
CREATE INDEX IF NOT EXISTS "Student_subSite_idx" ON "Student"("subSite");
