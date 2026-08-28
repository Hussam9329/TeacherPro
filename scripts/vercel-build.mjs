import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

function fail(message) {
  console.error(`\n[TeacherPro Deploy] ${message}\n`);
  process.exit(1);
}

function localBinary(name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return path.join(process.cwd(), "node_modules", ".bin", `${name}${suffix}`);
}

function run(name, args, env = process.env) {
  console.log(`\n[TeacherPro Deploy] ${name} ${args.join(" ")}\n`);
  const result = spawnSync(localBinary(name), args, {
    stdio: "inherit",
    env,
    shell: false,
  });
  if (result.error) fail(`${name} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${name} exited with code ${result.status ?? "unknown"}. Deployment stopped before incompatible code could go live.`);
}

function runNode(script, env = process.env) {
  console.log(`\n[TeacherPro Deploy] node ${script}\n`);
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    env,
    shell: false,
  });
  if (result.error) fail(`${script} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${script} exited with code ${result.status ?? "unknown"}. Deployment stopped without changing legacy data.`);
}

run("prisma", ["generate"]);

// Compile first. If application compilation fails, the production database is
// left untouched and the previous deployment keeps running on its old schema.
run("next", ["build"]);

// A production deployment is valid only when its migrations run in the same
// guarded build. Preview/local builds may compile without touching a database.
const migrationsEnabled =
  String(process.env.TEACHERPRO_RUN_MIGRATIONS || "").trim() === "true";
const isVercelProduction =
  String(process.env.VERCEL_ENV || "").trim() === "production";

if (!migrationsEnabled && isVercelProduction) {
  fail("Production requires TEACHERPRO_RUN_MIGRATIONS=true. Deployment stopped before code/schema divergence.");
}

if (!migrationsEnabled) {
  console.log("\n[TeacherPro Deploy] Database migrations skipped (explicit opt-in not enabled).\n");
  process.exit(0);
}

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  fail("DATABASE_URL is required only when TEACHERPRO_RUN_MIGRATIONS=true.");
}

// Use a direct, non-pooler URL for DDL when supplied (Neon/Supabase/etc.).
// Prisma still uses DATABASE_URL at runtime; only the migration command is
// redirected to DIRECT_URL here.
// لو DIRECT_URL غير موجود، نحاول تحويل pooler URL إلى direct تلقائياً.
function deriveDirectUrl(url) {
  if (!url) return "";
  // Neon: -pooler.→ -.
  let derived = url.replace(/-pooler\./, ".");
  // Supabase: port 6543 → 5432
  derived = derived.replace(/:6543\//, ":5432/");
  // Vercel Postgres: لا يحتاج تحويل
  return derived;
}

const directUrl = String(process.env.DIRECT_URL || "").trim() || deriveDirectUrl(databaseUrl);
function redactDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "configured-user";
    if (parsed.password) parsed.password = "configured-password";
    return parsed.toString();
  } catch {
    return "configured database URL";
  }
}

console.log(`\n[TeacherPro Deploy] Using migration URL: ${redactDatabaseUrl(directUrl)}\n`);

// Neon auto-suspends idle databases after ~5 min. The first connection takes
// longer than the 10s pg_advisory_lock timeout, so we warm up the DB with a
// trivial SELECT 1 before running migrations. We retry the warmup a few times
// because Neon can take 10-20s to fully wake.
function warmupDatabase(url) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`\n[TeacherPro Deploy] Warming up database (attempt ${attempt}/${maxAttempts})...\n`);
    const result = spawnSync("node", ["-e", `
      const { Client } = require('pg');
      const client = new Client({ connectionString: process.argv[1], ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });
      client.connect()
        .then(() => client.query('SELECT 1'))
        .then(() => client.end())
        .then(() => { console.log('warmup ok'); process.exit(0); })
        .catch((err) => { console.error('warmup error:', err.message); process.exit(1); });
    `, url], {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
    if (result.status === 0) {
      console.log(`\n[TeacherPro Deploy] Database warmed up successfully.\n`);
      return true;
    }
    if (attempt < maxAttempts) {
      console.log(`\n[TeacherPro Deploy] Warmup failed, waiting 3s before retry...\n`);
      spawnSync("sleep", ["3"], { stdio: "inherit" });
    }
  }
  return false;
}

const RECOVERABLE_IDEMPOTENT_MIGRATIONS = [
  "20260712143000_grade_exam_integrity",
  "20260712190000_atomic_student_codes_and_active_chapter_guard",
  "20260712220000_student_enrollment_archives",
  "20260712234500_operational_integrity_hardening",
  "20260828010000_unify_dismissal_and_zero_balance",
  "20260828034500_single_dismissal_policy",
];

const INITIAL_SCHEMA_BRIDGE = "20260601000000_initial_schema_bridge";

