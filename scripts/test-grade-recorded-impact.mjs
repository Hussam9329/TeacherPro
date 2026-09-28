import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(import.meta.dirname, "..");
function compile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
function loader(mocks) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    new Function("require", "module", "exports", compile(file))((name) => {
      if (mocks.has(name)) return mocks.get(name);
      const candidate = name.startsWith("@/") ? path.join(root, "src", name.slice(2))
        : name.startsWith(".") ? path.resolve(path.dirname(file), name) : null;
      return candidate ? load(`${candidate}.ts`) : require(name);
    }, module, module.exports);
    return module.exports;
  }
  return load;
}
const at = day => new Date(`2026-09-${String(day).padStart(2, "0")}T12:00:00Z`);
const baseExam = { id: "exam-a", date: at(16), fullMark: 50, passMark: 25, discountMark: 10, type: "يومي", active: true };
const baseStudent = { id: "student-a", status: "نشط", courseId: "course-a", createdAt: at(1), gracePeriods: [] };
const grade = (overrides = {}) => ({
  id: "grade-a", studentId: "student-a", examId: "exam-a", status: "درجة", score: 5,
  student: structuredClone(baseStudent), exam: structuredClone(baseExam), ...overrides,
});
const log = (overrides = {}) => ({
  id: "log-a", studentId: "student-a", examId: "exam-a", chapterId: "chapter-a",
  action: "خصم تلقائي", amount: 2, appliedAmount: 1, date: at(16), ...overrides,
});
function harness({ logs = [], leaves = [], links = [{ courseId: "course-a", chapterId: "chapter-a" }] } = {}) {
  const calls = [];
  const readOnly = (name, rows) => new Proxy({
    async findMany(query) { calls.push({ name, query }); return structuredClone(rows); },
  }, { get(target, key) { assert.ok(key in target, `Unexpected database operation: ${name}.${String(key)}`); return target[key]; } });
  const db = new Proxy({
    opportunityLog: readOnly("logs", logs), studentLeave: readOnly("leaves", leaves), courseChapter: readOnly("chapters", links),
  }, { get(target, key) { assert.ok(key in target, `Unexpected database resource: ${String(key)}`); return target[key]; } });
  const load = loader(new Map([["@/lib/db", { db }]]));
  return { calls, annotate: load(path.join(root, "src/lib/grade-recorded-impact-server.ts")).annotateGradeRecordedImpacts };
}

test("effects come from applied ledger amounts, never low-score thresholds", async () => {
  const rows = [grade(), grade({ id: "grade-b", examId: "exam-b", exam: { ...baseExam, id: "exam-b" } })];
  const { annotate } = harness({ logs: [log()] });
  await annotate(rows);
  assert.deepEqual(rows[0].recordedOpportunityImpact, { text: "خُصمت فرصة", tone: "deducted" });
  assert.deepEqual(rows[1].recordedOpportunityImpact, { text: "لا يوجد خصم مسجّل", tone: "ordinary" });
  assert.equal(rows[0].score, 5);
});

test("zero applied deduction, no-discount, pending and excluded grades never invent effects", async () => {
  const scenarios = [
    { patch: {}, logs: [log({ appliedAmount: 0 })], text: "لا يوجد خصم مسجّل" },
    { patch: { exam: { ...baseExam, noDiscount: true } }, text: "امتحان بدون خصم" },
    { patch: { status: "درجة معلّقة", score: 5 }, text: "لا أثر على الفرص — بانتظار تثبيت النتيجة" },
    { patch: { score: null }, text: "لا أثر على الفرص — بانتظار تثبيت النتيجة" },
    { patch: { academicEffectExcluded: true }, text: "لا أثر على الرصيد الحالي" },
    { patch: { effectiveImpactExcluded: true }, text: "لا أثر على الرصيد الحالي" },
    { patch: { exam: { ...baseExam, active: false } }, text: "لا أثر حالياً — الامتحان غير متاح" },
  ];
  for (const scenario of scenarios) {
    const rows = [grade(scenario.patch)];
    const { annotate } = harness({ logs: scenario.logs });
    await annotate(rows);
    assert.deepEqual(rows[0].recordedOpportunityImpact, { text: scenario.text, tone: "ordinary" });
  }
});

