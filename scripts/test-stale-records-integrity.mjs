// «فحص الحسابات»: a saved record that differs from the calculation (a result
// written to the database outside the app, or an input changed without a
// recalculation) is found, shown, and healed through the ordinary path.
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const server = read("src/lib/academic-recalculate-server.ts");
const route = read("src/app/api/students/stale-records/route.ts");
const trace = read("src/app/api/students/bonus-trace/route.ts");
const cron = read("src/app/api/internal/academic-maintenance/route.ts");
const dialog = read("src/components/teacher-pro/stale-records-dialog.tsx");
const page = read("src/components/teacher-pro/opportunities.tsx");
const pkg = JSON.parse(read("package.json"));
let count = 0;
const check = (name, fn) => { fn(); count += 1; console.log(`✅ ${name}`); };

check("one comparison decides «stale» for the scan, the heal and the explanation", () => {
  assert.match(server, /export function isAcademicRecordStale\(/);
  for (const field of ["opportunities", "status", "bonuses", "bonusProgress"]) {
    assert.match(server, new RegExp(`record\\.stored\\.${field} !== record\\.replay\\.${field}`));
  }
  assert.match(trace, /isAcademicRecordStale\(before\)/);
});

check("the scan is read-only: it replays and compares, it never persists", () => {
  const scan = server.slice(server.indexOf("export async function scanStaleAcademicRecords"), server.indexOf("export async function healStaleAcademicRecords("));
  assert.match(scan, /recalculateAcademicState\(state, new Set\(ids\)\)/);
  assert.doesNotMatch(scan, /persist|recalculateStudentsAcademicState|\.update\(|\.create\(/);
});

check("healing goes through the same recalculation a grade save runs, only for students still stale", () => {
  const heal = server.slice(server.indexOf("export async function healStaleAcademicRecords("), server.indexOf("export async function healStaleAcademicRecordsWithin"));
  assert.match(heal, /scanStaleAcademicRecords\(db, \{ studentIds \}\)/);
  assert.match(heal, /recalculateStudentsAcademicState\(group\)/);
});

check("the scan and the fix need «صيانة النظام الشاملة»; the fix is limited, rate limited and audited", () => {
  assert.equal((route.match(/requirePermissionPrincipal\(req, "system\.maintenance"\)/g) || []).length, 2);
  assert.match(route, /MAX_FIX = 100/);
  assert.match(route, /checkApiRateLimit\(req, API_RATE_LIMITS\.studentOpportunitySync\)/);
  assert.match(route, /writeRequestAuditLog\(req, "إدارة الفرص"/);
});

check("the nightly maintenance heals stale records within its time budget and records it", () => {
  assert.match(cron, /healStaleAcademicRecordsWithin\(\{/);
  assert.match(cron, /deadline: startedAt \+ 90_000/);
  assert.match(cron, /writeSystemAuditLog\("إدارة الفرص", "إصلاح تلقائي لطلاب ما يطابق محفوظهم الحساب"/);
  assert.match(cron, /isAuthorizedCron\(req\)/);
});

check("«فحص الحسابات» is on the opportunities page, for maintenance staff only", () => {
  assert.match(page, /<StaleRecordsDialog courseName=\{courseName\}/);
  assert.match(dialog, /permissions\?\.includes\("system\.maintenance"\)/);
  assert.match(dialog, /if \(!allowed\) return null;/);
});

check("the test is part of the side-effects suite", () => {
  assert.match(pkg.scripts["test:side-effects"], /test:stale-records-integrity/);
});

console.log(`stale records integrity: ${count} checks passed`);