function getInitialSchemaBridgeState(url) {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      `
        const { Client } = require("pg");
        const client = new Client({
          connectionString: process.env.TEACHERPRO_MIGRATION_PROBE_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 30000,
        });
        const coreTables = ["Course", "Student", "Exam", "Grade", "AuditLog"];
        (async () => {
          await client.connect();
          const tables = await client.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[])",
            [coreTables],
          );
          let migrationApplied = false;
          try {
            const migration = await client.query(
              'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1',
              [process.env.TEACHERPRO_MIGRATION_PROBE_NAME],
            );
            migrationApplied = migration.rowCount > 0;
          } catch (error) {
            if (!error || error.code !== "42P01") throw error;
          }
          if (migrationApplied) process.exitCode = 40;
          else if (tables.rowCount === 0) process.exitCode = 41;
          else if (tables.rowCount === coreTables.length) process.exitCode = 42;
          else {
            console.error("partial base schema:", tables.rows.map((row) => row.table_name).sort().join(", "));
            process.exitCode = 43;
          }
          await client.end();
        })().catch(async (error) => {
          console.error("initial baseline probe error:", error.message);
          await client.end().catch(() => undefined);
          process.exit(1);
        });
      `,
    ],
    {
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        TEACHERPRO_MIGRATION_PROBE_URL: url,
        TEACHERPRO_MIGRATION_PROBE_NAME: INITIAL_SCHEMA_BRIDGE,
      },
    },
  );

  if (probe.error) fail(`Initial baseline probe failed to start: ${probe.error.message}`);
  if (probe.status === 40) return "applied";
  if (probe.status === 41) return "empty";
  if (probe.status === 42) return "existing";
  if (probe.status === 43) {
    fail("The database has a partial base schema. Initial baseline was not marked applied and migrations were not started.");
  }
  fail(`Initial baseline probe exited with code ${probe.status ?? "unknown"}.`);
}

/**
 * A production deployment can be interrupted after an idempotent migration
 * starts but before Prisma marks it complete. Recover only the exact, reviewed
 * migrations above; unknown failed migrations must still stop deployment for
 * manual review.
 */
function hasUnresolvedKnownMigration(url, migrationName) {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      `
        const { Client } = require("pg");
        const client = new Client({
          connectionString: process.env.TEACHERPRO_MIGRATION_PROBE_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 30000,
        });
        (async () => {
          await client.connect();
          try {
            const result = await client.query(
              'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL LIMIT 1',
              [process.env.TEACHERPRO_MIGRATION_PROBE_NAME],
            );
            process.exitCode = result.rowCount > 0 ? 42 : 0;
          } catch (error) {
            if (error && error.code === "42P01") process.exitCode = 0;
            else throw error;
          } finally {
            await client.end();
          }
        })().catch((error) => {
          console.error("migration probe error:", error.message);
          process.exit(1);
        });
      `,
    ],
    {
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        TEACHERPRO_MIGRATION_PROBE_URL: url,
        TEACHERPRO_MIGRATION_PROBE_NAME: migrationName,
      },
    },
  );

  if (probe.error) {
    fail(`Migration recovery probe failed to start: ${probe.error.message}`);
  }
  if (probe.status === 42) return true;
  if (probe.status !== 0) {
    fail(`Migration recovery probe exited with code ${probe.status ?? "unknown"}.`);
  }
  return false;
}

if (!warmupDatabase(directUrl)) {
  fail("Could not connect to the database after 5 attempts. The deployment is stopped to prevent code/schema divergence. Check DATABASE_URL/DIRECT_URL and database availability.");
}

const migrationEnv = {
  ...process.env,
  DATABASE_URL: directUrl,
};

runNode("scripts/preflight-schema-reconciliation.mjs", migrationEnv);

const initialSchemaBridgeState = getInitialSchemaBridgeState(directUrl);
if (initialSchemaBridgeState === "existing") {
  console.log(
    `\n[TeacherPro Deploy] Baselining existing production schema: ${INITIAL_SCHEMA_BRIDGE}\n`,
  );
  run(
    "prisma",
    ["migrate", "resolve", "--applied", INITIAL_SCHEMA_BRIDGE],
    migrationEnv,
  );
}

for (const migrationName of RECOVERABLE_IDEMPOTENT_MIGRATIONS) {
  if (hasUnresolvedKnownMigration(directUrl, migrationName)) {
    console.log(
      `\n[TeacherPro Deploy] Recovering known interrupted migration: ${migrationName}\n`,
    );
    run(
      "prisma",
      ["migrate", "resolve", "--rolled-back", migrationName],
      migrationEnv,
    );
  }
}

// Vercel publishes only after this whole build command succeeds. Therefore a
// migration failure keeps the previous deployment active instead of allowing
// code and database schema to diverge.
run("prisma", ["migrate", "deploy"], migrationEnv);
run("prisma", ["migrate", "status"], migrationEnv);
