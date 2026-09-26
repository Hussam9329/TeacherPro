const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const { recalculateAcademicState, isAutomaticOpportunityLog } = require("../src/lib/academic-engine.ts");
const { buildMutationPreviewToken } = require("../src/lib/mutation-preview-token.ts");
const { baghdadTodayKey } = require("../src/lib/baghdad-time.ts");
const { CHAPTER_TRANSITION_SETTLEMENT_REASON } = require("../src/lib/second-chapter-transition.ts");
const routeSource = ts.transpileModule(fs.readFileSync("src/app/api/course-chapters/activate/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const copy = value => structuredClone(value);
const iso = value => value instanceof Date ? value.toISOString() : value;

function fixture() {
  const student = (id, overrides = {}) => ({
    id, courseId: "course", status: "نشط", dismissalReason: "", dismissalNotes: "",
    opportunities: 2, baseOpportunities: 3, createdAt: "2026-01-01T00:00:00.000Z", gracePeriods: [],
    ...overrides,
  });
  return {
    courses: [{ id: "course", name: "course" }, { id: "other-course", name: "other" }],
    chapters: [{ id: "chapter", name: "chapter", opportunities: 3 }, { id: "next-chapter", name: "next", opportunities: 3 }],
    courseChapters: [
      { id: "link", courseId: "course", chapterId: "chapter", active: true, archived: false, archive: "[]" },
      { id: "next-link", courseId: "course", chapterId: "next-chapter", active: false, archived: false, archive: "[]" },
      { id: "other-link", courseId: "other-course", chapterId: "chapter", active: true, archived: false, archive: "[]" },
    ],
    students: [student("absent"), student("low-score", { opportunities: 1 }),
      student("dismissed", { status: "مفصول", opportunities: 0, dismissalReason: "existing dismissal" }),
      student("archived", { status: "مؤرشف", opportunities: 1 }),
      student("unrelated", { courseId: "other-course" })],
    exams: [{ id: "exam", name: "old exam", type: "يومي", date: "2026-02-01T00:00:00.000Z",
      fullMark: 20, passMark: 15, discountMark: 0, opportunitiesPenalty: 1, dismissalGrade: null,
      noDiscount: false, active: true, courseIds: ["course"], examCourses: [{ courseId: "course", chapterId: "chapter" }] }],
    grades: ["absent", "low-score"].map(id => ({ id: `grade-${id}`, studentId: id, examId: "exam",
      status: id === "absent" ? "غائب" : "درجة", score: id === "absent" ? null : 0,
      createdAt: "2026-02-01T10:00:00.000Z", updatedAt: "2026-02-01T10:00:00.000Z" })),
    opportunityLogs: [{ id: "historical-debit", studentId: "absent", examId: "exam", action: "خصم تلقائي",
      amount: 1, reason: "تلقائي: historical debit", date: "2026-02-01T00:00:00.000Z",
      chapterId: "chapter", chapterNameSnapshot: "chapter" }],
    studentLeaves: [], studentNotes: [],
  };
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("not" in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
}

function harness(initial, options = {}) {
  let saved = copy(initial);
  let sequence = 0;
  const errors = [];
  const calls = [];
  const json = (body, init) => Response.json(body, init);
  function client(state) {
    const model = (collection, name) => ({
      async findMany({ where } = {}) { return copy(collection.filter(row => matches(row, where))); },
      async findUnique({ where, include }) {
        const row = collection.find(row => matches(row, where));
        if (!row) return null;
        return copy(include ? { ...row, course: state.courses.find(course => course.id === row.courseId),
          chapter: state.chapters.find(chapter => chapter.id === row.chapterId) } : row);
      },
      async count({ where }) { return collection.filter(row => matches(row, where)).length; },
      async update({ where, data }) {
        calls.push(`${name}.update`);
        const row = collection.find(row => matches(row, where));
        assert.ok(row, "updates must target an existing row");
        Object.assign(row, copy(data));
        return copy(row);
      },
      async updateMany({ where, data }) {
        calls.push(`${name}.updateMany`);
        const rows = collection.filter(row => matches(row, where));
        rows.forEach(row => Object.assign(row, copy(data)));
        return { count: rows.length };
      },
      async createMany({ data }) {
        calls.push(`${name}.createMany`);
        if (options.failSettlement && name === "opportunityLog") throw new Error("injected settlement failure");
        data.forEach(row => collection.push({ id: `created-${++sequence}`, ...copy(row) }));
        return { count: data.length };
      },
    });
    return { state, student: model(state.students, "student"), courseChapter: model(state.courseChapters, "courseChapter"),
      grade: model(state.grades, "grade"), opportunityLog: model(state.opportunityLogs, "opportunityLog"),
      studentNote: model(state.studentNotes, "studentNote") };
  }
  const dependencies = new Map([
    ["next/server", { NextResponse: { json } }],
    ["@/lib/server-auth", { requireAnyPermission: async () => null }],
    ["@/lib/db", { db: {} }],
    ["@/lib/api-rate-limit", { API_RATE_LIMITS: {}, checkApiRateLimit: async () => null }],
    ["@/lib/mutation-preview-token", { buildMutationPreviewToken }],
    ["@/lib/baghdad-time", { baghdadTodayKey }],
    ["@/lib/second-chapter-transition", { CHAPTER_TRANSITION_SETTLEMENT_REASON }],
    ["@/lib/route-helpers", {
      validationError: (error, status = 400) => json({ error }, { status }),
      routeErrorResponse: (error, fallback) => { errors.push(error); return json({ error: fallback }, { status: 500 }); },
    }],
    ["@/lib/serializable-transaction", { withSerializableTransaction: async operation => {
      const pending = copy(saved);
      const result = await operation(client(pending));
      saved = pending;
      return result;
    } }],
    ["@/lib/academic-recalculate-server", { recalculateStudentsAcademicState: async (ids, { tx }) => {
      calls.push("recalculate");
      const input = { ...copy(tx.state), students: copy(tx.state.students.filter(row => ids.includes(row.id))),
        grades: copy(tx.state.grades.filter(row => ids.includes(row.studentId))),
        opportunityLogs: tx.state.opportunityLogs.filter(row => ids.includes(row.studentId)).map(row => ({ ...copy(row), date: iso(row.date) })),
        studentNotes: tx.state.studentNotes.filter(row => ids.includes(row.studentId)).map(row => ({ ...copy(row), date: iso(row.date) })) };
      const result = recalculateAcademicState(input, new Set(ids));
      const beforeById = new Map(input.opportunityLogs.map(row => [row.id, row]));
      // Model the production writeback and provenance trigger. Identical old
      // rows stay in place; any newly generated unscoped penalty aborts all writes.
      for (const log of result.opportunityLogs.filter(isAutomaticOpportunityLog)) {
        if (JSON.stringify(beforeById.get(log.id)) === JSON.stringify(log)) continue;
        if (log.examId && !String(log.chapterId || "").trim()) {
          throw Object.assign(new Error("An automatic exam opportunity log requires a chapter"), { code: "23514" });
        }
      }
      for (const student of result.students) {
        const row = tx.state.students.find(row => row.id === student.id);
        Object.assign(row, { status: student.status, opportunities: student.opportunities, dismissalReason: student.dismissalReason });
      }
      tx.state.opportunityLogs = tx.state.opportunityLogs.filter(row => !ids.includes(row.studentId) || !isAutomaticOpportunityLog(row));
      for (const row of result.opportunityLogs.filter(isAutomaticOpportunityLog)) {
        tx.state.opportunityLogs.push(copy(beforeById.get(row.id) || row));
      }
      return { studentIds: ids, ...result, automaticOpportunityLogs: result.opportunityLogs.filter(isAutomaticOpportunityLog) };
    } }],
  ]);
  const module = { exports: {} };
  new Function("exports", "require", "module", routeSource)(module.exports, name => {
    assert.ok(dependencies.has(name), `Unmocked dependency: ${name}`);
    return dependencies.get(name);
  }, module);
  const request = body => module.exports.POST({ json: async () => copy(body) });
  return { errors, calls, snapshot: () => copy(saved), mutate: operation => operation(saved), request,
    async apply(action, courseChapterId = "link") {
      const previewResponse = await request({ courseChapterId, action, previewOnly: true });
      assert.equal(previewResponse.status, 200);
      const { preview } = await previewResponse.json();
      return request({ courseChapterId, action, confirmImpact: true, previewToken: preview.previewToken });
    } };
}

(async () => {
  const original = fixture();
  const close = harness(original);
  const response = await close.apply("deactivate");
  assert.equal(response.status, 200, `deactivation must not fail: ${close.errors.map(error => error.message).join("; ")}`);
  const closed = close.snapshot();
  for (const id of ["absent", "low-score", "dismissed"]) {
    const before = original.students.find(row => row.id === id);
    const after = closed.students.find(row => row.id === id);
    assert.deepEqual(after, { ...before, opportunities: 0, baseOpportunities: 0 }, "closing a chapter changes balances, never dismissal state");
  }
  for (const id of ["archived", "unrelated"]) {
    assert.deepEqual(closed.students.find(row => row.id === id), original.students.find(row => row.id === id));
  }
  assert.deepEqual(closed.grades, original.grades);
  assert.deepEqual(closed.opportunityLogs, original.opportunityLogs, "closing retains historical accounting evidence");
  assert.deepEqual(closed.studentNotes, original.studentNotes);
  assert.equal(close.calls.includes("recalculate"), false, "closing a chapter must not rebuild academic history");
  const archive = JSON.parse(closed.courseChapters.find(row => row.id === "link").archive);
  assert.deepEqual(archive.map(({ studentId, opportunities }) => [studentId, opportunities]).sort(), [["absent", 2], ["dismissed", 0], ["low-score", 1]]);

  // Other operations can still invoke the engine after the chapter is closed.
  // No grade type may create an unscoped penalty or discard old ledger evidence.
  for (const kind of ["absence", "low-score", "final", "cheating"]) {
    const input = copy(closed);
    input.opportunityLogs.push(
      { ...copy(input.opportunityLogs[0]), id: "legacy-unscoped", chapterId: null, chapterNameSnapshot: "legacy history", ledgerVersion: 1 },
      { id: "manual-credit", studentId: "absent", action: "إضافة", amount: 1, appliedAmount: 1,
        requestedAmount: 2, balanceBefore: 2, balanceAfter: 3, ledgerVersion: 2,
        chapterId: "chapter", reason: "manual history", date: "2026-02-02T00:00:00.000Z" },
      { id: "legacy-reactivation", studentId: "absent", action: "إعادة تفعيل", amount: 0,
        reason: "تثبيت إعادة التفعيل بعد تعهد", chapterId: "chapter", date: "2026-02-03T00:00:00.000Z" },
    );
    if (kind === "final") input.exams[0].type = "فاينل";
    if (kind === "cheating") input.grades[0].status = "غش";
    const after = recalculateAcademicState(input, new Set(["absent", "low-score", "dismissed"]));
    assert.deepEqual(after.students, input.students, `no active chapter leaves students unchanged for ${kind}`);
    assert.deepEqual(after.opportunityLogs, input.opportunityLogs, "subsequent replay preserves historical logs");
  }

  const reopenedResponse = await close.apply("activate");
  assert.equal(reopenedResponse.status, 200);
  const reopened = close.snapshot();
  for (const [id, balance] of [["absent", 2], ["low-score", 1]]) {
    const student = reopened.students.find(row => row.id === id);
    assert.equal(student.status, "نشط");
    assert.equal(student.opportunities, balance, "reopening restores the archived balance without replaying settled grades");
    assert.equal(student.baseOpportunities, 3);
  }
  assert.equal(reopened.students.find(row => row.id === "dismissed").status, "مفصول");
  assert.equal(reopened.students.find(row => row.id === "dismissed").opportunities, 0);
  assert.deepEqual(reopened.students.find(row => row.id === "archived"), original.students.find(row => row.id === "archived"));
  assert.deepEqual(reopened.grades, original.grades);

  for (const transition of [false, true]) {
    const initial = fixture();
    if (!transition) initial.courseChapters.find(row => row.id === "link").active = false;
    const test = harness(initial);
    assert.equal((await test.apply("activate", transition ? "next-link" : "link")).status, 200);
    const saved = test.snapshot();
    for (const id of ["absent", "low-score"]) {
      const student = saved.students.find(row => row.id === id);
      assert.equal(student.status, "نشط");
      assert.equal(student.opportunities, 3);
      const settlement = saved.opportunityLogs.find(row => row.studentId === id && row.action === "إعادة تعيين");
      assert.ok(JSON.parse(settlement.settledGradeIds).includes(`grade-${id}`));
    }
    assert.equal(saved.courseChapters.filter(row => row.courseId === "course" && row.active && !row.archived).length, 1);
  }

  const stale = harness(fixture());
  const preview = (await (await stale.request({ courseChapterId: "link", action: "deactivate", previewOnly: true })).json()).preview;
  stale.mutate(state => { state.students[0].opportunities = 1; });
  const beforeStale = stale.snapshot();
  const rejected = await stale.request({ courseChapterId: "link", action: "deactivate", confirmImpact: true, previewToken: preview.previewToken });
  assert.equal(rejected.status, 409);
  assert.deepEqual(stale.snapshot(), beforeStale);

  const failing = harness(fixture(), { failSettlement: true });
  const beforeFailure = failing.snapshot();
  assert.equal((await failing.apply("activate", "next-link")).status, 500);
  assert.deepEqual(failing.snapshot(), beforeFailure, "a settlement failure rolls back chapter and all balance updates");
  console.log("PASS: chapter closure preserves status and history, no-chapter replay cannot punish, activation restores balances, and stale/failed mutations remain atomic");
})().catch(error => { console.error(error); process.exitCode = 1; });
