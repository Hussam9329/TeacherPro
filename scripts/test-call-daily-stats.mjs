#!/usr/bin/env node
// «إحصائيات المكالمات»: each employee's actions by course and each course
// against its daily target, counted from the calls log of one Baghdad day.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(file) {
  const out = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", out)(module.exports, require, module);
  return module.exports;
}

const { buildCallDailyStats, baghdadDayRange, CALL_ACTION_SET, CALL_ACTION_CLEARED } = load("src/lib/call-daily-stats.ts");
const line = (time, user, studentId, examId, status, action = CALL_ACTION_SET) => ({
  time, action, userId: user.id, userName: user.name,
  details: JSON.stringify({ studentId, examId, status, previousStatus: "بدون إجراء" }),
});
const ali = { id: "u1", name: "علي" };
const sara = { id: "u2", name: "سارة" };

const stats = buildCallDailyStats({
  lines: [
    line("2026-10-11T06:00:00Z", ali, "s1", "e1", "لم يرد"),
    line("2026-10-11T06:05:00Z", ali, "s1", "e1", "تم الاتصال"), // same call again: still one action
    line("2026-10-11T07:00:00Z", ali, "s2", "e1", "تم الاتصال"),
    line("2026-10-11T07:10:00Z", ali, "s3", "e1", "تم الاتصال"),
    line("2026-10-11T07:20:00Z", ali, "s3", "e1", "بدون إجراء", CALL_ACTION_CLEARED), // cleared by the end: none
    line("2026-10-11T08:00:00Z", sara, "s1", "e1", "الرقم خاطئ"), // another employee on the same call: one more
    line("2026-10-11T08:30:00Z", sara, "s4", "e2", "لم يرد"),
    { time: "2026-10-11T09:00:00Z", action: "إضافة ملاحظة مكالمات", userId: "u2", userName: "سارة", details: JSON.stringify({ studentId: "s4" }) },
  ],
  studentCourse: new Map([["s1", "c1"], ["s2", "c1"], ["s3", "c2"], ["s4", "c2"]]),
  courses: [{ id: "c1", name: "صيفية اولى" }, { id: "c2", name: "شتوية ثانية" }, { id: "c3", name: "اعفاء" }],
  targets: new Map([["c1", 10], ["c2", 1]]),
  targetExams: new Map([["c1", "امتحان 7"]]),
});
assert.equal(stats.courses[0].examName, "امتحان 7");

// Most actions first; a tie in alphabetical order.
assert.deepEqual(stats.employees.map((employee) => [employee.name, employee.total]), [["سارة", 2], ["علي", 2]]);
const byName = (name) => stats.employees.find((employee) => employee.name === name);
assert.deepEqual(byName("علي").courses, [{ id: "c1", name: "صيفية اولى", count: 2 }]);
assert.deepEqual(byName("سارة").courses.map((course) => [course.name, course.count]).sort(), [["شتوية ثانية", 1], ["صيفية اولى", 1]]);
assert.deepEqual(byName("علي").statuses, [{ status: "تم الاتصال", count: 2 }]);
assert.deepEqual(stats.courses.map((course) => [course.name, course.target, course.done, course.remaining]), [
  ["صيفية اولى", 10, 3, 7],
  ["شتوية ثانية", 1, 1, 0],
  ["اعفاء", null, 0, 0],
]);
assert.equal(stats.courses[0].rate, 0.3);
assert.equal(stats.courses[2].rate, null);
assert.deepEqual(stats.totals, { target: 11, done: 4, remaining: 7, rate: 4 / 11 });
// The employees add up to the courses.
assert.equal(stats.employees.reduce((sum, employee) => sum + employee.total, 0), stats.totals.done);

// A Baghdad day is 21:00 UTC the day before to 21:00 UTC that day.
const range = baghdadDayRange("2026-10-11");
assert.equal(range.from.toISOString(), "2026-10-10T21:00:00.000Z");
assert.equal(range.to.toISOString(), "2026-10-11T21:00:00.000Z");
assert.equal(baghdadDayRange("11-10-2026"), null);

// Only the admin and the supervisors read it. The required number is the
// «المخصومين» count «المكالمات» shows for the course's latest exam on the day,
// recorded on its own; today follows the list, a past day keeps its number.
const route = read("src/app/api/student-calls/daily-stats/route.ts");
assert.ok(route.includes("if (!oversees(principal))"));
assert.ok(route.includes('statusFilter: "discounted"') && route.includes('import { GET as callCandidates } from "../candidates/route";'));
assert.ok(route.includes("if (saved && day !== today)") && route.includes("db.callDailyTarget.upsert"));
assert.ok(!route.includes("export async function PUT"), "nobody types the required number");
assert.ok(route.includes('action: { in: [CALL_ACTION_SET, CALL_ACTION_CLEARED] }'));
const dashboard = read("src/components/teacher-pro/dashboard.tsx");
assert.ok(dashboard.includes('actor.permissions?.includes("system.oversight")') && dashboard.includes("canSeeStats={canSeeCallStats}"));
const calls = read("src/app/api/student-calls/route.ts");
assert.ok(calls.includes('"المكالمات", data.status ? "تحديث حالة مكالمة" : "مسح حالة مكالمة"'), "every status set or cleared is logged");
const migration = read("prisma/migrations/20261011120000_call_daily_targets/migration.sql");
const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
assert.equal(policy["20261011120000_call_daily_targets"].kind, "expand");
assert.equal(policy["20261011150000_call_daily_target_exam"].kind, "expand");
assert.ok(migration.includes('CREATE TABLE "CallDailyTarget"') && !/\bDROP\b/i.test(migration.replace(/--[^\n]*/g, "")));

console.log("كل اختبارات إحصائيات المكالمات نجحت.");