test("grace and actual leave records are included even when the grade has no embedded leaves", async () => {
  const grace = grade({ student: { ...baseStudent, gracePeriods: [{ startDate: "2026-09-15", endDate: "2026-09-20" }] } });
  await harness().annotate([grace]);
  assert.deepEqual(grace.recordedOpportunityImpact, { text: "بدون خصم (فترة سماح لغاية 20 سبتمبر 2026)", tone: "excused" });
  for (const leave of [
    { studentId: "student-a", examId: "exam-a", leaveType: "exam" },
    { studentId: "student-a", leaveType: "period", dateFrom: at(15), dateTo: at(17) },
  ]) {
    const rows = [grade({ status: "غائب", score: null })];
    await harness({ leaves: [leave] }).annotate(rows);
    assert.deepEqual(rows[0].recordedOpportunityImpact, { text: "لا خصم", tone: "excused" });
    assert.equal(rows[0].status, "غائب", "presentation cannot rewrite the result");
  }
});

test("settled history retains the original debit while explaining today's protected balance", async () => {
  const settlement = log({ id: "return", examId: null, action: "رصيد إعادة التفعيل", amount: 2, balanceAfter: 2,
    ledgerVersion: 2, date: at(18), settledGradeIds: '["grade-a"]' });
  const rows = [grade({ effectiveImpactExcluded: true })];
  await harness({ logs: [log(), settlement] }).annotate(rows);
  assert.deepEqual(rows[0].recordedOpportunityImpact, { text: "خُصمت فرصة — لا أثر على الرصيد الحالي", tone: "deducted" });
  const noDebit = [grade({ effectiveImpactExcluded: true })];
  await harness({ logs: [settlement] }).annotate(noDebit);
  assert.equal(noDebit[0].recordedOpportunityImpact.text, "لا أثر على الرصيد الحالي");
});

test("dismissal wording is fixed for staff whatever the student's status or later movements", async () => {
  const dismissal = log({ action: "فصل تلقائي", amount: 0, appliedAmount: 0 });
  const cases = [
    { action: "إعادة تفعيل", later: true, active: true },
    { action: "رصيد بعد تعهد", later: true, active: true },
    { action: "إضافة", later: true, active: true },
    { action: "إعادة تعيين", later: true, active: true },
    { action: "إعادة تفعيل", later: false, active: true },
    { action: "إعادة تفعيل", later: true, active: false },
  ];
  for (const scenario of cases) {
    const rows = [grade({ student: { ...baseStudent, status: scenario.active ? "نشط" : "مفصول" } })];
    const returned = log({ id: "return", examId: null, action: scenario.action, amount: 2, balanceAfter: 2, date: at(scenario.later ? 18 : 15) });
    await harness({ logs: [dismissal, returned] }).annotate(rows);
    assert.equal(rows[0].recordedOpportunityImpact.text, "فُصل الطالب بسبب هذا الامتحان", JSON.stringify(scenario));
    assert.equal(rows[0].recordedOpportunityImpact.tone, "dismissed");
  }
});

test("history evidence cannot be hidden by a pending or subsequently protected result", async () => {
  for (const patch of [{ status: "درجة معلّقة" }, { status: "مجاز" }, { academicEffectExcluded: true }]) {
    const rows = [grade(patch)];
    await harness({ logs: [log()] }).annotate(rows);
    assert.equal(rows[0].recordedOpportunityImpact.tone, "deducted");
    assert.match(rows[0].recordedOpportunityImpact.text, /خُصمت فرصة/);
    if (patch.status === "درجة معلّقة") {
      assert.match(rows[0].recordedOpportunityImpact.text, /النتيجة معلّقة ولا تؤثر حالياً/);
    }
  }
});

test("only requested student/exam pairs contribute effects; history reads are complete and do not leak raw logs", async () => {
  const rows = [grade(), grade({ id: "grade-b", studentId: "student-b", student: { ...baseStudent, id: "student-b", courseId: "course-b" } })];
  const { annotate, calls } = harness({ logs: [
    log({ studentId: "unrequested", amount: 99 }),
    log({ examId: "other-exam", amount: 99 }),
    log({ studentId: "student-b", appliedAmount: 2 }),
  ] });
  await annotate(rows);
  assert.equal(rows[0].recordedOpportunityImpact.text, "لا يوجد خصم مسجّل");
  assert.equal(rows[1].recordedOpportunityImpact.text, "خُصمت فرصتان");
  const query = calls.find(call => call.name === "logs").query;
  assert.deepEqual(query.where, { studentId: { in: ["student-a", "student-b"] } });
  assert.equal(query.take, undefined);
  assert.equal(query.skip, undefined);
  assert.deepEqual(calls.find(call => call.name === "chapters").query.where,
    { courseId: { in: ["course-a", "course-b"] }, active: true, archived: false });
  assert.equal(JSON.stringify(rows).includes("log-a"), false);
  assert.equal(rows.some(row => row.opportunityLogs), false);
  const empty = harness();
  await empty.annotate([]);
  assert.equal(empty.calls.length, 0);
});

