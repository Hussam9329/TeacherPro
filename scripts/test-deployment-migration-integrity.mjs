import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const reconciliationMigrationName =
  "20260820140000_schema_authority_reconciliation";
const requiredRuntimeMigrationName =
  "20260828034500_single_dismissal_policy";
const graceTerminationMigrationName =
  "20260822210000_end_grace_on_numeric_grade";
const initialBridgeMigrationName = "20260601000000_initial_schema_bridge";
const recoveredOperationalMigrationName =
  "20260712234500_operational_integrity_hardening";
const reconciliationMigrationPath = path.join(
  "prisma/migrations",
  reconciliationMigrationName,
  "migration.sql",
);

const pkg = JSON.parse(read("package.json"));
const buildScript = read("scripts/vercel-build.mjs");
const preflightScript = read("scripts/preflight-schema-reconciliation.mjs");
const schemaReadiness = read("src/lib/schema-readiness.ts");
const routeHelpers = read("src/lib/route-helpers.ts");
const prismaSchema = read("prisma/schema.prisma");
const reconciliationMigration = read(reconciliationMigrationPath);
const initialBridgeMigration = read(
  path.join("prisma/migrations", initialBridgeMigrationName, "migration.sql"),
);
const recoveredOperationalMigration = read(
  path.join(
    "prisma/migrations",
    recoveredOperationalMigrationName,
    "migration.sql",
  ),
);
const migrationLock = read("prisma/migrations/migration_lock.toml");
const examStatsRoute = read("src/app/api/exams/stats/route.ts");
const opportunityLogsRoute = read("src/app/api/opportunity-logs/route.ts");
const clearLogsRoute = read("src/app/api/logs/clear/route.ts");
const restoreLogsRoute = read("src/app/api/logs/restore/route.ts");
const studentsRoute = read("src/app/api/students/route.ts");
const bulkStudentsRoute = read("src/app/api/students/bulk/route.ts");

const runtimeFiles = [
  ...walk(path.join(root, "src/app")),
  ...walk(path.join(root, "src/lib")),
].filter((file) => /\.(?:ts|tsx)$/.test(file));
const runtimeDdlPattern =
  /\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|CONSTRAINT|COLUMN|SEQUENCE|TYPE|VIEW|SCHEMA|FUNCTION|TRIGGER|EXTENSION)\b/i;
const runtimeDdlFiles = runtimeFiles
  .filter((file) => runtimeDdlPattern.test(fs.readFileSync(file, "utf8")))
  .map((file) => path.relative(root, file));

