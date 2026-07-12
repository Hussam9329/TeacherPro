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
const migrationEnv = {
  ...process.env,
  DATABASE_URL: directUrl,
};

// Vercel publishes only after this whole build command succeeds. Therefore a
// migration failure keeps the previous deployment active instead of allowing
// code and database schema to diverge.
run("prisma", ["migrate", "deploy"], migrationEnv);
