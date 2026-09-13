import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const routePath = new URL("../src/app/api/course-chapters/route.ts", import.meta.url);
const compiledRoute = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;

const pair = { courseId: "course-a", chapterId: "chapter-a" };
const uniqueConflict = () => Object.assign(new Error("Unique constraint"), {
  code: "P2002",
  meta: { target: ["courseId", "chapterId"] },
});

function link(overrides = {}) {
  return {
    id: "link-existing",
    ...pair,
    active: false,
    archived: false,
    archive: JSON.stringify([
      { studentId: "student-a", opportunities: 2, date: "2026-08-14" },
    ]),
    course: { id: pair.courseId, name: "الدورة الصيفية" },
    chapter: { id: pair.chapterId, name: "الفصل الثاني", opportunities: 3 },
    ...overrides,
  };
}

function createHarness(options = {}) {
  const rows = structuredClone(options.rows || []);
  const before = structuredClone(rows);
  const calls = [];
  const unexpected = [];
  const routeErrors = [];
  const json = (body, init) => Response.json(body, init);
  const forbidden = (operation) => {
    unexpected.push(operation);
    throw new Error(`Unexpected side effect: ${operation}`);
  };
  const courseChapter = new Proxy({
    async findFirst(query) {
      calls.push({ method: "findFirst", query });
      // Both normal and race recovery reads must target the same exact pair,
      // exclude archived history, and return the full UI response shape.
      assert.deepEqual(query, {
        where: { ...pair, archived: false },
        include: { course: true, chapter: true },
      });
      return rows.find((row) => row.courseId === pair.courseId &&
        row.chapterId === pair.chapterId && !row.archived) || null;
    },
    async create(query) {
      calls.push({ method: "create", query });
      if (options.createError) throw options.createError;
      if (options.concurrentLink) {
        rows.push(structuredClone(options.concurrentLink));
        throw uniqueConflict();
      }
      if (rows.some((row) => row.courseId === query.data.courseId &&
        row.chapterId === query.data.chapterId && !row.archived)) {
        throw uniqueConflict();
      }
      const created = link({ id: "link-created", ...query.data });
      rows.push(created);
      return created;
    },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return () => forbidden(`courseChapter.${String(property)}`);
    },
  });
  const db = new Proxy({ courseChapter }, {
    get(target, property) {
      if (property in target) return target[property];
      return forbidden(`db.${String(property)}`);
    },
  });
  const dependencies = new Map([
    ["next/server", { NextResponse: { json } }],
    ["@/lib/server-auth", {
      requireAnyPermission: async (_req, permissions) => {
        calls.push({ method: "authorize", permissions });
        return options.denied ? json({ error: "Forbidden" }, { status: 403 }) : null;
      },
    }],
    ["@/lib/db", { db }],
    ["@/lib/serializable-transaction", {
      withSerializableTransaction: () => forbidden("transaction"),
    }],
    ["@/lib/route-helpers", {
      requireText: (value, label) => String(value ?? "").trim() ? null : `${label}: مطلوب`,
      validationError: (error, status = 400) => json({ error }, { status }),
      routeErrorResponse: (error, fallback) => {
        routeErrors.push(error);
        return json({ error: fallback }, { status: 500 });
      },
    }],
    ["@/lib/api-rate-limit", {
      API_RATE_LIMITS: {},
      checkApiRateLimit: () => forbidden("opportunity synchronization rate limit"),
    }],
    ["@/lib/academic-recalculate-server", {
      recalculateStudentsAcademicState: () => forbidden("academic recalculation"),
    }],
  ]);
  const module = { exports: {} };
  new Function("exports", "require", "module", compiledRoute)(
    module.exports,
    (specifier) => {
      assert.ok(dependencies.has(specifier), `Unmocked dependency: ${specifier}`);
      return dependencies.get(specifier);
    },
    module,
  );
  return {
    rows, before, calls, unexpected, routeErrors,
    post: (payload = pair) => module.exports.POST({
      json: async () => {
        calls.push({ method: "readBody" });
        return payload;
      },
    }),
  };
}

