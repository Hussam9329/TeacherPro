import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

// Exercise the real route handlers and token helpers with an in-memory database.
// No application database, production credentials, HTTP requests, or timers run.
const require = createRequire(import.meta.url);
const ts = require("typescript");
function loadModule(path, dependencies) {
  const output = ts.transpileModule(
    fs.readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    exports: module.exports,
    require: (specifier) => {
      assert.ok(dependencies.has(specifier), `Unmocked dependency: ${specifier}`);
      return dependencies.get(specifier);
    },
    Date,
    URL,
    console: { error: () => {} },
  });
  return module.exports;
}

class NextResponse extends Response {
  static json(body, init) {
    return new NextResponse(JSON.stringify(body), {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}

const tokenDependencies = new Map([["node:crypto", require("node:crypto")]]);
const previewToken = loadModule("../src/lib/mutation-preview-token.ts", tokenDependencies);
const tokens = loadModule("../src/lib/student-mutation-token.ts", new Map([
  ["@/lib/mutation-preview-token", previewToken],
]));
const baghdad = loadModule("../src/lib/baghdad-time.ts", new Map([
  ["./format", {}],
]));
const grace = loadModule("../src/lib/student-grace.ts", new Map([
  ["@/lib/baghdad-time", baghdad],
]));

const historyServer = loadModule("../src/lib/student-grace-history-server.ts", new Map([
  ["@/lib/student-grace", grace],
  ["@/lib/baghdad-time", baghdad],
]));

function fixture(overrides = {}) {
  return {
    id: "fixture-student", name: "fixture student", code: "FIXTURE-1",
    courseId: "fixture-course", courseProgram: "منهج كامل", courseTerm: "",
    studyType: "إلكتروني", locationScope: "محافظات", baghdadMode: "",
    mainSite: "محافظات", subSite: "كركوك", school: "fixture school",
    status: "مفصول", opportunities: 0, baseOpportunities: 5,
    dismissalReason: "fixture dismissal", dismissalNotes: "",
    accountingGraceDays: 6,
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    gracePeriodStartDate: new Date("2026-09-10T00:00:00.000Z"),
    gracePeriodEndedAt: new Date("2026-09-11T09:00:00.000Z"),
    gracePeriodHistory: [],
    ...overrides,
  };
}

function createHarness(options = {}) {
  let stored = structuredClone(options.student ?? fixture());
  const before = structuredClone(stored);
  const events = [];
  const writes = [];
  const previewProposals = [];
  const course = { id: "fixture-course", active: true };
  const principal = { id: "fixture-admin", name: "fixture admin", isAdmin: true };
  let reads = 0;
  const snapshot = async (students) => {
    events.push("opportunity-snapshot");
    return students.map((student) => ({
      ...student,
      // The displayed active chapter cap can differ from its historical DB value.
      baseOpportunities: 3,
      currentChapterId: "fixture-chapter",
    }));
  };
  const tx = {
    student: {
      findUnique: async () => {
        events.push("transaction-student-read");
        return structuredClone(stored);
      },
      update: async ({ where, data }) => {
        assert.equal(where.id, stored.id);
        events.push("student-write");
        writes.push(structuredClone(data));
        stored = { ...stored, ...structuredClone(data) };
        return structuredClone(stored);
      },
    },
    course: { findUnique: async () => course },
    auditLog: { create: async () => { events.push("audit-write"); return {}; } },
    grade: { findMany: async () => structuredClone(options.grades || []) },
    studentLeaveGradeBackup: { findMany: async () => structuredClone(options.backups || []) },
    courseChapter: { findMany: async () => [{ chapter: { name: "fixture chapter", opportunities: 3 } }] },
  };
  const routeHelpers = {
    isDatabaseMigrationRequiredError: () => false,
    isMissingDatabaseObjectError: () => false,
    validationError: (error, status = 400) => NextResponse.json({ error }, { status }),
    routeErrorResponse: (_error, message) => NextResponse.json({ error: message }, { status: 500 }),
  };
  const permissions = [];
  const dependencies = new Map([
    ["next/server", { NextResponse }],
    ["@/lib/server-auth", {
      requirePermissionPrincipal: async (_request, permission) => {
        permissions.push(permission);
        return options.forbidden ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : principal;
      },
      requirePermission: async (_request, permission) => {
        permissions.push(permission);
        return options.forbidden ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : null;
      },
    }],
    ["@/lib/db", { db: {
      student: { findUnique: async () => {
        reads += 1;
        events.push("student-read");
        if (options.readError) throw new Error("injected read failure");
        if (options.notFound) return null;
        return structuredClone(options.initialStudent ?? stored);
      } },
      course: { findUnique: async () => course },
    } }],
    ["@/lib/format", {}],
    ["@/lib/student-utils", {}],
    ["@/lib/validation", {}],
    ["@/lib/route-helpers", routeHelpers],
    ["@/lib/student-delete-impact", { ARCHIVED_STUDENT_STATUS: "مؤرشف" }],
    ["@/lib/course-config", {
      validateStudentCourseChoices: () => ({ ok: true }),
      resolveSubSite: (_course, _study, _scope, _mode, subSite) => subSite,
    }],
    ["@/lib/academic-recalculate-server", {
      recalculateStudentsAcademicState: async (ids, context) => {
        assert.deepEqual(Array.from(ids), [stored.id]);
        assert.equal(context.tx, tx);
        events.push("academic-recalculation");
        return { students: [] };
      },
    }],
    ["@/lib/student-opportunity-snapshot-server", { attachStudentOpportunitySnapshots: snapshot }],
    ["@/lib/serializable-transaction", {
      withSerializableTransaction: async (callback) => {
        events.push("transaction-begin");
        const transactionBefore = structuredClone(stored);
        try { return await callback(tx); }
        catch (error) { stored = transactionBefore; throw error; }
      },
    }],
    ["@/lib/student-enrollment-archive-server", {
      archiveAndResetStudentEnrollment: async (context) => {
        assert.equal(context, tx);
        events.push("enrollment-archive");
        return { archiveId: "fixture-archive" };
      },
    }],
    ["@/lib/student-academic-impact-token", {
      buildStudentAcademicImpactToken: async (context, proposal) => {
        assert.equal(context, tx);
        events.push("academic-preview-check");
        assert.equal(proposal.studentId, stored.id);
        previewProposals.push(structuredClone(proposal));
        assert.equal(proposal.proposedGraceEndedAt, null, "renewal must preview reopening grace, not retaining the old end marker");
        return "current-academic-preview";
      },
    }],
    ["@/lib/student-code-sequence", {}],
    ["@/lib/schema-readiness", {}],
    ["@/lib/student-grace", grace],
    ["@/lib/student-grace-history-server", historyServer],
    ["@/lib/grace-period-repair-server", {
      repairProtectedAbsencesForStudents: async () => { events.push("absence-repair"); },
    }],
    ["@/lib/baghdad-time", baghdad],
    ["@/lib/protected-grade-markers-server", {
      reconcileProtectedGradeMarkersForStudentAcademicEdit: async () => { events.push("marker-reconcile"); },
      ensureProtectedGradeMarkers: async () => { events.push("marker-ensure"); },
    }],
    ["@/lib/student-mutation-token", tokens],
    ["@/lib/student-registry-filters-server", {}],
  ]);
  const put = loadModule("../src/app/api/students/route.ts", dependencies).PUT;
  const get = loadModule("../src/app/api/students/edit-snapshot/route.ts", dependencies).GET;
  return {
    before, events, writes, permissions, previewProposals,
    student: () => structuredClone(stored),
    reads: () => reads,
    update: async (data) => {
      const response = await put({ json: async () => ({ id: stored.id, ...data }) });
      return { status: response.status, body: await response.json() };
    },
    snapshot: async (id = "fixture-student") => {
      const response = await get({ url: `https://fixture.invalid/api/students/edit-snapshot?id=${encodeURIComponent(id)}` });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    assertNoWrites: () => {
      assert.equal(writes.length, 0);
      assert.ok(!events.includes("audit-write"));
      assert.ok(!events.includes("academic-recalculation"));
      assert.deepEqual(stored, before);
    },
  };
}

const renewal = {
  accountingGraceDays: 6,
  gracePeriodStartMode: "registration",
};
const confirmedRenewal = {
  ...renewal,
  academicImpactConfirmed: true,
  academicImpactPreviewToken: "current-academic-preview",
  academicImpactPreviewGraceStartDate: "2026-09-10T00:00:00.000Z",
};

test("reopening ended grace on the same start date requires an impact preview", async () => {
  const harness = createHarness();
  const result = await harness.update(renewal);
  assert.equal(result.status, 409);
  assert.equal(result.body.requiresAcademicImpactPreview, true);
  harness.assertNoWrites();
});

test("ended-at-only renewal validates preview before reconciling and recalculating", async () => {
  const harness = createHarness();
  const result = await harness.update({
    ...confirmedRenewal,
    expectedMutationToken: tokens.buildStudentMutationToken(harness.before),
  });
  assert.equal(result.status, 200);
  assert.equal(harness.student().gracePeriodEndedAt, null);
  assert.equal(harness.student().accountingGraceDays, harness.before.accountingGraceDays);
  assert.equal(harness.student().gracePeriodStartDate.getTime(), harness.before.gracePeriodStartDate.getTime());
  const academicEvents = harness.events.filter((event) => [
    "academic-preview-check", "student-write", "marker-reconcile", "marker-ensure",
    "absence-repair", "academic-recalculation", "audit-write",
  ].includes(event));
  assert.deepEqual(academicEvents, [
    "academic-preview-check", "student-write", "marker-reconcile", "marker-ensure",
    "absence-repair", "academic-recalculation", "audit-write",
  ]);
  assert.equal(harness.writes[0].opportunities, undefined, "profile edit must not directly overwrite balances");
  assert.equal(harness.writes[0].baseOpportunities, undefined);
  assert.equal(result.body.student.baseOpportunities, 3);
  assert.equal(result.body.student.mutationToken, tokens.buildStudentMutationToken(harness.student()));
});

test("stale academic preview cannot reopen ended grace", async () => {
  const harness = createHarness();
  const result = await harness.update({ ...confirmedRenewal, academicImpactPreviewToken: "stale-preview" });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /بعد المعاينة/);
  harness.assertNoWrites();
});

test("transaction independently detects an ended-at-only renewal after the initial read", async () => {
  const harness = createHarness({ initialStudent: fixture({ gracePeriodEndedAt: null }) });
  const result = await harness.update({
    ...renewal,
    expectedMutationToken: tokens.buildStudentMutationToken(harness.before),
  });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /معاينة أثر مؤكدة/);
  assert.ok(harness.events.includes("transaction-begin"));
  harness.assertNoWrites();
});

test("a genuinely changed student still rejects the old mutation token before writes", async () => {
  const harness = createHarness();
  const oldStudent = { ...harness.before, school: "old school" };
  const result = await harness.update({
    ...confirmedRenewal,
    expectedMutationToken: tokens.buildStudentMutationToken(oldStudent),
  });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /بعد فتحه للتعديل/);
  assert.ok(!harness.events.includes("academic-preview-check"));
  harness.assertNoWrites();
});

test("ordinary profile edits retain ended grace and never recalculate balances", async () => {
  const harness = createHarness();
  const result = await harness.update({
    school: "updated school", accountingGraceDays: 6,
    expectedMutationToken: tokens.buildStudentMutationToken(harness.before),
  });
  assert.equal(result.status, 200);
  assert.equal(harness.student().school, "updated school");
  assert.equal(harness.student().gracePeriodEndedAt.getTime(), harness.before.gracePeriodEndedAt.getTime());
  assert.ok(!harness.events.includes("academic-preview-check"));
  assert.ok(!harness.events.includes("academic-recalculation"));
  assert.equal(harness.student().opportunities, harness.before.opportunities);
  assert.equal(harness.student().baseOpportunities, harness.before.baseOpportunities);
  assert.deepEqual(harness.student().gracePeriodHistory, harness.before.gracePeriodHistory);
  assert.equal(harness.writes[0].gracePeriodHistory, undefined, "ordinary edits must not rewrite grace history");
});

test("archived students cannot bypass academic edit protection with ended-at-only renewal", async () => {
  const harness = createHarness({ student: fixture({ status: "مؤرشف" }) });
  const result = await harness.update(confirmedRenewal);
  assert.equal(result.status, 409);
  assert.match(result.body.error, /مؤرشف/);
  harness.assertNoWrites();
});

test("display normalization never changes the underlying mutation token", () => {
  const raw = fixture();
  const displayed = { ...raw, baseOpportunities: 3 };
  assert.notEqual(tokens.buildStudentMutationToken(displayed), tokens.buildStudentMutationToken(raw));
  const result = tokens.withStudentMutationToken(displayed, raw);
  assert.equal(result.baseOpportunities, 3);
  assert.equal(result.mutationToken, tokens.buildStudentMutationToken(raw));
  assert.equal(tokens.withStudentMutationToken(raw).mutationToken, tokens.buildStudentMutationToken(raw));
});

test("academic preview tokens distinguish retaining ended grace from reopening it", async () => {
  const raw = fixture();
  const client = { student: { findUnique: async () => structuredClone(raw) } };
  for (const model of ["grade", "studentLeave", "opportunityLog", "studentNote", "exam", "courseChapter", "chapter"]) {
    client[model] = { findMany: async () => [] };
  }
  const academicTokens = loadModule("../src/lib/student-academic-impact-token.ts", new Map([
    ["node:crypto", require("node:crypto")],
    ["@/lib/db", { db: client }],
    ["@/lib/baghdad-time", baghdad],
  ]));
  const proposal = {
    studentId: raw.id,
    proposedCreatedAt: raw.createdAt,
    proposedGraceDays: raw.accountingGraceDays,
    proposedGraceStartDate: raw.gracePeriodStartDate,
  };
  const retaining = await academicTokens.buildStudentAcademicImpactToken(client, {
    ...proposal, proposedGraceEndedAt: raw.gracePeriodEndedAt,
  });
  const reopening = await academicTokens.buildStudentAcademicImpactToken(client, {
    ...proposal, proposedGraceEndedAt: null,
  });
  assert.notEqual(retaining, reopening, "a preview that keeps grace ended must not authorize a renewal");
  assert.equal(reopening, await academicTokens.buildStudentAcademicImpactToken(client, {
    ...proposal, proposedGraceEndedAt: null,
  }), "the identical renewal proposal remains stable across preview and save");
});

test("fresh edit snapshot is an authorized uncached read with a raw-record token", async () => {
  const harness = createHarness();
  const result = await harness.snapshot();
  assert.equal(result.status, 200);
  assert.match(result.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(harness.permissions, ["students.edit"]);
  assert.equal(result.body.student.baseOpportunities, 3);
  assert.equal(result.body.student.mutationToken, tokens.buildStudentMutationToken(harness.before));
  assert.equal(harness.reads(), 1);
  assert.ok(!harness.events.includes("transaction-begin"));
  harness.assertNoWrites();
});

test("edit snapshot rejects missing identifiers without database access", async () => {
  const harness = createHarness();
  assert.equal((await harness.snapshot(" ")).status, 400);
  assert.equal(harness.reads(), 0);
  harness.assertNoWrites();
});

test("edit snapshot rejects unauthorized requests before reading the student", async () => {
  const harness = createHarness({ forbidden: true });
  assert.equal((await harness.snapshot()).status, 403);
  assert.deepEqual(harness.permissions, ["students.edit"]);
  assert.equal(harness.reads(), 0);
  harness.assertNoWrites();
});

test("edit snapshot returns 404 for a missing student without writes", async () => {
  const harness = createHarness({ notFound: true });
  assert.equal((await harness.snapshot()).status, 404);
  harness.assertNoWrites();
});

test("edit snapshot handles a database read failure without retrying a mutation", async () => {
  const harness = createHarness({ readError: true });
  assert.equal((await harness.snapshot()).status, 500);
  assert.equal(harness.reads(), 1);
  harness.assertNoWrites();
});

test("renewal persists elapsed grace so old and new exam dates remain protected", async () => {
  const harness = createHarness({ student: fixture({ gracePeriodEndedAt: null }) });
  const today = baghdad.baghdadTodayKey();
  const result = await harness.update({
    ...confirmedRenewal,
    gracePeriodStartMode: "now",
    academicImpactPreviewGraceStartDate: today,
    expectedMutationToken: tokens.buildStudentMutationToken(harness.before),
  });
  assert.equal(result.status, 200, result.body.error);
  const student = harness.student();
  assert.equal(baghdad.baghdadDateKey(student.gracePeriodStartDate), today);
  assert.ok(grace.isExamWithinStudentGraceWindow(student, { id: "old-exam", date: "2026-09-12" }), "renewal must retain the earlier granted right even without a Grade row");
  assert.ok(grace.isExamWithinStudentGraceWindow(student, { id: "new-exam", date: today }));
  assert.equal(grace.isExamWithinStudentGraceWindow(student, { id: "gap-exam", date: "2026-09-17" }), false, "a gap between grants must not become exempt");
  assert.deepEqual(student.gracePeriodHistory, harness.previewProposals[0].proposedGraceHistory, "the saved history must be exactly the history protected by confirmation");
  assert.equal(student.opportunities, harness.before.opportunities, "the route never directly overwrites balances while storing history");
});

test("renewal captures a legacy grace marker instead of exposing it to reconciliation", async () => {
  const harness = createHarness({
    grades: [{ id: "legacy-grade", examId: "legacy-exam", status: "ضمن فترة السماح", score: null, exam: { id: "legacy-exam", date: new Date("2026-09-12T00:00:00.000Z") } }],
  });
  const result = await harness.update({
    ...confirmedRenewal,
    gracePeriodStartMode: "now",
    academicImpactPreviewGraceStartDate: baghdad.baghdadTodayKey(),
  });
  assert.equal(result.status, 200, result.body.error);
  const student = harness.student();
  assert.ok(grace.isExamWithinStudentGraceWindow(student, { id: "legacy-exam", date: "2026-09-12" }), "a legitimate saved historical grace marker must remain protected when dates are renewed");
  assert.equal(grace.isExamWithinStudentGraceWindow(student, { id: "unproven-exam", date: "2026-09-12" }), false, "a legacy marker must protect only its own exam, not all exams that day");
  assert.equal(grace.isExamWithinStudentGraceWindow(student, { id: "legacy-exam", date: "2026-09-13" }), false, "editing an exam date must not blindly carry its old protection");
});

test("client-supplied history cannot grant exemptions or replace saved history", async () => {
  const storedHistory = [{ start: "2026-09-10", endExclusive: "2026-09-11", excludedExamIds: [] }];
  const harness = createHarness({ student: fixture({ gracePeriodHistory: storedHistory }) });
  const result = await harness.update({
    school: "reviewed school",
    gracePeriodHistory: [{ start: "2026-01-01", endExclusive: "2027-01-01", excludedExamIds: [] }],
    expectedMutationToken: tokens.buildStudentMutationToken(harness.before),
  });
  assert.equal(result.status, 200, result.body.error);
  assert.deepEqual(harness.student().gracePeriodHistory, storedHistory);
  assert.equal(harness.writes[0].gracePeriodHistory, undefined);
  assert.ok(!harness.events.includes("academic-recalculation"));
});

test("a new enrollment clears old manual grace and retained history", async () => {
  const harness = createHarness({ student: fixture({
    gracePeriodEndedAt: null,
    gracePeriodHistory: [{ start: "2026-09-10", endExclusive: "2026-09-16", excludedExamIds: [] }],
  }) });
  const result = await harness.update({
    subSite: "بابل", courseTransferPolicy: "reset", accountingGraceDays: 6,
    expectedMutationToken: tokens.buildStudentMutationToken(harness.before),
  });
  assert.equal(result.status, 200, result.body.error);
  const student = harness.student();
  assert.ok(harness.events.includes("enrollment-archive"));
  assert.equal(student.accountingGraceDays, 0, "unchanged historical duration is not a new manual grant");
  assert.equal(student.gracePeriodStartDate, null);
  assert.equal(student.gracePeriodEndedAt, null);
  assert.deepEqual(student.gracePeriodHistory, []);
  assert.equal(grace.getStudentGraceWindow(student).source, "automatic");
  assert.equal(grace.getStudentGraceWindow(student).days, 3);
  assert.equal(grace.isExamWithinStudentGraceWindow(student, { id: "old-enrollment-exam", date: "2026-09-12" }), false);
});

test("academic preview and edit guards invalidate when source or proposed grace history changes", async () => {
  const history = [{ start: "2026-09-10", endExclusive: "2026-09-16", excludedExamIds: ["numeric-exam"] }];
  let raw = fixture({ gracePeriodHistory: history });
  const originalMutationToken = tokens.buildStudentMutationToken(raw);
  const client = { student: { findUnique: async ({ select }) => Object.fromEntries(Object.keys(select).map((key) => [key, structuredClone(raw[key])])) } };
  for (const model of ["grade", "studentLeave", "opportunityLog", "studentNote", "exam", "courseChapter", "chapter"]) {
    client[model] = { findMany: async () => [] };
  }
  const academicTokens = loadModule("../src/lib/student-academic-impact-token.ts", new Map([
    ["node:crypto", require("node:crypto")],
    ["@/lib/db", { db: client }],
    ["@/lib/baghdad-time", baghdad],
  ]));
  const proposal = { studentId: raw.id, proposedCreatedAt: raw.createdAt, proposedGraceDays: 6, proposedGraceStartDate: raw.gracePeriodStartDate, proposedGraceHistory: history };
  const first = await academicTokens.buildStudentAcademicImpactToken(client, proposal);
  assert.equal(first, await academicTokens.buildStudentAcademicImpactToken(client, proposal));
  assert.notEqual(first, await academicTokens.buildStudentAcademicImpactToken(client, { ...proposal, proposedGraceHistory: [] }), "the displayed proposal cannot authorize a different historical exemption set");
  raw = { ...raw, gracePeriodHistory: [] };
  assert.notEqual(first, await academicTokens.buildStudentAcademicImpactToken(client, proposal), "a concurrent history change invalidates the old preview");
  assert.notEqual(originalMutationToken, tokens.buildStudentMutationToken(raw), "the edit guard must reject an editor opened before a history change");
});
