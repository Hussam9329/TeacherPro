import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadPureTypeScriptModule(relativeFile, mocks = new Map()) {
  const absoluteFile = path.join(root, relativeFile);
  const source = fs.readFileSync(absoluteFile, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: absoluteFile,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const localRequire = (specifier) =>
    mocks.has(specifier) ? mocks.get(specifier) : require(specifier);
  const execute = new Function("exports", "require", "module", compiled);
  execute(moduleRecord.exports, localRequire, moduleRecord);
  return moduleRecord.exports;
}

const profile = loadPureTypeScriptModule("src/lib/student-profile-state.ts");
const profileServer = loadPureTypeScriptModule(
  "src/lib/student-profile-server.ts",
  new Map([
    [
      "@/lib/server-auth",
      {
        hasPermission: (principal, permission) =>
          Boolean(
            principal?.isAdmin ||
              (principal?.permissions || []).includes(permission),
          ),
      },
    ],
  ]),
);
const profileDialogSource = fs.readFileSync(
  path.join(root, "src/components/teacher-pro/student-profile-dialog.tsx"),
  "utf8",
);
const globalCssSource = fs.readFileSync(
  path.join(root, "src/app/globals.css"),
  "utf8",
);

test("a successful database null never falls back to a cached active chapter", () => {
  const cachedStudentChapter = { id: "stale", name: "فصل قديم" };
  const cachedCourseChapter = { id: "course", name: "فصل من الكاش" };

  assert.equal(
    profile.resolveStudentProfileActiveChapter(
      { activeChapter: null },
      cachedStudentChapter,
      cachedCourseChapter,
    ),
    null,
  );
  assert.deepEqual(
    profile.resolveStudentProfileActiveChapter(
      null,
      cachedStudentChapter,
      cachedCourseChapter,
    ),
    cachedStudentChapter,
  );
});

test("switching A to B clears A immediately and rejects A's late response", () => {
  let state = profile.createStudentProfileRemoteState();
  state = profile.beginStudentProfileRemoteLoad(state, "student-a", 1);
  state = profile.succeedStudentProfileRemoteLoad(
    state,
    "student-a",
    1,
    { grades: [{ id: "grade-a" }] },
  );

  state = profile.beginStudentProfileRemoteLoad(state, "student-b", 2);
  assert.equal(state.studentId, "student-b");
  assert.equal(state.data, null);

  const afterLateA = profile.succeedStudentProfileRemoteLoad(
    state,
    "student-a",
    1,
    { grades: [{ id: "late-grade-a" }] },
  );
  assert.equal(afterLateA, state);
  assert.equal(afterLateA.data, null);

  const readyB = profile.succeedStudentProfileRemoteLoad(
    afterLateA,
    "student-b",
    2,
    { grades: [{ id: "grade-b" }] },
  );
  assert.deepEqual(readyB.data, { grades: [{ id: "grade-b" }] });
});

test("a same-student refresh keeps the last successful snapshot on failure", () => {
  let state = profile.createStudentProfileRemoteState();
  state = profile.beginStudentProfileRemoteLoad(state, "student-a", 1);
  state = profile.succeedStudentProfileRemoteLoad(
    state,
    "student-a",
    1,
    [{ id: "server-row" }],
  );
  state = profile.beginStudentProfileRemoteLoad(state, "student-a", 2);
  assert.deepEqual(state.data, [{ id: "server-row" }]);

  state = profile.failStudentProfileRemoteLoad(
    state,
    "student-a",
    2,
    "network failed",
  );
  const resolved = profile.resolveStudentProfileRemoteData(
    state,
    "student-a",
    [{ id: "partial-local-row" }],
  );
  assert.deepEqual(resolved.data, [{ id: "server-row" }]);
  assert.equal(resolved.source, "database");
  assert.equal(resolved.incomplete, true);
});

test("an authoritative empty response removes stale locally cached rows", () => {
  let state = profile.createStudentProfileRemoteState();
  state = profile.beginStudentProfileRemoteLoad(state, "student-a", 11);
  state = profile.succeedStudentProfileRemoteLoad(
    state,
    "student-a",
    11,
    [],
  );
  const resolved = profile.resolveStudentProfileRemoteData(
    state,
    "student-a",
    [{ id: "deleted-on-server" }],
  );
  assert.deepEqual(resolved.data, []);
  assert.equal(resolved.source, "database");
  assert.equal(resolved.incomplete, false);
});

test("profile cards open the matching filtered content", () => {
  assert.deepEqual(profile.getStudentProfileCardTarget("absences"), {
    tab: "grades",
    gradeFilter: "absent",
    followupFilter: "all",
  });
  assert.deepEqual(profile.getStudentProfileCardTarget("grace-grades"), {
    tab: "grades",
    gradeFilter: "grace",
    followupFilter: "all",
  });
  assert.deepEqual(profile.getStudentProfileCardTarget("calls"), {
    tab: "followup",
    gradeFilter: "all",
    followupFilter: "calls",
  });

  const rows = [
    { id: "charged-absence", status: "غائب" },
    { id: "grace-absence", status: "غائب", withinGrace: true },
    { id: "protected-absence", status: "غائب", withoutDiscount: true },
    { id: "classified-charge", status: "غائب", impactKind: "absent-deducted" },
    { id: "classified-grace", status: "غائب", impactKind: "grace-period" },
    { id: "classified-leave", status: "غائب", impactKind: "excused" },
    { id: "score", status: "درجة" },
  ];
  assert.deepEqual(
    profile.filterStudentProfileGrades(rows, "absent").map((row) => row.id),
    ["charged-absence", "classified-charge"],
  );
  assert.deepEqual(
    profile.filterStudentProfileGrades(rows, "grace").map((row) => row.id),
    ["grace-absence", "classified-grace"],
  );
  assert.deepEqual(
    profile
      .filterStudentProfileGrades(rows, "no-discount")
      .map((row) => row.id),
    ["protected-absence"],
  );
});

test("timeline count includes each visible source exactly once", () => {
  assert.equal(
    profile.calculateStudentProfileTimelineCount({
      grades: 3,
      opportunityLogs: 2,
      calls: 4,
      leaves: 1,
      notes: 5,
      auditLogs: 6,
    }),
    22,
  );
  assert.equal(
    profile.calculateStudentProfileTimelineCount({
      grades: -2,
      opportunityLogs: Number.NaN,
      calls: 0,
      leaves: 0,
      notes: 0,
      auditLogs: 0,
    }),
    1,
  );
});

test("server activity counters do not double-count notes or final-chance logs", () => {
  const summary = profileServer.summarizeStudentProfileActivity({
    gradeCount: 3,
    opportunityLogs: [
      { action: "خصم", amount: 1 },
      { action: "إضافة", amount: 2 },
      { action: "إعادة تفعيل", amount: 0 },
      { action: "فرصة أخيرة بعد تعهد", amount: 1 },
    ],
    studentNotes: [
      { kind: "إجراء", text: "فصل الطالب (فصل مؤقت)", dismissalType: "فصل مؤقت" },
      { kind: "إجراء", text: "تعديل إداري", dismissalType: "" },
      { kind: "تعهد ولي الأمر", text: "تعهد", dismissalType: "" },
    ],
    callsCount: 2,
    leavesCount: 1,
    auditCount: 4,
  });
  assert.deepEqual(summary, {
    deductedMovements: 1,
    addedMovements: 2,
    dismissals: 1,
    reactivations: 1,
    actions: 6,
    timeline: 18,
  });
});

test("audit ownership uses exact id/code tokens, not names or substrings", () => {
  const student = { id: "student-123", code: "ST-100" };
  assert.equal(
    profile.studentAuditLogMatchesIdentity(
      { details: "تعديل الطالب [student-123]" },
      student,
    ),
    true,
  );
  assert.equal(
    profile.studentAuditLogMatchesIdentity(
      { details: "فصل الطالب - ST-100 - سبب" },
      student,
    ),
    true,
  );
  assert.equal(
    profile.studentAuditLogMatchesIdentity(
      { details: "سجل الطالب ST-1000" },
      student,
    ),
    false,
  );
  assert.equal(
    profile.studentAuditLogMatchesIdentity(
      { details: "إجراء باسم طالب مشابه فقط" },
      student,
    ),
    false,
  );
});

test("database audit candidate filtering cannot attribute a prefix collision", async () => {
  const candidates = [
    { id: "right-id", details: "تعديل [student-123]" },
    { id: "wrong-id-prefix", details: "تعديل [student-1234]" },
    { id: "right-code", details: "فصل الطالب - ST-100 - سبب" },
    { id: "wrong-code-prefix", details: "فصل الطالب - ST-1000 - سبب" },
    { id: "wrong-name", details: "تعديل الطالب علي حسن" },
  ];
  const fakeClient = {
    auditLog: {
      findMany: async () => candidates,
    },
  };
  const result = await profileServer.loadStudentProfileAuditLogs(
    fakeClient,
    { id: "student-123", code: "ST-100" },
    { limit: 100 },
  );
  assert.deepEqual(
    result.logs.map((log) => log.id),
    ["right-id", "right-code"],
  );
  assert.deepEqual(result.metadata, {
    limit: 100,
    returned: 2,
    truncated: false,
    matchSource: "student-id-or-exact-code",
  });
});

test("profile archive sections are removed according to the viewer's permissions", () => {
  const access = profileServer.studentProfileSectionAccess({
    isAdmin: false,
    permissions: ["students.view", "grades.view"],
  });
  const sanitized = profileServer.sanitizeEnrollmentArchiveSnapshot(
    {
      student: { id: "student-a" },
      grades: [{ id: "grade-a" }],
      opportunityLogs: [{ id: "opp-a" }],
      studentCalls: [{ id: "call-a" }],
      correctionSheets: [{ id: "sheet-a" }],
      auditLogs: [{ id: "audit-a" }],
      counts: {
        grades: 1,
        opportunityLogs: 1,
        studentCalls: 1,
        correctionSheets: 1,
        auditLogs: 1,
      },
    },
    access,
  );
  assert.deepEqual(Object.keys(sanitized).sort(), ["counts", "grades", "student"]);
  assert.deepEqual(sanitized.counts, { grades: 1 });
});

test("profile student fields are redacted without students.view", () => {
  const restrictedAccess = profileServer.studentProfileSectionAccess({
    isAdmin: false,
    permissions: ["grades.view"],
  });
  const redacted = profileServer.studentProfileStudentForAccess(
    {
      id: "student-a",
      courseId: "course-a",
      name: "اسم خاص",
      phone: "07000000000",
      parentPhone: "07111111111",
      opportunities: 2,
      opportunityLimit: 3,
    },
    restrictedAccess,
  );
  assert.deepEqual(redacted, {
    id: "student-a",
    courseId: "course-a",
    opportunities: 2,
    opportunityLimit: 3,
  });
});

test("the fullscreen profile exposes loading, failure, and modal semantics", () => {
  assert.match(profileDialogSource, /role="dialog"/);
  assert.match(profileDialogSource, /aria-modal="true"/);
  assert.match(profileDialogSource, /aria-labelledby="student-profile-title"/);
  assert.match(profileDialogSource, /role="status"/);
  assert.match(profileDialogSource, /role="alert"/);
  assert.match(profileDialogSource, /event\.key\s*===\s*["']Escape["']/);
  assert.match(profileDialogSource, /!href\s*\|\|\s*href\s*===\s*["']#["']/);
  assert.match(profileDialogSource, /databaseStatsSnapshotVersion\s*!==\s*databaseProfileSnapshotVersion/);
  assert.match(profileDialogSource, /visibleStudentLog\.map/);
});

test("the mobile profile uses the dynamic viewport and reachable horizontal navigation", () => {
  assert.match(profileDialogSource, /\bh-dvh\b/);
  assert.match(globalCssSource, /\.tp-student-profile__nav[^}]*overflow-x:\s*auto/s);
});
