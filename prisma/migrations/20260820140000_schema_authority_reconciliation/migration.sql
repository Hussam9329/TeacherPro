-- TeacherPro schema-authority reconciliation.
--
-- From this migration onward, Prisma migrations are the only code allowed to
-- create or alter application schema. API routes perform a read-only check for
-- this migration and return DATABASE_MIGRATION_REQUIRED when it is absent.

-- Student_code_seq also had a runtime self-healing fallback. Reconcile it here
-- once, then let requests only consume values from the migration-owned object.
CREATE SEQUENCE IF NOT EXISTS "Student_code_seq"
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1;

SELECT setval(
  '"Student_code_seq"',
  GREATEST(
    COALESCE(
      (
        SELECT MAX((substring("code" from '^BIO-([0-9]+)$'))::bigint) + 1
        FROM "Student"
        WHERE "code" ~ '^BIO-[0-9]+$'
      ),
      1
    ),
    (
      SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END
      FROM "Student_code_seq"
    )
  ),
  false
);

-- LogClearBackup was the final table that existed only as runtime DDL. Make it
-- part of the versioned schema before removing that runtime table creation.
CREATE TABLE IF NOT EXISTS "LogClearBackup" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "createdByName" TEXT,
  "scopeIds" TEXT NOT NULL,
  "scopeLabels" TEXT NOT NULL,
  "dateFrom" TEXT,
  "dateTo" TEXT,
  "rangeLabel" TEXT NOT NULL,
  "auditLogs" TEXT NOT NULL,
  "opportunityLogs" TEXT NOT NULL,
  "auditCount" INTEGER NOT NULL DEFAULT 0,
  "opportunityCount" INTEGER NOT NULL DEFAULT 0,
  "restoredAt" TIMESTAMP(3),
  "restoredById" TEXT,
  "restoredByName" TEXT,
  CONSTRAINT "LogClearBackup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LogClearBackup_createdAt_idx"
  ON "LogClearBackup"("createdAt");
CREATE INDEX IF NOT EXISTS "LogClearBackup_restoredAt_idx"
  ON "LogClearBackup"("restoredAt");

-- Compatibility DDL used NOT VALID for these relations. Finishing validation
-- here converts them into normal, fully enforced schema constraints. If legacy
-- orphan data exists, the migration stops instead of silently deleting it.
ALTER TABLE "AppUser"
  VALIDATE CONSTRAINT "AppUser_roleId_fkey";
ALTER TABLE "Student"
  VALIDATE CONSTRAINT "Student_courseId_fkey";
ALTER TABLE "CourseChapter"
  VALIDATE CONSTRAINT "CourseChapter_courseId_fkey";
ALTER TABLE "CourseChapter"
  VALIDATE CONSTRAINT "CourseChapter_chapterId_fkey";
ALTER TABLE "Grade"
  VALIDATE CONSTRAINT "Grade_studentId_fkey";
ALTER TABLE "Grade"
  VALIDATE CONSTRAINT "Grade_examId_fkey";
ALTER TABLE "OpportunityLog"
  VALIDATE CONSTRAINT "OpportunityLog_studentId_fkey";
ALTER TABLE "OpportunityLog"
  VALIDATE CONSTRAINT "OpportunityLog_examId_fkey";
ALTER TABLE "CorrectionSheet"
  VALIDATE CONSTRAINT "CorrectionSheet_studentId_fkey";
ALTER TABLE "CorrectionSheet"
  VALIDATE CONSTRAINT "CorrectionSheet_examId_fkey";
ALTER TABLE "CorrectionSheet"
  VALIDATE CONSTRAINT "CorrectionSheet_correctorId_fkey";
ALTER TABLE "AuditLog"
  VALIDATE CONSTRAINT "AuditLog_userId_fkey";
ALTER TABLE "StudentLeave"
  VALIDATE CONSTRAINT "StudentLeave_studentId_fkey";
ALTER TABLE "StudentLeave"
  VALIDATE CONSTRAINT "StudentLeave_examId_fkey";
