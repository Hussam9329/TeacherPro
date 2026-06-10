-- Persist follow-up records that were previously stored only in client state.
CREATE TABLE "StudentLeave" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "studyType" TEXT NOT NULL DEFAULT '',
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentLeave_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentCall" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '',
  "target" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentNote" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT '',
  "text" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentLeave_studentId_examId_key" ON "StudentLeave"("studentId", "examId");
CREATE INDEX "StudentLeave_studentId_idx" ON "StudentLeave"("studentId");
CREATE INDEX "StudentLeave_examId_idx" ON "StudentLeave"("examId");
CREATE INDEX "StudentLeave_date_idx" ON "StudentLeave"("date");

CREATE INDEX "StudentCall_studentId_idx" ON "StudentCall"("studentId");
CREATE INDEX "StudentCall_examId_idx" ON "StudentCall"("examId");
CREATE INDEX "StudentCall_createdAt_idx" ON "StudentCall"("createdAt");

CREATE INDEX "StudentNote_studentId_idx" ON "StudentNote"("studentId");
CREATE INDEX "StudentNote_date_idx" ON "StudentNote"("date");

ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentCall" ADD CONSTRAINT "StudentCall_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentCall" ADD CONSTRAINT "StudentCall_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
