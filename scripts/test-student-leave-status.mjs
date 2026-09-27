import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolveFilename.call(this, request.startsWith("@/")
    ? path.join(root, "src", request.slice(2)) : request, parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};
const status = require(path.join(root, "src/lib/student-leave-status.ts"));

const today = "2026-09-27";
const examLeave = (examDate, overrides = {}) => ({ leaveType: "exam", date: "2026-01-01", examDate, ...overrides });
const period = (dateFrom, dateTo, overrides = {}) => ({ leaveType: "period", date: dateFrom, dateFrom, dateTo, ...overrides });

test("an exam leave is dated by its exam, never by its documentation date", () => {
  assert.deepEqual(status.studentLeaveDays(examLeave("2026-09-30T00:00:00.000Z")), { from: "2026-09-30", to: "2026-09-30" });
  assert.equal(status.studentLeaveState(status.studentLeaveDays(examLeave("2026-09-30T00:00:00.000Z")), today), "upcoming");
  assert.equal(status.studentLeaveState(status.studentLeaveDays(examLeave("2026-09-27T09:00:00.000Z")), today), "active");
  assert.equal(status.studentLeaveState(status.studentLeaveDays(examLeave("2026-09-20T00:00:00.000Z")), today), "ended");
  // An exam late in the UTC evening is the next Baghdad day.
  assert.deepEqual(status.studentLeaveDays(examLeave("2026-09-26T22:30:00.000Z")), { from: "2026-09-27", to: "2026-09-27" });
  // Without a linked exam, the stored day is the only date left.
  assert.deepEqual(status.studentLeaveDays(examLeave(null, { date: "2026-09-10" })), { from: "2026-09-10", to: "2026-09-10" });
});

test("a period covers both of its ends and a reversed range is normalized", () => {
  assert.equal(status.studentLeaveState(status.studentLeaveDays(period("2026-09-27", "2026-10-02")), today), "active");
  assert.equal(status.studentLeaveState(status.studentLeaveDays(period("2026-09-20", "2026-09-27")), today), "active");
  assert.equal(status.studentLeaveState(status.studentLeaveDays(period("2026-09-20", "2026-09-26")), today), "ended");
  assert.equal(status.studentLeaveState(status.studentLeaveDays(period("2026-09-28", "2026-10-01")), today), "upcoming");
  assert.deepEqual(status.studentLeaveDays(period("2026-10-02", "2026-09-28")), { from: "2026-09-28", to: "2026-10-02" });
  assert.deepEqual(status.studentLeaveDays({ leaveType: "period", date: "2026-09-05" }), { from: "2026-09-05", to: "2026-09-05" });
});

test("the student summary counts each state and lights the most urgent one", () => {
  const summary = status.summarizeStudentLeaves([
    period("2026-09-01", "2026-09-03"),
    examLeave("2026-10-05T00:00:00.000Z"),
    examLeave("2026-09-27T00:00:00.000Z"),
  ], today);
  assert.deepEqual(summary, { total: 3, active: 1, upcoming: 1, ended: 1, latestDay: "2026-10-05", state: "active" });
  assert.equal(status.summarizeStudentLeaves([examLeave("2026-10-05")], today).state, "upcoming");
  assert.equal(status.summarizeStudentLeaves([period("2026-09-01", "2026-09-03")], today).state, "ended");
  assert.equal(status.summarizeStudentLeaves([], today).state, null);
});

