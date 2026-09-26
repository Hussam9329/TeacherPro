const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const date = (value) => new Date(value);

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename,
);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, isMain, options);
};

const student = {
  id: "student", name: "اسم خاص", code: "TEST-1", courseId: "course",
  status: "نشط", opportunities: 3, baseOpportunities: 3,
  dismissalReason: "", dismissalNotes: "", createdAt: date("2026-08-01T00:00:00Z"),
};
const chapter = { id: "chapter", name: "الفصل الحالي", opportunities: 3 };
const exam = {
  id: "exam", name: "الامتحان", type: "يومي", date: date("2026-09-16T00:00:00Z"),
  fullMark: 20, passMark: 15, discountMark: 0, opportunitiesPenalty: "1",
  dismissalGrade: null, noDiscount: false, active: true, scheduledActivateAt: null,
  telegramOpenAt: null, telegramCloseAt: null, courseIds: '["course"]', mainSite: null,
  examCourses: [{ courseId: "course", chapterId: "chapter" }],
};
const grade = {
  id: "grade", studentId: "student", examId: "exam", status: "غائب", score: null,
  notes: "ملاحظة خاصة لا تظهر في الأثر", academicEffectExcluded: false,
  academicEffectExclusionReason: null, academicEffectExclusionSource: null,
  createdAt: date("2026-09-19T05:00:00Z"), updatedAt: date("2026-09-19T05:00:00Z"),
};
const logs = [
  { id: "reset", studentId: "student", examId: null, action: "إعادة تعيين", amount: 3,
    requestedAmount: null, appliedAmount: null, balanceBefore: null, reversalOfLogId: null,
    balanceAfter: 3, ledgerVersion: 2, settledGradeIds: "[]", reason: "بداية الفصل",
    date: date("2026-09-13T13:00:00Z"), chapterId: "chapter", chapterNameSnapshot: "الفصل الحالي" },
  { id: "credit", studentId: "student", examId: null, action: "إضافة", amount: 2,
    requestedAmount: 3, appliedAmount: 2, balanceBefore: 1, balanceAfter: 3,
    reversalOfLogId: null, ledgerVersion: 2, settledGradeIds: null,
    reason: "سبب إداري خاص", date: date("2026-09-17T21:33:00Z"),
    chapterId: "chapter", chapterNameSnapshot: "الفصل الحالي" },
  { id: "saved-debit", studentId: "student", examId: "exam", action: "خصم تلقائي", amount: 1,
    requestedAmount: null, appliedAmount: null, balanceBefore: null, balanceAfter: null,
    reversalOfLogId: null, ledgerVersion: null, settledGradeIds: null,
    reason: "تلقائي: غياب", date: date("2026-09-16T00:00:00Z"),
    chapterId: "chapter", chapterNameSnapshot: "الفصل الحالي" },
];
const grace = { id: "grace", studentId: "student", startDate: date("2026-09-20"), endDate: date("2026-09-22") };
const activeLink = { id: "link", courseId: "course", chapterId: "chapter", active: true, archived: false, chapter };
let links = [activeLink];
let permissions = ["grades.view", "opportunities.view"];
let reportChapterId = chapter.id;
let inTransaction = false;
let reads = [];
const select = (row, selection) => !selection ? row : Object.fromEntries(Object.entries(selection)
  .filter(([, enabled]) => enabled)
  .map(([key]) => [key, row[key]]));
const findMany = (name, rows) => async (args) => {
  assert.equal(inTransaction, true, `${name} must be read in the profile snapshot`);
  reads.push({ name, args });
  return rows().map((row) => select(row, args?.select));
};
const tx = {
  student: {
    findUnique: async ({ select: selection }) => {
      assert.equal(inTransaction, true);
      reads.push({ name: "student" });
      return select(student, selection);
    },
    findMany: findMany("student", () => [student]),
  },
  grade: { findMany: findMany("grade", () => [grade]) },
  exam: { findMany: findMany("exam", () => [exam]) },
  opportunityLog: { findMany: findMany("opportunityLog", () => logs) },
  courseChapter: { findMany: findMany("courseChapter", () => links) },
  chapter: { findMany: findMany("chapter", () => [chapter]) },
  gracePeriod: { findMany: findMany("gracePeriod", () => [grace]) },
  studentLeave: { findMany: findMany("studentLeave", () => []) },
  studentNote: { findMany: findMany("studentNote", () => []) },
  studentCall: { findMany: findMany("studentCall", () => []) },
  studentEnrollmentArchive: { findMany: findMany("studentEnrollmentArchive", () => []) },
};
const fakeDb = {
  $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, "RepeatableRead");
    inTransaction = true;
    try { return await callback(tx); } finally { inTransaction = false; }
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/db") return { db: fakeDb };
  if (request === "@/lib/server-auth") return {
    requireAnyPermissionPrincipal: async () => ({ permissions }),
    hasPermission: (principal, permission) => principal.permissions.includes(permission),
  };
  if (request === "@/lib/active-chapter-report") return {
    loadActiveChapterReportContext: async () => ({ id: reportChapterId, name: chapter.name, since: null, examIds: [exam.id] }),
  };
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildAcademicStateFromRows, buildAcademicOpportunityCommandEffects, loadAcademicStateForStudents,
} = require("../src/lib/academic-recalculate-server.ts");
const { GET } = require("../src/app/api/students/profile-log/route.ts");
const { NextRequest } = require("next/server");

