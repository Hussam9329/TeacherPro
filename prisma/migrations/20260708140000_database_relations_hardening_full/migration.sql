-- Database Relations Hardening Full Patch
-- Purpose: repair weak/orphan-prone links without breaking legacy production data.
-- The order is intentional: add compatibility columns/tables, clean orphan rows,
-- backfill snapshots, then attach constraints only after data is safe.

-- ─────────────────────────────────────────────────────────────────────────────
-- A1: GradeEntryMissingNote.examId must point to a real Exam.
-- Notes are per-exam operational records, so orphan notes are deleted before FK.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM "GradeEntryMissingNote" note
WHERE NOT EXISTS (
  SELECT 1 FROM "Exam" exam WHERE exam."id" = note."examId"
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GradeEntryMissingNote_examId_fkey') THEN
    ALTER TABLE "GradeEntryMissingNote"
      ADD CONSTRAINT "GradeEntryMissingNote_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "Exam"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A3: OpportunityLog.chapterId is historical. Keep logs, but avoid dead FK IDs.
-- Store the current chapter name as a snapshot, then set invalid IDs to NULL.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "chapterNameSnapshot" TEXT;

UPDATE "OpportunityLog" log
SET "chapterNameSnapshot" = chapter."name"
FROM "Chapter" chapter
WHERE log."chapterId" = chapter."id"
  AND COALESCE(log."chapterNameSnapshot", '') = '';

UPDATE "OpportunityLog" log
SET "chapterId" = NULL
WHERE log."chapterId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Chapter" chapter WHERE chapter."id" = log."chapterId"
  );

CREATE INDEX IF NOT EXISTS "OpportunityLog_chapterId_idx" ON "OpportunityLog"("chapterId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpportunityLog_chapterId_fkey') THEN
    ALTER TABLE "OpportunityLog"
      ADD CONSTRAINT "OpportunityLog_chapterId_fkey"
      FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A4: Exam.courseIds remains as a compatibility cache, but ExamCourse becomes
-- the relational source that protects Course/Exam links going forward.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ExamCourse" (
  "id" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  CONSTRAINT "ExamCourse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExamCourse_examId_courseId_key" ON "ExamCourse"("examId", "courseId");
CREATE INDEX IF NOT EXISTS "ExamCourse_courseId_idx" ON "ExamCourse"("courseId");

DELETE FROM "ExamCourse" link
WHERE NOT EXISTS (SELECT 1 FROM "Exam" exam WHERE exam."id" = link."examId")
   OR NOT EXISTS (SELECT 1 FROM "Course" course WHERE course."id" = link."courseId");

DO $$
DECLARE
  exam_row RECORD;
  parsed jsonb;
  linked_course_id TEXT;
BEGIN
  FOR exam_row IN SELECT "id", "courseIds" FROM "Exam" LOOP
    BEGIN
      parsed := COALESCE(NULLIF(exam_row."courseIds", ''), '[]')::jsonb;
    EXCEPTION WHEN others THEN
      parsed := '[]'::jsonb;
    END;

    IF jsonb_typeof(parsed) = 'array' THEN
      FOR linked_course_id IN SELECT value FROM jsonb_array_elements_text(parsed) AS value LOOP
        IF EXISTS (SELECT 1 FROM "Course" WHERE "id" = linked_course_id) THEN
          INSERT INTO "ExamCourse" ("id", "examId", "courseId")
          VALUES (concat('examcourse_', md5(exam_row."id" || ':' || linked_course_id)), exam_row."id", linked_course_id)
          ON CONFLICT ("examId", "courseId") DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExamCourse_examId_fkey') THEN
    ALTER TABLE "ExamCourse"
      ADD CONSTRAINT "ExamCourse_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "Exam"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExamCourse_courseId_fkey') THEN
    ALTER TABLE "ExamCourse"
      ADD CONSTRAINT "ExamCourse_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A5: StudentLeaveGradeBackup relations are official Prisma relations now.
-- Clean old orphan backup rows before enforcing FKs.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM "StudentLeaveGradeBackup" backup
WHERE NOT EXISTS (SELECT 1 FROM "StudentLeave" leave WHERE leave."id" = backup."leaveId")
   OR NOT EXISTS (SELECT 1 FROM "Student" student WHERE student."id" = backup."studentId")
   OR NOT EXISTS (SELECT 1 FROM "Exam" exam WHERE exam."id" = backup."examId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_leaveId_fkey') THEN
    ALTER TABLE "StudentLeaveGradeBackup"
      ADD CONSTRAINT "StudentLeaveGradeBackup_leaveId_fkey"
      FOREIGN KEY ("leaveId") REFERENCES "StudentLeave"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_studentId_fkey') THEN
    ALTER TABLE "StudentLeaveGradeBackup"
      ADD CONSTRAINT "StudentLeaveGradeBackup_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_examId_fkey') THEN
    ALTER TABLE "StudentLeaveGradeBackup"
      ADD CONSTRAINT "StudentLeaveGradeBackup_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "Exam"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A2: roleId is the source of truth. Keep AppUser.role as legacy display cache.
-- Backfill stale role text from the linked Role record, but keep unlinked users.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "AppUser" user_row
SET "role" = role_row."name"
FROM "Role" role_row
WHERE user_row."roleId" = role_row."id"
  AND COALESCE(user_row."role", '') <> role_row."name";
