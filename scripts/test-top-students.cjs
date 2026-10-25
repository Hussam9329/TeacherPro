// «الطلبة المتميزين»: each exam counts as a percentage of its full mark;
// absences follow the chosen rule, excused exams count for nothing, equal
// averages share a place, and the route/button stay behind their permissions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  file,
);
const { rankTopStudents, degreeTone } = require("../src/lib/top-students.ts");
const { topStudentsSearch } = (() => {
  // The client helper imports browser-only modules; only the query builder is tested.
  const source = fs.readFileSync(path.join(root, "src/lib/top-students-client.ts"), "utf8").replace(/^import .*$/gm, "");
  const module = { exports: {} };
  new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module, module.exports);
  return module.exports;
})();

const exams = [
  { id: "e1", name: "تراكمي 1", date: "2026-10-01", type: "تراكمي", fullMark: 50 },
  { id: "e2", name: "تراكمي 2", date: "2026-10-08", type: "تراكمي", fullMark: 100 },
];
const students = [
  { id: "a", name: "أحمد", code: "1", createdAt: "2026-09-01" },
  { id: "b", name: "بكر", code: "2", createdAt: "2026-09-01" },
  { id: "c", name: "جاسم", code: "3", createdAt: "2026-09-01" },
  { id: "d", name: "داود", code: "4", createdAt: "2026-10-05" }, // joined after e1
  { id: "e", name: "عمر", code: "5", createdAt: "2026-09-01" },
];
const g = (studentId, examId, status, score = null) => ({ studentId, examId, status, score });
const grades = [
  g("a", "e1", "درجة", 50), g("a", "e2", "درجة", 90),   // 100, 90 → 95
  g("b", "e1", "درجة", 45), g("b", "e2", "درجة", 100),  // 90, 100 → 95
  g("c", "e1", "غائب"), g("c", "e2", "درجة", 100),       // absent once
  g("d", "e2", "درجة", 80),                              // e1 before registration → 80
  g("e", "e1", "مجاز"), g("e", "e2", "درجة", 70),        // excused → 70
];

const all = rankTopStudents({ exams, students, grades, attendance: "all", limit: 10 });
assert.deepEqual(all.rows.map((row) => [row.name, row.rank, row.average]), [
  ["أحمد", 1, 95], ["بكر", 1, 95], ["داود", 3, 80], ["عمر", 4, 70],
], "percent of the full mark; ties share a place; the absent student is left out");
assert.equal(all.considered, 5);
assert.equal(all.qualified, 4);
assert.equal(all.courseAverage, 85);
assert.equal(all.rows[0].fullMarks, 1);
assert.equal(all.rows.find((row) => row.id === "d").exams[0].state, "excused", "an exam before registration is not theirs");
assert.equal(all.rows.find((row) => row.id === "e").excused, 1);

const zero = rankTopStudents({ exams, students, grades, attendance: "zero", limit: 10 });
assert.equal(zero.rows.find((row) => row.id === "c").average, 50, "«الغياب يُحسب صفر»: (0 + 100) / 2");
assert.equal(zero.qualified, 5);

const cut = rankTopStudents({ exams, students, grades, attendance: "all", limit: 1 });
assert.deepEqual(cut.rows.map((row) => row.id), ["a", "b"], "everyone tied with the last place shown stays");

// Degrees: out of the exams' shared full mark, else out of 100.
assert.equal(all.scale, 100, "mixed full marks (50 and 100) show out of 100");
assert.equal(all.rows[0].averageScore, 95);
const fifty = exams.map((exam) => ({ ...exam, fullMark: 50 }));
const out50 = rankTopStudents({ exams: fifty, students: [students[0]], grades: [g("a", "e1", "درجة", 50), g("a", "e2", "درجة", 47)], attendance: "all", limit: 10 });
assert.equal(out50.scale, 50);
assert.equal(out50.rows[0].averageScore, 48.5, "(50 + 47) / 2 out of 50");
assert.equal(out50.courseAverageScore, 48.5);

// Colours by closeness to the full mark (out of 50): 50 · 48 · 45 · 40 · 39.
assert.deepEqual([50, 48, 47, 45, 44, 40, 39].map((score) => degreeTone((score / 50) * 100)),
  ["full", "high", "orange", "orange", "yellow", "yellow", "low"]);

const none = rankTopStudents({ exams: [], students, grades: [], attendance: "all", limit: 10 });
assert.equal(none.rows.length, 0);
assert.equal(none.courseAverage, null);

assert.equal(
  topStudentsSearch({ courseId: "c1", attendance: "all", limit: 20, last: 4 }),
  "courseId=c1&attendance=all&limit=20&period=last&last=4",
);
assert.match(topStudentsSearch({ courseId: "c1", attendance: "zero", limit: 10, withFinals: true, range: { from: "2026-10-01", to: "" }, gender: "أنثى" }), /types=withFinals&period=range&from=2026-10-01&gender=/);

const route = fs.readFileSync(path.join(root, "src/app/api/stats/top-students/route.ts"), "utf8");
assert.ok(route.includes('requireAnyPermission(req, ["students.view", "grades.view"])'), "the route needs students.view or grades.view");
assert.ok(route.includes('status: ACTIVE') && route.includes('const ACTIVE = "نشط"'), "active students only");
assert.ok(route.includes("exam.date <= today"), "only exams already held");
const dashboard = fs.readFileSync(path.join(root, "src/components/teacher-pro/dashboard.tsx"), "utf8");
assert.ok(dashboard.includes("canViewTopStudents && (") && dashboard.includes("<TopStudentsDialog"), "«الطلبة المتميزين» on the dashboard behind its permission");
assert.ok(dashboard.includes('actor.permissions?.includes("grades.view")'));
console.log("PASS: «الطلبة المتميزين» ranks by percent of the full mark with the attendance rule, shared places and permissions.");
