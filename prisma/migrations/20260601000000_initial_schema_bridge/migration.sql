-- Reproducible baseline bridge.
--
-- TeacherPro's first historical migration altered tables that had originally
-- been created with `prisma db push`. This idempotent bridge supplies the base
-- schema on an empty PostgreSQL database while remaining a no-op for existing
-- production databases. Later migrations add every post-baseline field.

CREATE TABLE IF NOT EXISTS "Course" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Chapter" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "opportunities" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Role" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "permissions" TEXT NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AppUser" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT,
  "role" TEXT NOT NULL,
  "roleId" TEXT,
  "permissions" TEXT NOT NULL DEFAULT '[]',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Student" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "school" TEXT NOT NULL DEFAULT '',
  "gender" TEXT NOT NULL,
  "phone" TEXT,
  "parentPhone" TEXT,
  "telegram" TEXT,
  "mainSite" TEXT,
  "subSite" TEXT,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'نشط',
  "dismissalType" TEXT,
  "dismissalReason" TEXT,
  "opportunities" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "courseId" TEXT NOT NULL,
  CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Exam" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "courseIds" TEXT NOT NULL DEFAULT '[]',
  "mainSite" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "fullMark" INTEGER NOT NULL,
  "passMark" INTEGER NOT NULL,
  "discountMark" INTEGER NOT NULL,
  "opportunitiesPenalty" TEXT NOT NULL,
  "dismissalGrade" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CourseChapter" (
  "id" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "courseId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  CONSTRAINT "CourseChapter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Grade" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "score" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "studentId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OpportunityLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "chapterId" TEXT,
  "studentId" TEXT NOT NULL,
  "examId" TEXT,
  CONSTRAINT "OpportunityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CorrectionSheet" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "correctionErrors" INTEGER NOT NULL DEFAULT 0,
  "sumErrors" INTEGER NOT NULL DEFAULT 0,
  "studentId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "correctorId" TEXT NOT NULL,
  CONSTRAINT "CorrectionSheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PermissionCatalog" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  CONSTRAINT "PermissionCatalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details" TEXT,
  "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  "userName" TEXT,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_username_key"
  ON "AppUser"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "Student_code_key"
  ON "Student"("code");
CREATE INDEX IF NOT EXISTS "Student_courseId_idx"
  ON "Student"("courseId");
CREATE INDEX IF NOT EXISTS "Student_status_idx"
  ON "Student"("status");
CREATE INDEX IF NOT EXISTS "CourseChapter_courseId_idx"
  ON "CourseChapter"("courseId");
CREATE INDEX IF NOT EXISTS "CourseChapter_chapterId_idx"
  ON "CourseChapter"("chapterId");
CREATE INDEX IF NOT EXISTS "Exam_type_idx"
  ON "Exam"("type");
CREATE INDEX IF NOT EXISTS "Exam_date_idx"
  ON "Exam"("date");
CREATE UNIQUE INDEX IF NOT EXISTS "Grade_studentId_examId_key"
  ON "Grade"("studentId", "examId");
CREATE INDEX IF NOT EXISTS "Grade_examId_idx"
  ON "Grade"("examId");
CREATE INDEX IF NOT EXISTS "OpportunityLog_studentId_idx"
  ON "OpportunityLog"("studentId");
CREATE INDEX IF NOT EXISTS "OpportunityLog_date_idx"
  ON "OpportunityLog"("date");
CREATE INDEX IF NOT EXISTS "AuditLog_module_idx"
  ON "AuditLog"("module");
CREATE INDEX IF NOT EXISTS "AuditLog_time_idx"
  ON "AuditLog"("time");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AppUser_roleId_fkey' AND conrelid = '"AppUser"'::regclass) THEN
    ALTER TABLE "AppUser"
      ADD CONSTRAINT "AppUser_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "Role"("id")
      ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_courseId_fkey' AND conrelid = '"Student"'::regclass) THEN
    ALTER TABLE "Student"
      ADD CONSTRAINT "Student_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CourseChapter_courseId_fkey' AND conrelid = '"CourseChapter"'::regclass) THEN
    ALTER TABLE "CourseChapter"
      ADD CONSTRAINT "CourseChapter_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CourseChapter_chapterId_fkey' AND conrelid = '"CourseChapter"'::regclass) THEN
    ALTER TABLE "CourseChapter"
      ADD CONSTRAINT "CourseChapter_chapterId_fkey"
      FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Grade_studentId_fkey' AND conrelid = '"Grade"'::regclass) THEN
    ALTER TABLE "Grade"
      ADD CONSTRAINT "Grade_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Grade_examId_fkey' AND conrelid = '"Grade"'::regclass) THEN
    ALTER TABLE "Grade"
      ADD CONSTRAINT "Grade_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "Exam"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpportunityLog_studentId_fkey' AND conrelid = '"OpportunityLog"'::regclass) THEN
    ALTER TABLE "OpportunityLog"
      ADD CONSTRAINT "OpportunityLog_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpportunityLog_examId_fkey' AND conrelid = '"OpportunityLog"'::regclass) THEN
    ALTER TABLE "OpportunityLog"
      ADD CONSTRAINT "OpportunityLog_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "Exam"("id")
      ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorrectionSheet_studentId_fkey' AND conrelid = '"CorrectionSheet"'::regclass) THEN
    ALTER TABLE "CorrectionSheet"
      ADD CONSTRAINT "CorrectionSheet_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorrectionSheet_examId_fkey' AND conrelid = '"CorrectionSheet"'::regclass) THEN
    ALTER TABLE "CorrectionSheet"
      ADD CONSTRAINT "CorrectionSheet_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "Exam"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorrectionSheet_correctorId_fkey' AND conrelid = '"CorrectionSheet"'::regclass) THEN
    ALTER TABLE "CorrectionSheet"
      ADD CONSTRAINT "CorrectionSheet_correctorId_fkey"
      FOREIGN KEY ("correctorId") REFERENCES "AppUser"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_userId_fkey' AND conrelid = '"AuditLog"'::regclass) THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END
$$;