test("filters: past = ended, current = running or upcoming, all = everything", () => {
  const endedOnly = status.summarizeStudentLeaves([period("2026-09-01", "2026-09-03")], today);
  const upcomingOnly = status.summarizeStudentLeaves([examLeave("2026-10-05")], today);
  assert.equal(status.summaryMatchesFilter(endedOnly, "past"), true);
  assert.equal(status.summaryMatchesFilter(endedOnly, "current"), false);
  assert.equal(status.summaryMatchesFilter(upcomingOnly, "current"), true);
  assert.equal(status.summaryMatchesFilter(upcomingOnly, "past"), false);
  assert.equal(status.summaryMatchesFilter(upcomingOnly, "all"), true);
  assert.equal(status.leaveStateMatchesFilter("upcoming", "current"), true);
  assert.equal(status.leaveStateMatchesFilter("ended", "current"), false);
  assert.equal(status.normalizeStudentLeaveListFilter("current"), "current");
  assert.equal(status.normalizeStudentLeaveListFilter("anything"), "all");
  assert.deepEqual(status.STUDENT_LEAVE_LIST_FILTERS.map((option) => option.label), ["الإجازات السابقة", "الإجازات الحالية", "كل الإجازات"]);
  assert.deepEqual(status.STUDENT_LEAVE_STATE_LABELS, { active: "سارية", upcoming: "قادمة", ended: "منتهية" });
});

test("leaves are listed newest first", () => {
  const leaves = [
    { id: "a", ...period("2026-09-01", "2026-09-03") },
    { id: "b", ...examLeave("2026-10-05") },
    { id: "c", ...period("2026-09-10", "2026-09-12"), createdAt: "2026-09-09T10:00:00.000Z" },
    { id: "d", ...period("2026-09-10", "2026-09-12"), createdAt: "2026-09-09T11:00:00.000Z" },
  ];
  assert.deepEqual([...leaves].sort(status.compareLeavesNewestFirst).map((leave) => leave.id), ["b", "d", "c", "a"]);
});

