#!/usr/bin/env node
// «إحصائيات المكالمات»: cumulative and final exams only. Each employee's
// actions of one Baghdad day by course, and each course against one number
// for its latest cumulative exam, with the work done on it up to that day.
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

const { buildCallDailyStats, baghdadDayRange, isCallStatsExamType, CALL_ACTION_SET, CALL_ACTION_CLEARED } = load("src/lib/call-daily-stats.ts");
const line = (time, user, studentId, examId, status, action = CALL_ACTION_SET) => ({
  time, action, userId: user.id, userName: user.name,
  details: JSON.stringify({ studentId, examId, status, previousStatus: "بدون إجراء" }),
});
const ali = { id: "u1", name: "علي" };
const sara = { id: "u2", name: "سارة" };

assert.ok(isCallStatsExamType("تراكمي") && isCallStatsExamType("فاينل") && !isCallStatsExamType("يومي") && !isCallStatsExamType(""));

// e1, e2: cumulative; e3: final; d1: a daily exam (never counted).
const examTypes = new Map([["e1", "تراكمي"], ["e2", "تراكمي"], ["e3", "فاينل"], ["d1", "يومي"]]);
const day = baghdadDayRange("2026-10-11");
const stats = buildCallDailyStats({
  lines: [
    // The day before: work on c1's exam counts for the course, not for the employees.
    line("2026-10-10T08:00:00Z", ali, "s5", "e1", "تم الاتصال"),
    line("2026-10-10T08:10:00Z", ali, "s6", "e1", "لم يرد"),
    line("2026-10-10T08:20:00Z", ali, "s7", "e1", "تم الاتصال"),
    line("2026-10-11T05:00:00Z", sara, "s7", "e1", "بدون إجراء", CALL_ACTION_CLEARED), // cleared today: no longer done
    line("2026-10-11T06:00:00Z", ali, "s1", "e1", "لم يرد"),
    line("2026-10-11T06:05:00Z", ali, "s1", "e1", "تم الاتصال"), // same call again: still one action
    line("2026-10-11T07:00:00Z", ali, "s2", "e1", "تم الاتصال"),
    line("2026-10-11T07:10:00Z", ali, "s3", "e2", "تم الاتصال"),
    line("2026-10-11T07:20:00Z", ali, "s3", "e2", "بدون إجراء", CALL_ACTION_CLEARED), // cleared by the end: none
    line("2026-10-11T08:00:00Z", sara, "s1", "e1", "الرقم خاطئ"), // another employee on the same call: one more action, same student
    line("2026-10-11T08:30:00Z", sara, "s4", "e2", "لم يرد"),
    line("2026-10-11T08:40:00Z", sara, "s4", "e3", "تم الاتصال"), // a final exam counts like a cumulative one
    line("2026-10-11T09:00:00Z", sara, "s1", "d1", "تم الاتصال"), // a daily exam: never shows
    line("2026-10-11T09:05:00Z", ali, "s2", "d1", "لم يرد"),
    line("2026-10-12T06:00:00Z", ali, "s8", "e1", "تم الاتصال"), // after the day: not counted
    { time: "2026-10-11T09:00:00Z", action: "إضافة ملاحظة مكالمات", userId: "u2", userName: "سارة", details: JSON.stringify({ studentId: "s4", examId: "e2" }) },
  ],
  day,
  examTypes,
  studentCourse: new Map([["s1", "c1"], ["s2", "c1"], ["s3", "c2"], ["s4", "c2"], ["s5", "c1"], ["s6", "c1"], ["s7", "c1"], ["s8", "c1"]]),
  courses: [{ id: "c1", name: "صيفية اولى" }, { id: "c2", name: "شتوية ثانية" }, { id: "c3", name: "اعفاء" }],
  courseExams: new Map([
    ["c1", { examId: "e1", examName: "امتحان 7", target: 10, discounted: 9, full: 4 }],
    ["c2", { examId: "e2", examName: "امتحان 3", target: 1, discounted: 1, full: null }],
  ]),
});

// Employees: the day only, cumulative and final exams only.
assert.deepEqual(stats.employees.map((employee) => [employee.name, employee.total]), [["سارة", 3], ["علي", 2]]);
const byName = (name) => stats.employees.find((employee) => employee.name === name);
assert.deepEqual(byName("علي").courses, [{ id: "c1", name: "صيفية اولى", count: 2 }]);
assert.deepEqual(byName("سارة").courses.map((course) => [course.name, course.count]).sort(), [["شتوية ثانية", 2], ["صيفية اولى", 1]]);
assert.deepEqual(byName("علي").statuses, [{ status: "تم الاتصال", count: 2 }]);
assert.equal(stats.totals.actions, 5);

