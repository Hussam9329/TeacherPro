import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

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

// Vercel publishes only after this whole build command succeeds. Therefore a
// migration failure keeps the previous deployment active instead of allowing
// code and database schema to diverge.
// Neon pools auto-suspend after ~5 min of inactivity, so the first migration
// attempt may time out on pg_advisory_lock while the DB wakes up. Retry up
// to 3 times with a longer timeout before giving up.
const migrationEnv = {
  ...process.env,
  DATABASE_URL: directUrl,
  // Give Neon time to wake up + run DDL.
  MIGRATE_TIMEOUT: "120000",
};

let migrationOk = false;
let lastMigrationError = "";
for (let attempt = 1; attempt <= 3 && !migrationOk; attempt += 1) {
  if (attempt > 1) {
    console.log(`\n[TeacherPro Deploy] Retrying migration (attempt ${attempt}/3)...\n`);
    // Give Neon a moment to finish waking up.
    spawnSync("sleep", ["3"], { stdio: "inherit" });
  }
  console.log(`\n[TeacherPro Deploy] prisma migrate deploy (attempt ${attempt}/3)\n`);
  const result = spawnSync(localBinary("prisma"), ["migrate", "deploy"], {
    stdio: "inherit",
    env: migrationEnv,
    shell: false,
  });
  if (result.status === 0) {
    migrationOk = true;
    break;
  }
  lastMigrationError = `prisma migrate deploy exited with code ${result.status ?? "unknown"}`;
  if (result.error) {
    lastMigrationError = `prisma failed to start: ${result.error.message}`;
  }
}

if (!migrationOk) {
  fail(`${lastMigrationError}. Deployment stopped before incompatible code could go live.`);
}
