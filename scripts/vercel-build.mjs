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

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  fail("DATABASE_URL is missing. Add it to the Vercel Production/Preview environment; builds are intentionally blocked without the real database so schema migrations cannot be skipped.");
}

run("prisma", ["generate"]);

// Compile first. If application compilation fails, the production database is
// left untouched and the previous deployment keeps running on its old schema.
run("next", ["build"]);

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
console.log(`\n[TeacherPro Deploy] Using migration URL: ${directUrl.replace(/:[^:@]+@/, ":****@")}\n`);

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
];

/**
 * The original form of the grade/exam migration referenced Exam scheduling
 * columns before creating them. If a production deployment already attempted
 * that file, Prisma records it as failed and refuses every later deployment
 * with P3009. Recover only that exact, known, idempotent migration; unknown
 * failed migrations must still stop deployment for manual review.
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
