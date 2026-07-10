CREATE TABLE IF NOT EXISTS "StudentLeaveGradeBackup" (
  "id" TEXT NOT NULL,
  "leaveId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "score" INTEGER,
  "notes" TEXT,
  "academicAccountingChecked" BOOLEAN NOT NULL DEFAULT false,
  "gradeCreatedAt" TIMESTAMP(3),
  "gradeUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentLeaveGradeBackup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentLeaveGradeBackup_leaveId_studentId_examId_key"
  ON "StudentLeaveGradeBackup"("leaveId", "studentId", "examId");

CREATE INDEX IF NOT EXISTS "StudentLeaveGradeBackup_leaveId_idx"
  ON "StudentLeaveGradeBackup"("leaveId");

CREATE INDEX IF NOT EXISTS "StudentLeaveGradeBackup_studentId_examId_idx"
  ON "StudentLeaveGradeBackup"("studentId", "examId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_leaveId_fkey') THEN
    ALTER TABLE "StudentLeaveGradeBackup"
      ADD CONSTRAINT "StudentLeaveGradeBackup_leaveId_fkey"
      FOREIGN KEY ("leaveId") REFERENCES "StudentLeave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_studentId_fkey') THEN
    ALTER TABLE "StudentLeaveGradeBackup"
      ADD CONSTRAINT "StudentLeaveGradeBackup_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_examId_fkey') THEN
    ALTER TABLE "StudentLeaveGradeBackup"
      ADD CONSTRAINT "StudentLeaveGradeBackup_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