(async () => {
  const original = JSON.stringify({ student, grade, exam, logs, grace, links });
  const rows = {
    students: [{ ...student, gracePeriods: [{ id: grace.id, startDate: "2026-09-20", endDate: "2026-09-22" }] }],
    grades: [grade], exams: [exam], courseChapters: [activeLink], chapters: [chapter],
    opportunityLogs: logs, studentLeaves: [], studentNotes: [],
  };
  const state = buildAcademicStateFromRows(rows);
  inTransaction = true;
  const loaded = await loadAcademicStateForStudents(tx, [student.id]);
  inTransaction = false;
  assert.deepEqual(state, loaded, "profile and persistence use identical normalization including grace");
  assert.equal(state.exams[0].opportunitiesPenalty, 1);
  assert.equal(state.grades[0].createdAt, "2026-09-19T05:00:00.000Z");
  assert.equal(state.opportunityLogs[1].requestedAmount, 3);
  assert.equal(state.opportunityLogs[1].reversalOfLogId, null);
  const expected = [{ studentId: "student", chapterId: "chapter", logId: "credit", balanceBefore: 2, balanceAfter: 3, amount: 1, cap: 3 }];
  assert.deepEqual(buildAcademicOpportunityCommandEffects(state, student.id), expected);
  assert.deepEqual(buildAcademicOpportunityCommandEffects({ ...state, students: [{ ...state.students[0], opportunities: 2 }] }, student.id), [], "disagreement never fabricates a balance");
  assert.deepEqual(buildAcademicOpportunityCommandEffects({ ...state, students: [{ ...state.students[0], status: "مؤرشف" }] }, student.id), []);
  assert.deepEqual(buildAcademicOpportunityCommandEffects({ ...state, opportunityLogs: state.opportunityLogs.filter((log) => log.id !== "saved-debit") }, student.id), [], "equal balance does not hide a missing saved deduction");
  const legacy = { ...state.opportunityLogs[0], id: "legacy-reset", ledgerVersion: null, amount: 2, date: "2026-09-17T22:00:00.000Z" };
  assert.deepEqual(buildAcademicOpportunityCommandEffects({ ...state, opportunityLogs: [...state.opportunityLogs, legacy] }, student.id), [], "mixed legacy/current commands cannot explain a calendar ledger");
  assert.deepEqual(buildAcademicOpportunityCommandEffects({ ...state, opportunityLogs: [{ ...legacy, date: "2026-09-01T00:00:00.000Z" }, ...state.opportunityLogs] }, student.id), expected, "history before a structured settlement remains harmless");
  assert.deepEqual(buildAcademicOpportunityCommandEffects({ ...state, opportunityLogs: [{ ...legacy, amount: 3, chapterId: "old-chapter", date: "2026-08-14T00:00:00.000Z" }, ...state.opportunityLogs.filter((log) => log.id !== "reset")] }, student.id), expected, "a legacy baseline before every current-chapter event does not suppress its later dated credits");
  const preBaseline = structuredClone(state);
  preBaseline.students[0].opportunities = 2;
  preBaseline.opportunityLogs[0] = { ...preBaseline.opportunityLogs[0], amount: 2, balanceAfter: 2, date: "2026-09-18T00:00:00.000Z" };
  preBaseline.opportunityLogs[1] = { ...preBaseline.opportunityLogs[1], amount: 1, appliedAmount: 1, date: "2026-09-20T00:00:00.000Z" };
  assert.deepEqual(buildAcademicOpportunityCommandEffects(preBaseline, student.id), [], "unsettled result before the latest baseline cannot project a calendar balance");

  async function response() {
    reads = [];
    const result = await GET(new NextRequest("http://localhost/api/students/profile-log?studentId=student"));
    assert.equal(result.status, 200);
    return result.json();
  }
  const allowed = await response();
  assert.deepEqual(allowed.opportunityCommandEffects, expected);
  assert.equal(JSON.stringify(allowed.opportunityCommandEffects).includes("خاص"), false);
  assert.equal(reads.filter((read) => read.name === "grade").length, 1, "explanation adds no grade/state reload");
  assert.equal(reads.filter((read) => read.name === "opportunityLog").length, 1, "explanation adds no log reload");
  assert.equal(reads.find((read) => read.name === "opportunityLog").args.select.reversalOfLogId, true);
  assert.equal(reads.find((read) => read.name === "exam").args.select.telegramOpenAt, true);
  assert.equal(reads.find((read) => read.name === "exam").args.select.telegramCloseAt, true);

  for (const access of [["grades.view"], ["opportunities.view"], ["students.view"]]) {
    permissions = access;
    assert.deepEqual((await response()).opportunityCommandEffects, [], "both section permissions are required");
  }
  permissions = ["grades.view", "opportunities.view"];
  student.opportunities = 2;
  assert.deepEqual((await response()).opportunityCommandEffects, [], "saved-state mismatch suppresses explanation");
  student.opportunities = 3;
  reportChapterId = "other-chapter";
  assert.deepEqual((await response()).opportunityCommandEffects, [], "report chapter and balance chapter must agree");
  reportChapterId = chapter.id;
  const savedSettlement = logs[0].settledGradeIds;
  logs[0].settledGradeIds = "{invalid";
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try { assert.deepEqual((await response()).opportunityCommandEffects, [], "malformed settlement never breaks profile GET"); }
  finally { console.warn = originalWarn; logs[0].settledGradeIds = savedSettlement; }
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].includes("خاص"), false);
  links = [];
  assert.deepEqual((await response()).opportunityCommandEffects, [], "missing active chapter has no command effects");
  links = [activeLink, { ...activeLink, id: "duplicate" }];
  assert.deepEqual((await response()).opportunityCommandEffects, [], "ambiguous active chapter has no command effects");
  links = [activeLink];
  assert.equal(JSON.stringify({ student, grade, exam, logs, grace, links }), original, "normalization, replay, and profile never mutate source rows");
  console.log("Profile opportunity command effects: shared normalization, snapshot, state guards and permissions passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
