const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");

// Runs the real bulk-add route (filter mode) with its database helpers
// replaced: dismissed students in a bulk add must come back to active through
// the one restoration service the single add uses, never be dropped silently.
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/app/api/opportunities/bulk-adjust/route.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

class StudentActionError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.statusCode = statusCode;
  }
}

function load(state) {
  const mocks = {
    "next/server": { NextRequest, NextResponse },
    "@/lib/server-auth": {
      requirePermissionPrincipal: async (_req, permission) => {
        assert.equal(permission, "opportunities.manage");
        return state.principal;
      },
      hasPermission: (principal, permission) => principal.isAdmin || principal.permissions.includes(permission),
    },
    "@/lib/route-helpers": {
      validationError: (message, status = 400) => NextResponse.json({ error: message }, { status }),
      routeErrorResponse: (_error, message) => NextResponse.json({ error: message }, { status: 500 }),
    },
    "@/lib/schema-readiness": { withDatabaseSchema: async (run) => run() },
    "@/lib/api-rate-limit": { API_RATE_LIMITS: { bulkOpportunities: {} }, checkApiRateLimit: async () => null },
    "@/lib/opportunity-filters-server": {
      normalizeBoolean: (value, fallback) => (value === undefined || value === null || value === "" ? fallback : value === true || value === "true"),
    },
    "@/lib/academic-recalculate-server": {
      recalculateStudentsAcademicState: async (ids) => {
        state.recalculated.push(...ids);
        return { students: ids.map((id) => ({ id })) };
      },
    },
    "@/lib/audit-log-server": { writeRequestAuditLog: async (_req, _module, action, details) => { state.audits.push({ action, details }); } },
    "@/lib/global-side-effects-safety": {
      globalImpactConfirmationResponse: (message) => NextResponse.json({ error: message }, { status: 409 }),
      isConfirmedImpact: (value) => value === true,
      riskyBulkOpportunityTargetCount: () => false,
    },
    "@/lib/serializable-transaction": { withSerializableTransaction: async (run) => run(state.tx) },
    "@/lib/bulk-opportunity-preview-server": {
      buildBulkOpportunityPreview: async (_tx, input) => {
        state.previewInputs.push(input);
        const targetRows = state.rows.filter((row) => !(input.excludeDismissed && row.status === "مفصول"));
        return {
          targetRows,
          totalMatching: state.rows.length,
          eligibleWithActiveChapter: state.rows.length,
          noActiveChapter: 0,
          activeChapterConflicts: 0,
          zeroOpportunityLimit: 0,
          invalidOpportunitySource: 0,
          targetCount: targetRows.length,
          skipped: state.rows.length - targetRows.length,
          previewToken: "token-1",
        };
      },
    },
    "@/lib/opportunity-balance": { ZERO_BALANCE_VIOLATION_MARKER: "[zero]" },
    "@/lib/manual-restoration": { DEFAULT_MANUAL_RESTORATION_REASON: "استعادة يدوية" },
    "@/lib/manual-student-restoration-server": {
      StudentActionError,
      restoreDismissedStudentManually: async (tx, input) => {
        assert.equal(tx, state.tx, "restoration runs in the same transaction");
        state.restored.push(input);
        return { opportunityLogs: [{}, {}], studentNotes: [{}], reactivated: true };
      },
    },
  };
  const module = { exports: {} };
  new Function("module", "exports", "require", output)(module, module.exports, (name) => {
    assert(name in mocks, `unexpected route dependency: ${name}`);
    return mocks[name];
  });
  return module.exports;
}

const chapter = { id: "ch1", name: "الفصل الأول", opportunities: 3 };
const dismissed = (id) => ({ id, status: "مفصول", opportunities: 0, baseOpportunities: 3, courseId: "c1", activeChapter: chapter });
const active = (id, opportunities = 1) => ({ id, status: "نشط", opportunities, baseOpportunities: 3, courseId: "c1", activeChapter: chapter });

