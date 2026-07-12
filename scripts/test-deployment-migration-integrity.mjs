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
const routeHelpers = read("src/lib/route-helpers.ts");
const studentsRoute = read("src/app/api/students/route.ts");
const api = read("src/lib/api.ts");
const outbox = read("src/lib/mutation-outbox.ts");

check(
  pkg.scripts?.["vercel-build"] === "node scripts/vercel-build.mjs",
  "Vercel uses the guarded deployment runner",
);
check(
  buildScript.includes('["migrate", "deploy"]'),
  "deployment runs prisma migrate deploy",
);
check(
  buildScript.includes("DIRECT_URL") && buildScript.includes("DATABASE_URL"),
  "deployment supports direct migration URL and requires database URL",
);
check(
  buildScript.indexOf('run("next", ["build"]') <
    buildScript.indexOf('["migrate", "deploy"]'),
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
