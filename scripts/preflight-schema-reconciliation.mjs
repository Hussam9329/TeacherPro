import process from "node:process";

import pg from "pg";

const { Client } = pg;

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("[TeacherPro Schema Preflight] DATABASE_URL is required.");
  process.exit(1);
}

const checks = [
  {
    label: "AppUser.roleId -> Role.id",
    tables: ["AppUser", "Role"],
    sql: `SELECT COUNT(*)::int AS count FROM "AppUser" child WHERE child."roleId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Role" parent WHERE parent."id" = child."roleId")`,
  },
  {
    label: "Student.courseId -> Course.id",
    tables: ["Student", "Course"],
    sql: `SELECT COUNT(*)::int AS count FROM "Student" child WHERE NOT EXISTS (SELECT 1 FROM "Course" parent WHERE parent."id" = child."courseId")`,
  },
  {
    label: "CourseChapter.courseId -> Course.id",
    tables: ["CourseChapter", "Course"],
    sql: `SELECT COUNT(*)::int AS count FROM "CourseChapter" child WHERE NOT EXISTS (SELECT 1 FROM "Course" parent WHERE parent."id" = child."courseId")`,
  },
  {
    label: "CourseChapter.chapterId -> Chapter.id",
    tables: ["CourseChapter", "Chapter"],
    sql: `SELECT COUNT(*)::int AS count FROM "CourseChapter" child WHERE NOT EXISTS (SELECT 1 FROM "Chapter" parent WHERE parent."id" = child."chapterId")`,
  },
  {
    label: "Grade.studentId -> Student.id",
    tables: ["Grade", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "Grade" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "Grade.examId -> Exam.id",
    tables: ["Grade", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "Grade" child WHERE NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "OpportunityLog.studentId -> Student.id",
    tables: ["OpportunityLog", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "OpportunityLog" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "OpportunityLog.examId -> Exam.id",
    tables: ["OpportunityLog", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "OpportunityLog" child WHERE child."examId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "CorrectionSheet.studentId -> Student.id",
    tables: ["CorrectionSheet", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "CorrectionSheet" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "CorrectionSheet.examId -> Exam.id",
    tables: ["CorrectionSheet", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "CorrectionSheet" child WHERE NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "CorrectionSheet.correctorId -> AppUser.id",
    tables: ["CorrectionSheet", "AppUser"],
    sql: `SELECT COUNT(*)::int AS count FROM "CorrectionSheet" child WHERE NOT EXISTS (SELECT 1 FROM "AppUser" parent WHERE parent."id" = child."correctorId")`,
  },
  {
    label: "AuditLog.userId -> AppUser.id",
    tables: ["AuditLog", "AppUser"],
    sql: `SELECT COUNT(*)::int AS count FROM "AuditLog" child WHERE child."userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AppUser" parent WHERE parent."id" = child."userId")`,
  },
  {
    label: "StudentLeave.studentId -> Student.id",
    tables: ["StudentLeave", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentLeave" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "StudentLeave.examId -> Exam.id",
    tables: ["StudentLeave", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentLeave" child WHERE child."examId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "StudentCall.studentId -> Student.id",
    tables: ["StudentCall", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentCall" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "StudentCall.examId -> Exam.id",
    tables: ["StudentCall", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentCall" child WHERE child."examId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "StudentNote.studentId -> Student.id",
    tables: ["StudentNote", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentNote" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "StudentEnrollmentArchive.studentId -> Student.id",
    tables: ["StudentEnrollmentArchive", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentEnrollmentArchive" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "ExamCourse.examId -> Exam.id",
    tables: ["ExamCourse", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "ExamCourse" child WHERE NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "ExamCourse.courseId -> Course.id",
    tables: ["ExamCourse", "Course"],
    sql: `SELECT COUNT(*)::int AS count FROM "ExamCourse" child WHERE NOT EXISTS (SELECT 1 FROM "Course" parent WHERE parent."id" = child."courseId")`,
  },
  {
    label: "GradeEntryMissingNote.examId -> Exam.id",
    tables: ["GradeEntryMissingNote", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "GradeEntryMissingNote" child WHERE NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "OpportunityLog.chapterId -> Chapter.id",
    tables: ["OpportunityLog", "Chapter"],
    sql: `SELECT COUNT(*)::int AS count FROM "OpportunityLog" child WHERE child."chapterId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Chapter" parent WHERE parent."id" = child."chapterId")`,
  },
  {
    label: "StudentLeaveGradeBackup.leaveId -> StudentLeave.id",
    tables: ["StudentLeaveGradeBackup", "StudentLeave"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentLeaveGradeBackup" child WHERE NOT EXISTS (SELECT 1 FROM "StudentLeave" parent WHERE parent."id" = child."leaveId")`,
  },
  {
    label: "StudentLeaveGradeBackup.studentId -> Student.id",
    tables: ["StudentLeaveGradeBackup", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentLeaveGradeBackup" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "StudentLeaveGradeBackup.examId -> Exam.id",
    tables: ["StudentLeaveGradeBackup", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "StudentLeaveGradeBackup" child WHERE NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "TelegramExamSubmission.studentId -> Student.id",
    tables: ["TelegramExamSubmission", "Student"],
    sql: `SELECT COUNT(*)::int AS count FROM "TelegramExamSubmission" child WHERE NOT EXISTS (SELECT 1 FROM "Student" parent WHERE parent."id" = child."studentId")`,
  },
  {
    label: "TelegramExamSubmission.examId -> Exam.id",
    tables: ["TelegramExamSubmission", "Exam"],
    sql: `SELECT COUNT(*)::int AS count FROM "TelegramExamSubmission" child WHERE NOT EXISTS (SELECT 1 FROM "Exam" parent WHERE parent."id" = child."examId")`,
  },
  {
    label: "TelegramExamSubmission.gradeId -> Grade.id",
    tables: ["TelegramExamSubmission", "Grade"],
    sql: `SELECT COUNT(*)::int AS count FROM "TelegramExamSubmission" child WHERE child."gradeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Grade" parent WHERE parent."id" = child."gradeId")`,
  },
];

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  statement_timeout: 30_000,
  application_name: "teacherpro-schema-preflight",
});

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");

  const tableRows = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`,
  );
  const availableTables = new Set(
    tableRows.rows.map((row) => String(row.table_name)),
  );
  const blockers = [];
  let executedChecks = 0;

  for (const check of checks) {
    if (!check.tables.every((table) => availableTables.has(table))) continue;
    const result = await client.query(check.sql);
    const count = Number(result.rows[0]?.count || 0);
    executedChecks += 1;
    if (count > 0) blockers.push({ label: check.label, count });
  }

  await client.query("ROLLBACK");

  if (blockers.length > 0) {
    console.error(
      "[TeacherPro Schema Preflight] Migration blocked by legacy orphan rows:",
    );
    for (const blocker of blockers) {
      console.error(`- ${blocker.label}: ${blocker.count}`);
    }
    console.error(
      "Review and repair these rows explicitly. The preflight did not change any data.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `[TeacherPro Schema Preflight] ${executedChecks} read-only relation checks passed.`,
    );
  }
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The connection may have failed before a transaction was opened.
  }
  console.error(
    "[TeacherPro Schema Preflight] Read-only audit failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
