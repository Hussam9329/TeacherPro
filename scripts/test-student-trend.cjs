const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const load = (file) => {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("module", "exports", "require", output)(module, module.exports, require);
  return module.exports;
};
const trend = load("src/lib/student-trend.ts");

// Ranges end today; «هذا الشهر» starts on the 1st.
assert.deepEqual(trend.studentTrendDayKeys("week", "2026-10-18"), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
const month = trend.studentTrendDayKeys("month", "2026-10-18");
assert.equal(month.length, 18);
assert.equal(month[0], "2026-10-01");
assert.equal(trend.studentTrendDayKeys("30d", "2026-03-01")[0], "2026-01-31", "crosses months and February");
assert.equal(trend.studentTrendDayKeys("90d", "2026-10-18").length, 90);
assert.equal(trend.parseStudentTrendRange("90d"), "90d");
assert.equal(trend.parseStudentTrendRange("year"), "month", "unknown ranges fall back to this month");

// Per-day counts, once per student per day, and the active count walked back from today.
const days = trend.buildStudentTrend({
  dayKeys: ["2026-10-16", "2026-10-17", "2026-10-18"],
  activeNow: 100,
  registrations: [
    { studentId: "a", day: "2026-10-17" },
    { studentId: "b", day: "2026-10-17" },
    { studentId: "c", day: "2026-10-18" },
  ],
  dismissals: [
    { studentId: "d", day: "2026-10-18" },
    { studentId: "d", day: "2026-10-18" }, // the log and the note of one dismissal
    { studentId: "e", day: "2026-10-16" },
  ],
  reactivations: [{ studentId: "f", day: "2026-10-18" }],
});
assert.deepEqual(days, [
  { date: "2026-10-16", registrations: 0, dismissals: 1, archivals: 0, active: 97 },
  { date: "2026-10-17", registrations: 2, dismissals: 0, archivals: 0, active: 99 },
  { date: "2026-10-18", registrations: 1, dismissals: 1, archivals: 0, active: 100 },
]);

// Archivals: counted per day; only an active student's archive leaves the
// active count, and a restore from the archive returns to it.
const archived = trend.buildStudentTrend({
  dayKeys: ["2026-10-17", "2026-10-18"],
  activeNow: 50,
  registrations: [],
  dismissals: [],
  reactivations: [],
  archivals: [
    { studentId: "a", day: "2026-10-18", wasActive: true },
    { studentId: "b", day: "2026-10-18", wasActive: false },
    { studentId: "b", day: "2026-10-18", wasActive: false },
  ],
  restorations: [{ studentId: "c", day: "2026-10-18" }],
});
assert.deepEqual(archived, [
  { date: "2026-10-17", registrations: 0, dismissals: 0, archivals: 0, active: 50 },
  { date: "2026-10-18", registrations: 0, dismissals: 0, archivals: 2, active: 50 },
], "18th: +1 restored −1 archived while active = 0 change; two students archived");
assert.equal(trend.archivedWhileActive("… الحالة السابقة: نشط. الفرص قبل الأرشفة: 3"), true);
assert.equal(trend.archivedWhileActive("… الحالة السابقة: مفصول. الفرص قبل الأرشفة: 0"), false);
assert.equal(trend.archivedWhileActive(null), false);
// 18th: +1 registration +1 reactivation −1 dismissal = +1 → 99 at the end of the 17th;
// 17th: +2 → 97 at the end of the 16th.
assert.equal(trend.buildStudentTrend({ dayKeys: ["2026-10-18"], activeNow: 0, registrations: [], dismissals: [], reactivations: [] })[0].active, 0);
assert(trend.buildStudentTrend({
  dayKeys: ["2026-10-17", "2026-10-18"], activeNow: 1,
  registrations: [{ studentId: "x", day: "2026-10-18" }, { studentId: "y", day: "2026-10-18" }], dismissals: [], reactivations: [],
}).every((day) => day.active >= 0), "never below zero");

// The route reads only, with the dashboard's permission.
const route = fs.readFileSync(path.join(root, "src/app/api/stats/trend/route.ts"), "utf8");
assert.match(route, /requirePermissionPrincipal\(req, "system\.dashboard"\)/);
assert.doesNotMatch(route, /\.(create|update|upsert|delete)(Many)?\(/, "no writes");
assert.match(route, /isDismissalOpportunityLog/);
assert.match(route, /isDismissalActionNote/);
assert.match(route, /"student-archive", "student-archive-restore"/, "archive and restore notes are read");
assert.doesNotMatch(route, /status: \{ not: "مؤرشف" \}/, "registrations include students archived later");

// The dashboard total counts every student, archived included.
const statsRoute = fs.readFileSync(path.join(root, "src/app/api/stats/route.ts"), "utf8");
assert.match(statsRoute, /status: "مؤرشف"/, "archived students are counted");
assert.match(statsRoute, /tx\.student\.count\(\),/, "the total has no status filter");
assert.match(statsRoute, /archivedStudents: archivedCount/);
console.log("PASS: «إحصائيات الطلبة» days, ranges, once-per-student counts and the running active count; the route only reads");
