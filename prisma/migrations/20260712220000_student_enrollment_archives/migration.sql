CREATE TABLE "StudentEnrollmentArchive" (
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

CREATE INDEX "StudentEnrollmentArchive_studentId_createdAt_idx"
ON "StudentEnrollmentArchive"("studentId", "createdAt");

CREATE INDEX "StudentEnrollmentArchive_fromCourseId_idx"
ON "StudentEnrollmentArchive"("fromCourseId");

CREATE INDEX "StudentEnrollmentArchive_toCourseId_idx"
ON "StudentEnrollmentArchive"("toCourseId");

ALTER TABLE "StudentEnrollmentArchive"
ADD CONSTRAINT "StudentEnrollmentArchive_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