ALTER TABLE "StudentCall"
  VALIDATE CONSTRAINT "StudentCall_studentId_fkey";
ALTER TABLE "StudentCall"
  VALIDATE CONSTRAINT "StudentCall_examId_fkey";
ALTER TABLE "StudentNote"
  VALIDATE CONSTRAINT "StudentNote_studentId_fkey";
ALTER TABLE "StudentEnrollmentArchive"
  VALIDATE CONSTRAINT "StudentEnrollmentArchive_studentId_fkey";

-- Seal the schema. Earlier versioned migrations are responsible for creating
-- these objects; this final assertion makes a successful migration record a
-- reliable readiness signal for runtime code.
DO $$
DECLARE
  missing_objects TEXT;
BEGIN
  IF to_regclass('"Student_code_seq"') IS NULL THEN
    RAISE EXCEPTION 'TeacherPro schema reconciliation failed; missing sequence: Student_code_seq';
  END IF;

  IF to_regprocedure('"enforce_grade_status_score_consistency"()') IS NULL THEN
    RAISE EXCEPTION 'TeacherPro schema reconciliation failed; missing function: enforce_grade_status_score_consistency';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'Grade_enforce_status_score_consistency'
      AND tgrelid = '"Grade"'::regclass
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'TeacherPro schema reconciliation failed; missing or disabled trigger: Grade_enforce_status_score_consistency';
  END IF;

  WITH required_tables(name) AS (
    VALUES
      ('Student'),
      ('CourseChapter'),
      ('Grade'),
      ('OpportunityLog'),
      ('Exam'),
      ('ExamCourse'),
      ('GradeEntryMissingNote'),
      ('TelegramExamSubmission'),
      ('StudentLeave'),
      ('StudentCall'),
      ('StudentNote'),
      ('StudentEnrollmentArchive'),
      ('StudentLeaveGradeBackup'),
      ('LogClearBackup')
  )
  SELECT string_agg(name, ', ' ORDER BY name)
  INTO missing_objects
  FROM required_tables
  WHERE to_regclass(format('%I', name)) IS NULL;

  IF missing_objects IS NOT NULL THEN
    RAISE EXCEPTION 'TeacherPro schema reconciliation failed; missing tables: %', missing_objects;
  END IF;

  WITH required_columns(table_name, column_name) AS (
    VALUES
      ('Student', 'nameKey'),
      ('Student', 'phoneKey'),
      ('Student', 'telegramKey'),
      ('Student', 'baseOpportunities'),
      ('Student', 'accountingGraceDays'),
      ('Student', 'gracePeriodStartDate'),
      ('CourseChapter', 'archived'),
      ('CourseChapter', 'archive'),
      ('Grade', 'academicAccountingChecked'),
      ('OpportunityLog', 'chapterNameSnapshot'),
      ('Exam', 'noDiscount'),
      ('Exam', 'scheduledActivateAt'),
      ('Exam', 'scheduledDeactivateAt'),
      ('ExamCourse', 'examId'),
      ('ExamCourse', 'courseId'),
      ('GradeEntryMissingNote', 'examId'),
      ('TelegramExamSubmission', 'gradeId'),
      ('TelegramExamSubmission', 'matchType'),
      ('TelegramExamSubmission', 'matchSource'),
      ('TelegramExamSubmission', 'matchDetails'),
      ('StudentLeave', 'leaveType'),
      ('StudentLeave', 'dateFrom'),
      ('StudentLeave', 'dateTo'),
      ('StudentCall', 'status'),
      ('StudentNote', 'sourceType'),
      ('StudentNote', 'sourceId'),
      ('StudentNote', 'dismissalKey'),
      ('StudentNote', 'dismissalType'),
      ('StudentNote', 'dismissalReason'),
      ('StudentNote', 'dismissalDate'),
      ('StudentEnrollmentArchive', 'studentId'),
      ('StudentEnrollmentArchive', 'snapshot'),
      ('StudentLeaveGradeBackup', 'academicAccountingChecked'),
      ('StudentLeaveGradeBackup', 'academicEffectExcluded'),
      ('StudentLeaveGradeBackup', 'academicEffectExclusionReason'),
      ('StudentLeaveGradeBackup', 'academicEffectExclusionSource'),
      ('StudentLeaveGradeBackup', 'smartNoteId'),
      ('LogClearBackup', 'auditLogs'),
      ('LogClearBackup', 'opportunityLogs'),
      ('LogClearBackup', 'restoredAt')
  )
  SELECT string_agg(
    format('%I.%I', required.table_name, required.column_name),
    ', ' ORDER BY required.table_name, required.column_name
  )
  INTO missing_objects
  FROM required_columns required
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns actual
    WHERE actual.table_schema = current_schema()
      AND actual.table_name = required.table_name
      AND actual.column_name = required.column_name
  );

  IF missing_objects IS NOT NULL THEN
    RAISE EXCEPTION 'TeacherPro schema reconciliation failed; missing columns: %', missing_objects;
  END IF;

  WITH required_constraints(table_name, name) AS (
    VALUES
      ('AppUser', 'AppUser_roleId_fkey'),
      ('Student', 'Student_courseId_fkey'),
      ('CourseChapter', 'CourseChapter_courseId_fkey'),
      ('CourseChapter', 'CourseChapter_chapterId_fkey'),
      ('Grade', 'Grade_studentId_fkey'),
      ('Grade', 'Grade_examId_fkey'),
      ('Grade', 'Grade_status_score_consistency'),
      ('OpportunityLog', 'OpportunityLog_studentId_fkey'),
      ('OpportunityLog', 'OpportunityLog_examId_fkey'),
      ('CorrectionSheet', 'CorrectionSheet_studentId_fkey'),
      ('CorrectionSheet', 'CorrectionSheet_examId_fkey'),
      ('CorrectionSheet', 'CorrectionSheet_correctorId_fkey'),
      ('AuditLog', 'AuditLog_userId_fkey'),
      ('ExamCourse', 'ExamCourse_examId_fkey'),
      ('ExamCourse', 'ExamCourse_courseId_fkey'),
      ('GradeEntryMissingNote', 'GradeEntryMissingNote_examId_fkey'),
      ('OpportunityLog', 'OpportunityLog_chapterId_fkey'),
      ('StudentLeave', 'StudentLeave_studentId_fkey'),
      ('StudentLeave', 'StudentLeave_examId_fkey'),
      ('StudentCall', 'StudentCall_studentId_fkey'),
      ('StudentCall', 'StudentCall_examId_fkey'),
      ('StudentNote', 'StudentNote_studentId_fkey'),
      ('StudentEnrollmentArchive', 'StudentEnrollmentArchive_studentId_fkey'),
      ('StudentLeaveGradeBackup', 'StudentLeaveGradeBackup_leaveId_fkey'),
      ('StudentLeaveGradeBackup', 'StudentLeaveGradeBackup_studentId_fkey'),
      ('StudentLeaveGradeBackup', 'StudentLeaveGradeBackup_examId_fkey'),
      ('TelegramExamSubmission', 'TelegramExamSubmission_studentId_fkey'),
      ('TelegramExamSubmission', 'TelegramExamSubmission_examId_fkey'),
      ('TelegramExamSubmission', 'TelegramExamSubmission_gradeId_fkey')
  )
  SELECT string_agg(name, ', ' ORDER BY name)
  INTO missing_objects
  FROM required_constraints required
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint actual
    WHERE actual.conname = required.name
      AND actual.conrelid = to_regclass(format('%I', required.table_name))
      AND actual.convalidated = TRUE
  );

  IF missing_objects IS NOT NULL THEN
    RAISE EXCEPTION 'TeacherPro schema reconciliation failed; missing or unvalidated constraints: %', missing_objects;
  END IF;
END
$$;