function routeHarness({ denied = false, computed = false } = {}) {
  const calls = [];
  const rows = [grade({ id: "grade-first" }), grade({ id: "grade-second" })];
  const db = { grade: {
    count: async () => rows.length,
    findMany: async query => query.take ? rows.slice(query.skip, query.skip + query.take) : rows,
  } };
  const mocks = new Map([
    ["next/server", { NextResponse: { json: (body, init) => Response.json(body, init) } }],
    ["@/lib/db", { db }],
    ["@/lib/server-auth", { requirePermission: async (_req, permission) => {
      calls.push({ type: "permission", permission });
      return denied ? Response.json({ error: "Forbidden" }, { status: 403 }) : null;
    } }],
    ["@/lib/all-filter", { normalizeListFilter: value => value && value !== "all" ? value : "" }],
    ["@/lib/grace-periods-server", { loadActiveGracePeriodsByStudent: async () => new Map(), withoutLegacyGraceFields: value => value }],
    ["@/lib/grade-classification", { gradeMatchesStatusFilterUnified: () => true }],
    ["@/lib/grade-settlement-server", { annotateGradeSettlementEffects: async grades => {
      for (const row of grades) row.effectiveImpactExcluded = true;
      calls.push({ type: "settlement", ids: grades.map(row => row.id) });
    } }],
    ["@/lib/grade-recorded-impact-server", { annotateGradeRecordedImpacts: async grades => {
      assert.ok(grades.every(row => row.effectiveImpactExcluded), "settlement annotations must be ready first");
      calls.push({ type: "impact", ids: grades.map(row => row.id) });
    } }],
    ["@/lib/route-helpers", { routeErrorResponse: error => { throw error; } }],
  ]);
  const module = { exports: {} };
  new Function("require", "module", "exports", compile(path.join(root, "src/app/api/grades/route.ts")))(
    name => mocks.get(name) || {}, module, module.exports,
  );
  return { calls, get: (include = "") => module.exports.GET(new Request(
    `https://teacherpro.test/api/grades?page=2&pageSize=1${computed ? "&statusFilter=full-mark" : ""}${include}`,
  )) };
}

test("grades permission and explicit opt-in protect both paginated API branches", async () => {
  const denied = routeHarness({ denied: true });
  assert.equal((await denied.get("&includeRecordedImpact=1")).status, 403);
  assert.deepEqual(denied.calls, [{ type: "permission", permission: "grades.view" }]);
  for (const computed of [false, true]) {
    for (const query of ["", "&includeRecordedImpact=0", "&includeRecordedImpact=true", "&includeRecordedImpact=1"]) {
      const { calls, get } = routeHarness({ computed });
      const response = await get(query);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.grades.map(row => row.id), ["grade-second"]);
      const impact = calls.filter(call => call.type === "impact");
      assert.deepEqual(impact, query.endsWith("=1") ? [{ type: "impact", ids: ["grade-second"] }] : []);
    }
  }
});

test("client serializes the opt-in only for grade lists and preserves the default request", async () => {
  const urls = [];
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", compile(path.join(root, "src/lib/api.ts")))(
    name => name === "./read-deadline" ? { withReadDeadline: fn => fn() } : {}, module, module.exports,
    async url => { urls.push(new URL(url, "https://teacherpro.test")); return Response.json({ grades: [] }); },
  );
  await module.exports.gradeApi.list();
  await module.exports.gradeApi.list({ includeRecordedImpact: false });
  await module.exports.gradeApi.list({ includeRecordedImpact: true });
  await module.exports.gradeApi.listByStudent({ includeRecordedImpact: true });
  assert.deepEqual(urls.map(url => url.searchParams.get("includeRecordedImpact")), [null, null, "1", null]);
});
