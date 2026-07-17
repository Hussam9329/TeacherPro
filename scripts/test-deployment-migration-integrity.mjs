import fs from "node:fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const pkg = JSON.parse(read("package.json"));
const buildScript = read("scripts/vercel-build.mjs");
const academicRepairRoute = read("src/app/api/students/academic-repair/route.ts");
const routeHelpers = read("src/lib/route-helpers.ts");
const studentsRoute = read("src/app/api/students/route.ts");
const api = read("src/lib/api.ts");
const outbox = read("src/lib/mutation-outbox.ts");
const examSchema = read("src/lib/exam-schema.ts");
const gradeExamMigration = read(
  "prisma/migrations/20260712143000_grade_exam_integrity/migration.sql",
);
const missingRuntimeColumnsMigration = read(
  "prisma/migrations/20260712185000_missing_runtime_columns/migration.sql",
);
const academicSchema = read("src/lib/academic-schema.ts");
const gracePeriodMigration = read(
  "prisma/migrations/20260713220000_grace_period_start_date/migration.sql",
);
const schemaRepairLock = read("src/lib/schema-repair-lock.ts");
const examStatsRoute = read("src/app/api/exams/stats/route.ts");

check(
  pkg.scripts?.["vercel-build"] === "node scripts/vercel-build.mjs",
  "Vercel uses the guarded deployment runner",
);
check(
  pkg.scripts?.build === "node scripts/vercel-build.mjs" &&
    typeof pkg.scripts?.["build:app"] === "string",
  "both default and Vercel builds use the guarded migration runner",
);
check(
  buildScript.includes('["prisma", ["migrate", "deploy"]') ||
    buildScript.includes('run("prisma", ["migrate", "deploy"]'),
  "deployment runs prisma migrate deploy",
);
check(
  buildScript.includes("DIRECT_URL") && buildScript.includes("DATABASE_URL"),
  "deployment supports direct migration URL and requires database URL",
);
check(
  buildScript.includes("hasUnresolvedKnownMigration") &&
    buildScript.includes("20260712143000_grade_exam_integrity") &&
    buildScript.includes("20260712190000_atomic_student_codes_and_active_chapter_guard") &&
    buildScript.includes("20260712220000_student_enrollment_archives") &&
    buildScript.includes('"--rolled-back"'),
  "deployment safely recovers every known interrupted idempotent migration",
);
const migrationColumnCreation = gradeExamMigration.indexOf(
  'ADD COLUMN IF NOT EXISTS "scheduledActivateAt"',
);
const migrationColumnUse = gradeExamMigration.indexOf(
  '"scheduledActivateAt" = NULL',
);
check(
  migrationColumnCreation >= 0 &&
    migrationColumnUse >= 0 &&
    migrationColumnCreation < migrationColumnUse,
  "grade/exam migration creates scheduling columns before using them",
);
check(
  examSchema.includes('ADD COLUMN IF NOT EXISTS "scheduledActivateAt"') &&
    examSchema.includes('ADD COLUMN IF NOT EXISTS "scheduledDeactivateAt"'),
  "runtime Exam schema repair includes both scheduling columns",
);
for (const requiredColumn of [
  '"baseOpportunities"',
  '"accountingGraceDays"',
  '"nameKey"',
  '"phoneKey"',
  '"telegramKey"',
  '"archived"',
  '"archive"',
]) {
  check(
    missingRuntimeColumnsMigration.includes(`ADD COLUMN IF NOT EXISTS ${requiredColumn}`) &&
      academicSchema.includes(`ADD COLUMN IF NOT EXISTS ${requiredColumn}`),
    `missing runtime column ${requiredColumn} is repaired by migration and runtime guard`,
  );
}
check(
  gracePeriodMigration.includes('ADD COLUMN IF NOT EXISTS "gracePeriodStartDate"') &&
    academicSchema.includes('ADD COLUMN IF NOT EXISTS "gracePeriodStartDate"'),
  "gracePeriodStartDate is repaired by migration and runtime guard",
);
check(
  academicRepairRoute.includes("removeProtectedAbsencesForStudents") &&
    academicRepairRoute.includes('where: { status: "غائب" }'),
  "administrative repair removes historical protected absences before recalculation",
);
check(
  schemaRepairLock.includes("pg_advisory_xact_lock") &&
    schemaRepairLock.includes("db.$transaction"),
  "runtime DDL is serialized across serverless instances",
);
check(
  examStatsRoute.includes("await ensureExamSchema()"),
  "exam statistics repairs required schema before its first Prisma query",
);
check(
  buildScript.indexOf('run("next", ["build"]') <
    buildScript.indexOf('run("prisma", ["migrate", "deploy"]'),
  "application compiles before the production database is changed",
);
check(
  routeHelpers.includes("DATABASE_MIGRATION_REQUIRED") &&
    routeHelpers.includes("X-TeacherPro-Retryable") &&
    routeHelpers.includes("retryable: false"),
  "schema mismatch response is structured and explicitly non-retryable",
);
check(
  (studentsRoute.match(/databaseMigrationRequiredResponse\(/g) || []).length >= 2,
  "student create and update use the protected migration response",
);
check(
  api.includes("isTransientHttpResponse") &&
    (api.match(/transient: isTransientHttpResponse\(res\)/g) || []).length >= 3,
  "POST/PUT/DELETE retry logic honors server retryability",
);
check(
  outbox.includes("responseIsExplicitlyNonRetryable") &&
    outbox.includes("sameQueuedMutation") &&
    outbox.includes("dedupeQueuedMutations(readOutbox())") &&
    outbox.includes("x-teacherpro-retryable"),
  "persistent outbox drops schema mismatch and deduplicates new and historical mutations",
);

if (process.exitCode) process.exit(process.exitCode);
console.log("Deployment migration integrity checks passed.");
