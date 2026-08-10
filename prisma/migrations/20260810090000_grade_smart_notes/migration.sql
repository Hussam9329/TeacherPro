-- Structured smart grade notes keep blocked attempts out of Grade while
-- preserving an auditable, resolvable record for the responsible user.
CREATE TABLE "GradeSmartNote" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "examId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "examNameSnapshot" TEXT NOT NULL DEFAULT '',
  "examDateSnapshot" TIMESTAMP(3),
  "studentNameSnapshot" TEXT NOT NULL DEFAULT '',
  "studentCodeSnapshot" TEXT NOT NULL DEFAULT '',
  "score" INTEGER,
  "reason" TEXT NOT NULL DEFAULT '',
  "attemptedById" TEXT,
  "attemptedByName" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolution" TEXT,
  "resolutionById" TEXT,
  "resolutionByName" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GradeSmartNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GradeSmartNote_category_check" CHECK (
    "category" IN ('DISMISSED_PENDING', 'GRACE_SCORED', 'BEFORE_REGISTRATION_PENDING', 'LEAVE_PENDING')
  ),
  CONSTRAINT "GradeSmartNote_status_check" CHECK (
    "status" IN ('PENDING', 'PROCESSED', 'CONFLICT', 'REJECTED')
  )
);

CREATE UNIQUE INDEX "GradeSmartNote_examId_studentId_category_key"
  ON "GradeSmartNote"("examId", "studentId", "category");
CREATE INDEX "GradeSmartNote_status_category_updatedAt_idx"
  ON "GradeSmartNote"("status", "category", "updatedAt");
CREATE INDEX "GradeSmartNote_studentId_updatedAt_idx"
  ON "GradeSmartNote"("studentId", "updatedAt");
CREATE INDEX "GradeSmartNote_examId_updatedAt_idx"
  ON "GradeSmartNote"("examId", "updatedAt");

ALTER TABLE "GradeSmartNote"
  ADD CONSTRAINT "GradeSmartNote_examId_fkey"
  FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GradeSmartNote"
  ADD CONSTRAINT "GradeSmartNote_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Grade"
  ADD COLUMN "academicEffectExcluded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "academicEffectExclusionReason" TEXT,
  ADD COLUMN "academicEffectExclusionSource" TEXT,
  ADD COLUMN "smartNoteId" TEXT;

CREATE UNIQUE INDEX "Grade_smartNoteId_key" ON "Grade"("smartNoteId");
ALTER TABLE "Grade"
  ADD CONSTRAINT "Grade_smartNoteId_fkey"
  FOREIGN KEY ("smartNoteId") REFERENCES "GradeSmartNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Even if a smart-note row is removed by a parent cascade, an excluded Grade
-- must retain a self-contained provenance source and can never silently become
-- an untraceable accounting exception.
ALTER TABLE "Grade"
  ADD CONSTRAINT "Grade_academicEffectExclusion_provenance_check"
  CHECK (NOT "academicEffectExcluded" OR "academicEffectExclusionSource" IS NOT NULL);

-- Preserve permanent academic exclusions when an excused marker temporarily
-- replaces a grade and the original record is later restored.
ALTER TABLE "StudentLeaveGradeBackup"
  ADD COLUMN "academicEffectExcluded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "academicEffectExclusionReason" TEXT,
  ADD COLUMN "academicEffectExclusionSource" TEXT,
  ADD COLUMN "smartNoteId" TEXT;