function scenario({ rows, permissions = ["opportunities.manage", "students.edit"] }) {
  return {
    rows,
    principal: { id: "u1", name: "موظف", isAdmin: false, permissions },
    tx: { opportunityLog: { createMany: async ({ data }) => { state.logs.push(...data); } } },
    restored: [],
    recalculated: [],
    audits: [],
    previewInputs: [],
    logs: [],
  };
}
let state;

async function post(body) {
  const { POST } = load(state);
  const res = await POST(new NextRequest("https://teacherpro.test/api/opportunities/bulk-adjust", {
    method: "POST",
    body: JSON.stringify({ mode: "filter", previewToken: "token-1", confirmImpact: true, reason: "تعويض", ...body }),
  }));
  return { status: res.status, data: await res.json() };
}

(async () => {
  // «مفصول» filter, «عدا المفصولين» off: every dismissed student comes back.
  state = scenario({ rows: [dismissed("d1"), dismissed("d2")] });
  let res = await post({ status: "dismissed", actionType: "add", amount: 1, excludeDismissed: false });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(state.restored.map((call) => [call.studentId, call.amount]), [["d1", 1], ["d2", 1]]);
  assert(state.restored.every((call) => call.reason === "استعادة يدوية — تعويض" && call.actor.id === "u1"));
  assert.equal(res.data.updatedStudents, 2);
  assert.equal(res.data.reactivatedStudents, 2);
  assert.equal(state.logs.length, 0, "no plain «إضافة» log is written for a dismissed student");
  assert.deepEqual(state.recalculated, []);
  assert.equal(state.audits[0].details.reactivatedStudents, 2);
  console.log("PASS: a bulk add on dismissed students returns each to active through the restoration service, with the reason and the actor");

  // A larger amount never passes the chapter cap; active students keep the normal add.
  state = scenario({ rows: [dismissed("d1"), active("a1", 1)] });
  res = await post({ actionType: "add", amount: 5, excludeDismissed: false });
  assert.equal(res.status, 200);
  assert.deepEqual(state.restored.map((call) => [call.studentId, call.amount]), [["d1", 3]]);
  assert.deepEqual(state.logs.map((log) => [log.studentId, log.appliedAmount]), [["a1", 2]]);
  assert.deepEqual(state.recalculated, ["a1"]);
  assert.equal(res.data.updatedStudents, 2);
  console.log("PASS: mixed lists add to active students as before and return dismissed ones within the chapter cap");

  // «عدا المفصولين» on: dismissed students are left as they are.
  state = scenario({ rows: [dismissed("d1"), active("a1", 1)] });
  res = await post({ actionType: "add", amount: 1, excludeDismissed: true });
  assert.equal(res.status, 200);
  assert.deepEqual(state.restored, []);
  assert.equal(res.data.reactivatedStudents, 0);
  console.log("PASS: with «عدا المفصولين» ticked dismissed students are untouched");

  // Returning a student needs students.edit, like the single add.
  state = scenario({ rows: [dismissed("d1")], permissions: ["opportunities.manage"] });
  res = await post({ actionType: "add", amount: 1, excludeDismissed: false });
  assert.equal(res.status, 403);
  assert.match(res.data.error, /صلاحية تعديل الطلاب/);
  assert.deepEqual(state.restored, []);
  console.log("PASS: without students.edit the bulk add stops with a clear Arabic message and returns nobody");

  // A bulk deduct never touches dismissed students.
  state = scenario({ rows: [dismissed("d1"), active("a1", 2)] });
  res = await post({ actionType: "deduct", amount: 1, excludeDismissed: false, excludeFullOpportunities: false });
  assert.equal(res.status, 200);
  assert.deepEqual(state.restored, []);
  assert.deepEqual(state.logs.map((log) => log.studentId), ["a1"]);
  console.log("PASS: a bulk deduct skips dismissed students and returns nobody");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