for (const active of [false, true]) {
  test(`repeated attachment preserves ${active ? "active" : "inactive"} link and dated archive`, async () => {
    const h = createHarness({ rows: [link({ active })] });
    const response = await h.post({
      ...pair, active: !active, archived: true, archive: "[]", syncStudentOpportunities: true,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { courseChapter: h.before[0], alreadyLinked: true });
    assert.deepEqual(h.rows, h.before);
    assert.equal(h.calls.filter((call) => call.method === "create").length, 0);
    assert.deepEqual(h.unexpected, []);
  });
}

test("new attachment stays inactive and ignores client activation, archive, and student synchronization", async () => {
  const otherActive = link({ id: "other-active", chapterId: "chapter-b", active: true });
  const h = createHarness({ rows: [otherActive] });
  const response = await h.post({
    ...pair, id: "client-id", active: true, archived: true,
    archive: '[{"studentId":"student-a","opportunities":0}]',
    syncStudentOpportunities: true,
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.alreadyLinked, false);
  assert.deepEqual(h.calls.find((call) => call.method === "create").query, {
    data: { ...pair, active: false, archived: false, archive: "[]" },
    include: { course: true, chapter: true },
  });
  assert.deepEqual(body.courseChapter, link({ id: "link-created", archive: "[]" }));
  assert.deepEqual(h.rows[0], h.before[0]);
  assert.deepEqual(h.unexpected, []);
});

test("archived-only pair creates a new inactive link and preserves historical snapshots", async () => {
  const h = createHarness({ rows: [link({ archived: true })] });
  const response = await h.post();
  assert.equal(response.status, 201);
  assert.equal((await response.json()).alreadyLinked, false);
  assert.equal(h.rows.length, 2);
  assert.deepEqual(h.rows[0], h.before[0]);
  assert.equal(h.rows[1].active, false);
  assert.equal(h.rows[1].archived, false);
  assert.equal(h.rows[1].archive, "[]");
  assert.deepEqual(h.unexpected, []);
});

test("concurrent P2002 returns the committed exact pair without changing active state or archive", async () => {
  const concurrent = link({ id: "link-concurrent", active: true });
  const h = createHarness({ concurrentLink: concurrent });
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { courseChapter: concurrent, alreadyLinked: true });
  assert.deepEqual(h.rows, [concurrent]);
  assert.equal(h.calls.filter((call) => call.method === "findFirst").length, 2);
  assert.deepEqual(h.unexpected, []);
});

test("two overlapping requests create one row and both return the same link", async () => {
  const h = createHarness();
  const responses = await Promise.all([h.post(), h.post()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(h.rows.length, 1);
  assert.equal(bodies[0].courseChapter.id, bodies[1].courseChapter.id);
  assert.deepEqual(bodies.map((body) => body.alreadyLinked).sort(), [false, true]);
  assert.deepEqual(h.unexpected, []);
});

test("unresolved unique conflict does not use an archived or different pair as success", async () => {
  const rows = [
    link({ archived: true }),
    link({ id: "different-chapter", chapterId: "chapter-b", active: true }),
    link({ id: "different-course", courseId: "course-b" }),
  ];
  const h = createHarness({ rows, createError: uniqueConflict() });
  const response = await h.post();
  assert.equal(response.status, 409);
  assert.ok((await response.json()).error);
  assert.deepEqual(h.rows, h.before);
  assert.equal(h.calls.filter((call) => call.method === "findFirst").length, 2);
  assert.deepEqual(h.unexpected, []);
});

test("unrelated create failures remain failures and do not trigger duplicate recovery", async () => {
  const error = Object.assign(new Error("Database unavailable"), { code: "P1001" });
  const h = createHarness({ createError: error });
  const response = await h.post();
  assert.equal(response.status, 500);
  assert.deepEqual(h.routeErrors, [error]);
  assert.equal(h.calls.filter((call) => call.method === "findFirst").length, 1);
  assert.deepEqual(h.rows, []);
  assert.deepEqual(h.unexpected, []);
});

test("unauthorized requests are rejected before reading the body or database", async () => {
  const h = createHarness({ denied: true, rows: [link({ active: true })] });
  const response = await h.post();
  assert.equal(response.status, 403);
  assert.deepEqual(h.calls, [{ method: "authorize", permissions: ["chapters.edit", "courses.edit"] }]);
  assert.deepEqual(h.rows, h.before);
  assert.deepEqual(h.unexpected, []);
});

test("missing course or chapter is rejected before database access", async () => {
  for (const payload of [{ courseId: pair.courseId }, { chapterId: pair.chapterId }]) {
    const h = createHarness();
    assert.equal((await h.post(payload)).status, 400);
    assert.deepEqual(h.calls.map((call) => call.method), ["authorize", "readBody"]);
    assert.deepEqual(h.unexpected, []);
  }
});