// Courses: their exam only, every day up to the end of the chosen one, each student once.
// c1 / e1: s5, s6 (the day before), s1, s2 (today); s7 cleared today; s8 is after the day.
assert.deepEqual(stats.courses.map((course) => [course.name, course.examName, course.target, course.done, course.doneToday, course.remaining]), [
  ["صيفية اولى", "امتحان 7", 10, 4, 2, 6],
  ["شتوية ثانية", "امتحان 3", 1, 1, 1, 0], // s4 on e2; its final-exam call is not c2's exam
  ["اعفاء", "", null, 0, 0, 0],
]);
assert.deepEqual([stats.courses[0].discounted, stats.courses[0].full, stats.courses[1].full], [9, 4, null]);
assert.equal(stats.courses[0].rate, 0.4);
assert.equal(stats.courses[2].rate, null);
assert.deepEqual(stats.totals, { target: 11, done: 5, doneToday: 3, remaining: 6, rate: 5 / 11, discounted: 10, full: 4, actions: 5 });

// The left numbers never go below zero, and add up per course.
const over = buildCallDailyStats({
  lines: [line("2026-10-11T06:00:00Z", ali, "s1", "e1", "تم الاتصال"), line("2026-10-11T06:00:00Z", ali, "s2", "e1", "تم الاتصال")],
  day, examTypes, studentCourse: new Map([["s1", "c1"], ["s2", "c1"], ["s3", "c2"]]),
  courses: [{ id: "c1", name: "أ" }, { id: "c2", name: "ب" }],
  courseExams: new Map([["c1", { examId: "e1", examName: "x", target: 1, discounted: 1, full: 0 }], ["c2", { examId: "e2", examName: "y", target: 3, discounted: 3, full: 0 }]]),
});
assert.deepEqual(over.courses.map((course) => course.remaining), [0, 3]);
assert.equal(over.totals.remaining, 3, "a course over its number does not hide another course's work");

// A Baghdad day is 21:00 UTC the day before to 21:00 UTC that day.
const range = baghdadDayRange("2026-10-11");
assert.equal(range.from.toISOString(), "2026-10-10T21:00:00.000Z");
assert.equal(range.to.toISOString(), "2026-10-11T21:00:00.000Z");
assert.equal(baghdadDayRange("11-10-2026"), null);

// Only the admin and the supervisors read it. Only cumulative and final exams.
// The required number is one per course and exam: «المخصومين» as the calls
// list counts them, only growing while the exam is the course's latest.
const route = read("src/app/api/student-calls/daily-stats/route.ts");
assert.ok(route.includes("if (!oversees(principal))"));
assert.ok(route.includes('import { GET as callCandidates } from "../candidates/route";'));
assert.ok(route.includes('callListCount(req, course.id, exam.id, "discounted")') && route.includes('callListCount(req, course.id, exam.id, "full")'));
assert.ok(route.includes("type: { in: [...CALL_STATS_EXAM_TYPES] }"), "a daily exam is never a course's exam here");
assert.ok(route.includes('ON CONFLICT ("courseId", "examId") DO UPDATE') && route.includes('GREATEST("CallExamTarget"."target", EXCLUDED."target")'), "the number only grows");
assert.ok(route.includes("? (discounted === null ? kept : Math.max(kept ?? 0, discounted))") && route.includes(": (kept ?? discounted)"));
assert.ok(!route.includes("callDailyTarget.upsert"), "no number per day any more");
assert.ok(!route.includes("export async function PUT"), "nobody types the required number");
assert.ok(route.includes('action: { in: [CALL_ACTION_SET, CALL_ACTION_CLEARED] }'));
const panel = read("src/components/teacher-pro/calls-stats-panel.tsx");
assert.ok(panel.includes('aria-pressed={extra.discounted}') && panel.includes('aria-pressed={extra.full}'), "the two optional columns have their own switch");
assert.ok(panel.includes("{data.totals.actions}"), "the team's sum is the day's actions");
const examTargets = read("prisma/migrations/20261015180000_call_exam_targets/migration.sql");
assert.ok(examTargets.includes('CREATE TABLE IF NOT EXISTS "CallExamTarget"') && !/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i.test(examTargets.replace(/--[^\n]*/g, "")));
assert.ok(examTargets.includes('ON "CallExamTarget"("courseId", "examId")'));
const dashboard = read("src/components/teacher-pro/dashboard.tsx");
assert.ok(dashboard.includes('actor.permissions?.includes("system.oversight")') && dashboard.includes("canSeeStats={canSeeCallStats}"));
const calls = read("src/app/api/student-calls/route.ts");
assert.ok(calls.includes('"المكالمات", data.status ? "تحديث حالة مكالمة" : "مسح حالة مكالمة"'), "every status set or cleared is logged");
const migration = read("prisma/migrations/20261011120000_call_daily_targets/migration.sql");
const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
assert.equal(policy["20261011120000_call_daily_targets"].kind, "expand");
assert.equal(policy["20261011150000_call_daily_target_exam"].kind, "expand");
assert.equal(policy["20261015180000_call_exam_targets"].kind, "expand");
assert.ok(migration.includes('CREATE TABLE "CallDailyTarget"') && !/\bDROP\b/i.test(migration.replace(/--[^\n]*/g, "")));

console.log("كل اختبارات إحصائيات المكالمات نجحت.");