check(
  pkg.scripts?.build === "node scripts/vercel-build.mjs" &&
    pkg.scripts?.["vercel-build"] === "node scripts/vercel-build.mjs",
  "default and Vercel builds use the guarded deployment runner",
);
check(
  pkg.scripts?.["db:migrate"] === "prisma migrate dev" &&
    pkg.scripts?.["db:deploy"] === "prisma migrate deploy" &&
    pkg.scripts?.["db:status"] === "prisma migrate status" &&
    pkg.scripts?.["db:push"] === undefined &&
    pkg.scripts?.["db:baseline:existing"] === undefined,
  "package scripts expose migration workflows without db push or blind baselining",
);
check(
  buildScript.includes("isVercelProduction") &&
    buildScript.includes("Production requires TEACHERPRO_RUN_MIGRATIONS=true") &&
    buildScript.indexOf('run("next", ["build"]') <
      buildScript.indexOf('run("prisma", ["migrate", "deploy"]') &&
    buildScript.indexOf('run("prisma", ["migrate", "deploy"]') <
      buildScript.indexOf('run("prisma", ["migrate", "status"]'),
  "production compiles, deploys migrations, verifies status, and refuses migration-disabled publication",
);
check(
  buildScript.includes('runNode("scripts/preflight-schema-reconciliation.mjs"') &&
    buildScript.indexOf('runNode("scripts/preflight-schema-reconciliation.mjs"') <
      buildScript.indexOf('run("prisma", ["migrate", "deploy"]') &&
    preflightScript.includes('await client.query("BEGIN READ ONLY")') &&
    preflightScript.includes("legacy orphan rows") &&
    preflightScript.includes("StudentEnrollmentArchive.studentId -> Student.id") &&
    !/\b(?:DELETE|UPDATE|INSERT)\b\s+(?:FROM|INTO|\")/i.test(preflightScript),
  "a read-only orphan preflight blocks unsafe constraint reconciliation before migration deploy",
);
check(
  buildScript.includes('INITIAL_SCHEMA_BRIDGE = "20260601000000_initial_schema_bridge"') &&
    buildScript.includes("getInitialSchemaBridgeState") &&
    buildScript.includes('["migrate", "resolve", "--applied", INITIAL_SCHEMA_BRIDGE]') &&
    buildScript.includes('initialSchemaBridgeState === "existing"'),
  "existing production is explicitly baselined while an empty database executes the bridge migration",
);
check(
  buildScript.includes(`"${recoveredOperationalMigrationName}"`) &&
    buildScript.includes('["migrate", "resolve", "--rolled-back", migrationName]') &&
    recoveredOperationalMigration.includes('CREATE OR REPLACE FUNCTION "guard_student_leave_integrity"()') &&
    recoveredOperationalMigration.includes('CREATE TABLE IF NOT EXISTS "TelegramExamSubmissionVersion"'),
  "the exact historical interrupted migration is present and recoverable through its reviewed idempotent path",
);
check(
  buildScript.includes('"20260828010000_unify_dismissal_and_zero_balance"') &&
    buildScript.includes(`"${requiredRuntimeMigrationName}"`),
  "the reviewed unified-dismissal migrations can recover after interrupted idempotent runs",
);
check(
  buildScript.includes("DIRECT_URL") &&
    buildScript.includes("redactDatabaseUrl") &&
    !buildScript.includes('replace(/:[^:@]+@/'),
  "deployment uses a direct migration URL when available and safely redacts credentials",
);
check(
  schemaReadiness.includes(requiredRuntimeMigrationName) &&
    schemaReadiness.includes('FROM "_prisma_migrations"') &&
    schemaReadiness.includes('"finished_at" IS NOT NULL') &&
    schemaReadiness.includes('"rolled_back_at" IS NULL') &&
    !schemaReadiness.includes("$executeRaw"),
  "runtime readiness is a cached read-only check for the reconciliation migration",
);
check(
  prismaSchema.includes("gracePeriodEndedAt DateTime?") &&
    read(
      path.join(
        "prisma/migrations",
        graceTerminationMigrationName,
        "migration.sql",
      ),
    ).includes('ADD COLUMN IF NOT EXISTS "gracePeriodEndedAt"'),
  "numeric-grade grace termination is versioned in the schema migration history",
);
check(
  runtimeDdlFiles.length === 0,
  `application runtime contains no schema DDL${runtimeDdlFiles.length ? `: ${runtimeDdlFiles.join(", ")}` : ""}`,
);
for (const retiredFile of [
  "src/lib/academic-schema.ts",
  "src/lib/exam-schema.ts",
  "src/lib/followup-schema.ts",
  "src/lib/grade-entry-missing-note-schema.ts",
  "src/lib/telegram-submission-schema.ts",
  "src/lib/schema-repair-lock.ts",
]) {
  check(!fs.existsSync(path.join(root, retiredFile)), `${retiredFile} is retired`);
}
check(
  initialBridgeMigration.includes('CREATE TABLE IF NOT EXISTS "Course"') &&
    initialBridgeMigration.includes('CREATE TABLE IF NOT EXISTS "Student"') &&
    initialBridgeMigration.includes('CREATE TABLE IF NOT EXISTS "Exam"') &&
    initialBridgeMigration.includes('CREATE TABLE IF NOT EXISTS "Grade"') &&
    initialBridgeMigration.includes('CREATE TABLE IF NOT EXISTS "AuditLog"') &&
    migrationLock.includes('provider = "postgresql"'),
  "migration history can bootstrap an empty PostgreSQL database before historical ALTER migrations",
);
check(
  prismaSchema.includes("model LogClearBackup") &&
    reconciliationMigration.includes('CREATE TABLE IF NOT EXISTS "LogClearBackup"') &&
    reconciliationMigration.includes('CREATE SEQUENCE IF NOT EXISTS "Student_code_seq"') &&
    reconciliationMigration.includes("TeacherPro schema reconciliation failed") &&
    reconciliationMigration.includes("Grade_enforce_status_score_consistency") &&
    reconciliationMigration.includes("Grade_status_score_consistency") &&
    reconciliationMigration.includes('VALIDATE CONSTRAINT "StudentEnrollmentArchive_studentId_fkey"') &&
    reconciliationMigration.includes('VALIDATE CONSTRAINT "StudentLeave_studentId_fkey"'),
  "the final runtime-only objects and compatibility constraints are versioned and sealed by migration",
);
check(
  routeHelpers.includes("DATABASE_MIGRATION_REQUIRED") &&
    routeHelpers.includes("isDatabaseMigrationRequiredError") &&
    routeHelpers.includes("databaseMigrationRequiredResponse") &&
    routeHelpers.includes("X-TeacherPro-Retryable"),
  "schema mismatch responses are structured 503 errors and explicitly non-retryable",
);
check(
  examStatsRoute.includes("await assertDatabaseSchemaReady()") &&
    opportunityLogsRoute.includes("await assertDatabaseSchemaReady()") &&
    clearLogsRoute.includes("await assertDatabaseSchemaReady()") &&
    restoreLogsRoute.includes("await assertDatabaseSchemaReady()") &&
    studentsRoute.includes("await assertDatabaseSchemaReady()") &&
    bulkStudentsRoute.includes("await assertDatabaseSchemaReady()") &&
    !opportunityLogsRoute.includes("$executeRawUnsafe"),
  "representative read, statistics, and destructive routes use the read-only schema guard",
);

if (process.exitCode) process.exit(process.exitCode);
console.log("Deployment migration integrity checks passed.");
