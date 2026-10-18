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
  { date: "2026-10-16", registrations: 0, dismissals: 1, active: 97 },
  { date: "2026-10-17", registrations: 2, dismissals: 0, active: 99 },
  { date: "2026-10-18", registrations: 1, dismissals: 1, active: 100 },
]);
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
console.log("PASS: «إحصائيات الطلبة» days, ranges, once-per-student counts and the running active count; the route only reads");
