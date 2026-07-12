CREATE TABLE IF NOT EXISTS "StudentEnrollmentArchive" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromCourseId" TEXT NOT NULL,
    "fromCourseName" TEXT NOT NULL DEFAULT '',
    "toCourseId" TEXT,
    "toCourseName" TEXT NOT NULL DEFAULT '',
    "resetKind" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "snapshot" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentEnrollmentArchive_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "studentId" TEXT;
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "fromCourseId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "fromCourseName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "toCourseId" TEXT;
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "toCourseName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "resetKind" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "reason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "snapshot" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
ALTER TABLE "StudentEnrollmentArchive" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "StudentEnrollmentArchive_studentId_createdAt_idx"
ON "StudentEnrollmentArchive"("studentId", "createdAt");

CREATE INDEX IF NOT EXISTS "StudentEnrollmentArchive_fromCourseId_idx"
ON "StudentEnrollmentArchive"("fromCourseId");

CREATE INDEX IF NOT EXISTS "StudentEnrollmentArchive_toCourseId_idx"
ON "StudentEnrollmentArchive"("toCourseId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'StudentEnrollmentArchive_studentId_fkey'
  ) THEN
    ALTER TABLE "StudentEnrollmentArchive"
    ADD CONSTRAINT "StudentEnrollmentArchive_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id")
    ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END
$$;
