import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function compile(relativePath) {
  return ts.transpileModule(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const compiledRoute = compile("../src/app/api/student-leaves/context/route.ts");
const courseLinks = { exports: {} };
new Function("require", "module", "exports", compile("../src/lib/exam-course-links.ts"))(
  require, courseLinks, courseLinks.exports,
);

function harness(options = {}) {
  const calls = [];
  const student = options.student === undefined
    ? { id: "student-a", courseId: "course-current", mainSite: "بغداد", subSite: "المنصور", opportunities: 2 }
    : options.student;
  const json = (body, init) => Response.json(body, init);
  const readOnly = (resource, methods) => new Proxy(methods, {
    get(target, key) {
      if (key in target) return target[key];
      throw new Error(`Unexpected operation: ${resource}.${String(key)}`);
    },
  });
  const db = readOnly("db", {
    student: readOnly("student", {
      async findUnique(query) {
        calls.push({ method: "student", query });
        if (options.failed) throw new Error("Database unavailable");
        return student;
      },
    }),
    exam: readOnly("exam", {
      async findMany(query) {
        calls.push({ method: "exams", query });
        return structuredClone(options.exams || []);
      },
    }),
  });
  const dependencies = new Map([
    ["next/server", { NextResponse: { json } }],
    ["@/lib/db", { db }],
    ["@/lib/server-auth", {
      async requireAnyPermission(_req, permissions) {
        calls.push({ method: "permission", permissions });
        return options.denied ? json({ error: "Forbidden" }, { status: 403 }) : null;
      },
    }],
    ["@/lib/permission-catalog", { LEAVES_VIEW_PERMISSIONS: ["follow-up.leaves.view", "follow-up.view"] }],
    ["@/lib/exam-course-links", courseLinks.exports],
    ["@/lib/schema-readiness", {
      async withDatabaseSchema(operation) { calls.push({ method: "schema" }); return operation(); },
    }],
    ["@/lib/route-helpers", {
      validationError: (error, status = 400) => json({ error }, { status }),
      routeErrorResponse: (_error, fallback) => json({ error: fallback }, { status: 500 }),
    }],
  ]);
  const module = { exports: {} };
  new Function("require", "module", "exports", compiledRoute)((name) => {
    assert.ok(dependencies.has(name), `Unexpected dependency: ${name}`);
    return dependencies.get(name);
  }, module, module.exports);
  return { calls, get: (query = "studentId=student-a") => module.exports.GET(new Request(`https://teacherpro.test/api/student-leaves/context?${query}`)) };
}

test("leave context uses follow-up permission and denies before any database access", async () => {
  const { calls, get } = harness({ denied: true });
  assert.equal((await get()).status, 403);
  // «موظف إجازات» (the leaves permission) and the older «عرض المتابعة» both open it.
  assert.deepEqual(calls, [{ method: "permission", permissions: ["follow-up.leaves.view", "follow-up.view"] }]);
});

test("missing student selection is rejected before reading the database", async () => {
  const { calls, get } = harness();
  assert.equal((await get("")).status, 400);
  assert.equal(calls.length, 1);
});

test("deleted student is an error rather than an empty exam preview", async () => {
  const { calls, get } = harness({ student: null });
  assert.equal((await get()).status, 404);
  assert.equal(calls.some(call => call.method === "exams"), false);
});

test("fresh student course selects exact course IDs, retaining inactive exams and all sites", async () => {
  const base = { name: "امتحان", type: "يومي", date: "2026-09-16T00:00:00.000Z", mainSite: "الكرادة", active: true };
  const { calls, get } = harness({ exams: [
    { ...base, id: "inactive", courseIds: '["course-current"]', active: false },
    { ...base, id: "multi", courseIds: '["course-other","course-current"]', date: "2026-09-16T23:30:00.000Z" },
    { ...base, id: "legacy", courseIds: "course-current,course-other" },
    { ...base, id: "wrong", courseIds: '["course-current-extra"]' },
    { ...base, id: "empty", courseIds: "[]" },
  ] });
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.equal(result.student.courseId, "course-current");
  assert.equal(result.student.opportunities, 2);
  assert.deepEqual(result.exams.map(exam => exam.id), ["inactive", "multi", "legacy"]);
  assert.equal(result.exams[0].active, false);
  assert.equal(result.exams[0].mainSite, "الكرادة");
  assert.deepEqual(result.exams[1].courseIds, ["course-other", "course-current"]);
  assert.equal(result.exams[1].date, "2026-09-16T23:30:00.000Z");
  assert.deepEqual(calls.find(call => call.method === "student").query, { where: { id: "student-a" } });
  const examQuery = calls.find(call => call.method === "exams").query;
  assert.deepEqual(examQuery.orderBy, [{ date: "asc" }, { name: "asc" }, { id: "asc" }]);
  assert.equal(examQuery.take, undefined);
  assert.equal(examQuery.skip, undefined);
  assert.equal(examQuery.where, undefined);
  assert.deepEqual(Object.keys(examQuery.select).sort(), ["active", "courseIds", "date", "id", "mainSite", "name", "type"]);
});

test("database failure cannot masquerade as zero included exams", async () => {
  const { get } = harness({ failed: true });
  const response = await get();
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.ok(body.error);
  assert.equal(body.exams, undefined);
});