// ── GET /api/student-leaves/students ─────────────────────────────────────
function compile(relativePath) {
  return ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

function routeHarness(options = {}) {
  const calls = [];
  const students = options.students || [];
  const leaves = options.leaves || [];
  const json = (body, init) => Response.json(body, init);
  const db = {
    student: {
      async findMany(query) {
        calls.push({ method: "student.findMany", query });
        if (query.where?.id?.in) return students.filter((student) => query.where.id.in.includes(student.id));
        return (options.searchMatches || []).map((id) => ({ id }));
      },
    },
    studentLeave: {
      async findMany(query) {
        calls.push({ method: "studentLeave.findMany", query });
        if (query.distinct) return (options.leaveTextMatches || []).map((studentId) => ({ studentId }));
        const ids = query.where?.studentId?.in;
        return leaves.filter((leave) => !ids || ids.includes(leave.studentId));
      },
    },
  };
  const dependencies = new Map([
    ["next/server", { NextResponse: { json } }],
    ["@/lib/db", { db }],
    ["@/lib/server-auth", {
      async requirePermission(_req, permission) {
        calls.push({ method: "permission", permission });
        return options.denied ? json({ error: "Forbidden" }, { status: 403 }) : null;
      },
    }],
    ["@/lib/route-helpers", { routeErrorResponse: (_error, fallback) => json({ error: fallback }, { status: 500 }) }],
    ["@/lib/schema-readiness", { async withDatabaseSchema(operation) { return operation(); } }],
    ["@/lib/student-registry-filters-server", { buildStudentRegistrySearchWhere: (q) => ({ name: { contains: q } }) }],
    ["@/lib/student-leave-query-server", { studentLeaveListWhere: (params) => ({ q: params.get("q") }) }],
    ["@/lib/student-opportunity-snapshot-server", {
      async attachStudentOpportunitySnapshots(rows) { return rows.map((row) => ({ ...row, opportunityLimit: 5 })); },
    }],
    ["@/lib/baghdad-time", { baghdadTodayKey: () => today }],
    ["@/lib/student-leave-status", status],
  ]);
  const module = { exports: {} };
  new Function("require", "module", "exports", compile("src/app/api/student-leaves/students/route.ts"))((name) => {
    assert.ok(dependencies.has(name), `Unexpected dependency: ${name}`);
    return dependencies.get(name);
  }, module, module.exports);
  return {
    calls,
    get: async (query = "") => {
      const response = await module.exports.GET(new Request(`https://teacherpro.test/api/student-leaves/students?${query}`));
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}

const student = (id, overrides = {}) => ({
  id, name: `طالب ${id}`, code: id.toUpperCase(), status: "نشط", telegram: "", username: `user_${id}`,
  studyType: "إلكتروني", courseId: "course", opportunities: 3, baseOpportunities: 5, course: { name: "دورة" }, ...overrides,
});
const leaveRow = (studentId, overrides) => ({ studentId, leaveType: "exam", date: new Date("2026-01-01"), dateFrom: null, dateTo: null, exam: null, ...overrides });

test("the list uses the leaves view permission and denies before any database access", async () => {
  const { calls, get } = routeHarness({ denied: true });
  assert.equal((await get()).status, 403);
  assert.deepEqual(calls, [{ method: "permission", permission: "follow-up.view" }]);
});

test("without a search it lists only students with leaves, newest first, with counts per filter", async () => {
  const { get } = routeHarness({
    students: [student("a"), student("b"), student("c", { status: "مفصول" })],
    leaves: [
      leaveRow("a", { leaveType: "period", date: new Date("2026-09-01"), dateFrom: new Date("2026-09-01"), dateTo: new Date("2026-09-03") }),
      leaveRow("b", { exam: { date: new Date("2026-10-05T00:00:00.000Z") } }),
      leaveRow("c", { leaveType: "period", date: new Date("2026-09-25"), dateFrom: new Date("2026-09-25"), dateTo: new Date("2026-09-30") }),
    ],
  });
  const { status: code, body, headers } = await get();
  assert.equal(code, 200);
  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.deepEqual(body.students.map((row) => row.id), ["b", "c", "a"]);
  assert.deepEqual(body.counts, { past: 1, current: 2, all: 3 });
  assert.equal(body.students[0].leaves.state, "upcoming");
  assert.equal(body.students[1].leaves.state, "active");
  assert.equal(body.students[1].status, "مفصول");
  assert.equal(body.students[2].leaves.state, "ended");
  assert.equal(body.students[0].opportunityLimit, 5);
  assert.equal(body.students[0].username, "user_b");

  const past = await get("filter=past");
  assert.deepEqual(past.body.students.map((row) => row.id), ["a"]);
  const current = await get("filter=current");
  assert.deepEqual(current.body.students.map((row) => row.id), ["b", "c"]);
});

test("a search also finds students with no leave yet and matches a leave's text", async () => {
  const { calls, get } = routeHarness({
    students: [student("a"), student("new"), student("reason")],
    searchMatches: ["new", "a"],
    leaveTextMatches: ["reason"],
    leaves: [
      leaveRow("a", { exam: { date: new Date("2026-09-20T00:00:00.000Z") } }),
      leaveRow("reason", { exam: { date: new Date("2026-09-27T00:00:00.000Z") } }),
    ],
  });
  const { body } = await get("q=%D8%B7%D8%A7%D9%84%D8%A8");
  assert.deepEqual(body.students.map((row) => row.id), ["reason", "a", "new"]);
  assert.equal(body.students[2].leaves.total, 0);
  assert.deepEqual(body.counts, { past: 1, current: 1, all: 3 });
  const leaveQuery = calls.find((call) => call.method === "studentLeave.findMany" && !call.query.distinct).query;
  assert.deepEqual(new Set(leaveQuery.where.studentId.in), new Set(["new", "a", "reason"]));
  // One letter is not a search.
  const short = await routeHarness({ students: [student("a")], searchMatches: ["a"], leaves: [] }).get("q=a");
  assert.deepEqual(short.body.students, []);
});

test("a direct student lookup returns that student even without leaves", async () => {
  const { get } = routeHarness({ students: [student("solo")], leaves: [] });
  const { body } = await get("studentId=solo&filter=past");
  assert.deepEqual(body.students.map((row) => row.id), ["solo"]);
  assert.equal(body.students[0].leaves.state, null);
});
