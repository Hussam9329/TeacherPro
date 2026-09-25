import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

// Behavioral tests of the rebuilt grace-period model: one table, one rule
// (exam date inside [start, end] => excused), one engine. They load the real
// TypeScript sources, including the @/ alias, without copying business logic.
const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveTeacherProModule(request, parent, isMain, options) {
  const resolved = request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request;
  return originalResolveFilename.call(this, resolved, parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(output.outputText, filename);
};

const grace = require(path.join(root, "src/lib/grace-periods.ts"));
const { recalculateAcademicState, isAutomaticOpportunityLog } = require(path.join(root, "src/lib/academic-engine.ts"));
const { classifyGradeAcademicImpact } = require(path.join(root, "src/lib/grade-classification.ts"));
const { recalculateWithGraceReview } = require(path.join(root, "src/lib/grace-dismissal-review.ts"));
const legacy = require(path.join(root, "src/lib/legacy-grace-conversion.ts"));

const PERIOD = { id: "p1", startDate: "2026-03-25", endDate: "2026-03-28" };

const student = (overrides = {}) => ({
  id: "student-1",
  courseId: "course-1",
  status: "نشط",
  dismissalReason: "",
  dismissalNotes: "",
  opportunities: 3,
  baseOpportunities: 3,
  createdAt: "2026-03-01T00:00:00.000Z",
  gracePeriods: [PERIOD],
  ...overrides,
});
const exam = (overrides = {}) => ({
  id: "exam-1",
  name: "امتحان",
  type: "يومي",
  date: "2026-03-26T00:00:00.000Z",
  fullMark: 100,
  passMark: 50,
  discountMark: 20,
  opportunitiesPenalty: 1,
  dismissalGrade: null,
  noDiscount: false,
  active: true,
  courseIds: ["course-1"],
  examCourses: [{ courseId: "course-1", chapterId: "chapter-1" }],
  ...overrides,
});
const grade = (overrides = {}) => ({
  id: "grade-1",
  studentId: "student-1",
  examId: "exam-1",
  status: "غائب",
  score: null,
  notes: null,
  createdAt: "2026-03-26T00:00:00.000Z",
  updatedAt: "2026-03-26T00:00:00.000Z",
  ...overrides,
});
const state = (overrides = {}) => ({
  students: [student()],
  exams: [exam()],
  grades: [grade()],
  courseChapters: [{ id: "link-1", courseId: "course-1", chapterId: "chapter-1", active: true, archived: false }],
  chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 3 }],
  opportunityLogs: [],
  studentLeaves: [],
  studentNotes: [],
  ...overrides,
});
const recalculated = (input) =>
  recalculateAcademicState(input, new Set(["student-1"])).students.find((item) => item.id === "student-1");

test("the only rule: exam date >= start and <= end, both days included", () => {
  const table = {
    "2026-03-24": false,
    "2026-03-25": true,
    "2026-03-26": true,
    "2026-03-27": true,
    "2026-03-28": true,
    "2026-03-29": false,
  };
  for (const [day, expected] of Object.entries(table)) {
    assert.equal(grace.isStudentInGracePeriod([PERIOD], day), expected, day);
  }
});

test("Baghdad calendar day decides, never UTC instants", () => {
  // 2026-03-24T21:30Z is 00:30 on 25/03 in Baghdad; 2026-03-28T20:30Z is 23:30 on 28/03.
  assert.equal(grace.isStudentInGracePeriod([PERIOD], "2026-03-24T21:30:00.000Z"), true);
  assert.equal(grace.isStudentInGracePeriod([PERIOD], "2026-03-24T20:59:00.000Z"), false);
  assert.equal(grace.isStudentInGracePeriod([PERIOD], "2026-03-28T20:30:00.000Z"), true);
  assert.equal(grace.isStudentInGracePeriod([PERIOD], "2026-03-28T21:30:00.000Z"), false);
});

test("from/to and from+days describe the same period", () => {
  assert.equal(grace.gracePeriodDays(PERIOD), 4);
  assert.equal(grace.gracePeriodEndFromDays("2026-03-25", 4), "2026-03-28");
  assert.equal(grace.gracePeriodEndFromDays("2026-09-30", 3), "2026-10-02");
  assert.equal(grace.formatGracePeriod(PERIOD), "25/03/2026 → 28/03/2026");
});

test("validation: no upcoming start, no reversed range, no overlap, max 30 days", () => {
  const september = { id: "p1", startDate: "2026-09-25", endDate: "2026-09-28" };
  const base = { todayKey: "2026-09-26", existing: [september] };
  assert.match(grace.validateGracePeriodInput({ ...base, startDate: "2026-09-27", endDate: "2026-09-30", existing: [] }), /يوم قادم/);
  assert.match(grace.validateGracePeriodInput({ ...base, startDate: "2026-09-20", endDate: "2026-09-19" }), /لا يمكن أن يسبق/);
  assert.equal(
    grace.validateGracePeriodInput({ ...base, startDate: "2026-09-26", endDate: "2026-09-30" }),
    "يوجد للطالب فترة سماح تتداخل مع الفترة المحددة. يرجى تعديل الفترة الموجودة بدلاً من إنشاء فترة جديدة.",
  );
  assert.equal(grace.validateGracePeriodInput({ ...base, startDate: "2026-09-26", endDate: "2026-09-30", ignoreId: "p1" }), "");
  assert.equal(grace.validateGracePeriodInput({ ...base, startDate: "2026-09-10", endDate: "2026-09-20" }), "");
  assert.match(grace.validateGracePeriodInput({ ...base, existing: [], startDate: "2026-08-01", endDate: "2026-08-31" }), /30/);
  assert.match(grace.validateGracePeriodInput({ ...base, startDate: "2026-02-30", endDate: "2026-03-01" }), /بداية/);
});

test("cancelled periods never protect", () => {
  assert.deepEqual(grace.normalizeGracePeriodRanges([{ ...PERIOD, cancelledAt: "2026-03-27T00:00:00Z" }]), []);
});

test("an absence inside grace is stored as the fact and costs nothing", () => {
  const input = state();
  assert.equal(recalculated(input).opportunities, 3);
  assert.equal(classifyGradeAcademicImpact(input.grades[0], input.exams[0], { student: input.students[0] }), "grace-period");
  const outside = state({ students: [student({ gracePeriods: [] })] });
  assert.equal(recalculated(outside).opportunities, 2, "the same absence outside grace deducts");
});

test("a final exam inside grace never dismisses, whatever the result", () => {
  for (const result of [grade({ status: "غائب" }), grade({ status: "درجة", score: 0 }), grade({ status: "غش" })]) {
    const input = state({ exams: [exam({ type: "فاينل" })], grades: [result] });
    const after = recalculated(input);
    assert.equal(after.status, "نشط", result.status);
    assert.equal(after.opportunities, 3, result.status);
  }
  const outside = recalculated(state({ students: [student({ gracePeriods: [] })], exams: [exam({ type: "فاينل" })] }));
  assert.equal(outside.status, "مفصول", "the same final absence outside grace dismisses");
});

test("a real score inside grace is kept and excluded, and never ends grace", () => {
  const input = state({
    exams: [exam({ id: "e1", date: "2026-03-25T00:00:00.000Z" }), exam({ id: "e2", date: "2026-03-27T00:00:00.000Z" })],
    grades: [
      grade({ id: "g1", examId: "e1", status: "درجة", score: 0 }),
      grade({ id: "g2", examId: "e2", status: "غائب", score: null }),
    ],
  });
  const result = recalculateAcademicState(input, new Set(["student-1"]));
  assert.equal(result.students[0].opportunities, 3);
  assert.equal(result.opportunityLogs.filter(isAutomaticOpportunityLog).length, 0);
  assert.equal(input.grades[0].score, 0, "the stored score is untouched");
  assert.deepEqual(input.students[0].gracePeriods, [PERIOD], "grades cannot change the period");
});

test("the day of grade entry is irrelevant; only the exam date counts", () => {
  const late = state({ grades: [grade({ createdAt: "2026-04-15T00:00:00Z", updatedAt: "2026-04-15T00:00:00Z" })] });
  assert.equal(recalculated(late).opportunities, 3);
});

test("moving an exam into or out of the period is just a recalculation", () => {
  const inside = state({ exams: [exam({ date: "2026-03-28T00:00:00.000Z" })] });
  const outside = state({ exams: [exam({ date: "2026-03-29T00:00:00.000Z" })] });
  assert.equal(recalculated(inside).opportunities, 3);
  assert.equal(recalculated(outside).opportunities, 2);
});

test("the retired placeholder text never protects anything", () => {
  const legacyRow = grade({ status: "ضمن فترة السماح" });
  const noPeriod = student({ gracePeriods: [] });
  assert.equal(classifyGradeAcademicImpact(legacyRow, exam(), { student: noPeriod }), "missing");
  assert.equal(classifyGradeAcademicImpact(legacyRow, exam(), { student: student() }), "grace-period");
});

test("leave keeps precedence when both apply", () => {
  const leaves = [{ studentId: "student-1", examId: "exam-1", leaveType: "exam" }];
  assert.equal(classifyGradeAcademicImpact(grade(), exam(), { student: student(), leaves }), "excused");
});

test("granting grace over the dismissal exam lifts only that automatic dismissal", () => {
  const exams = ["10", "11", "12", "13"].map((day, index) =>
    exam({ id: `e${index + 1}`, date: `2026-03-${day}T00:00:00.000Z` }));
  const grades = exams.map((item, index) => grade({ id: `g${index}`, examId: item.id }));
  const beforeGrace = state({ students: [student({ gracePeriods: [] })], exams, grades });
  const dismissed = recalculateAcademicState(beforeGrace, new Set(["student-1"]));
  const stored = { ...dismissed.students[0] };
  assert.equal(stored.status, "مفصول");
  const lastExamDay = dismissed.opportunityLogs.find((log) => log.action === "فصل تلقائي")?.examId;
  const causeDate = exams.find((item) => item.id === lastExamDay).date.slice(0, 10);
  const withGrace = {
    ...beforeGrace,
    students: [{ ...stored, gracePeriods: [{ startDate: causeDate, endDate: causeDate }] }],
    opportunityLogs: dismissed.opportunityLogs,
  };
  const ordinary = recalculateAcademicState(withGrace, new Set(["student-1"]));
  assert.equal(ordinary.students[0].status, "مفصول", "ordinary recalculation never reactivates");
  const reviewed = recalculateWithGraceReview(withGrace, new Set(["student-1"]), { studentId: "student-1" });
  assert.equal(reviewed.students[0].status, "نشط", "the explicit grace change restores the student");
  assert.equal(reviewed.students[0].opportunities, recalculated({ ...withGrace, students: [{ ...stored, status: "نشط", dismissalReason: "", gracePeriods: [{ startDate: causeDate, endDate: causeDate }] }] }).opportunities, "with the real remaining balance, no grant");
});

test("legacy conversion keeps exactly the old protected days", () => {
  const baseStudent = {
    id: "s",
    createdAt: "2026-09-20T09:00:00.000Z",
    accountingGraceDays: 0,
    gracePeriodStartDate: null,
    gracePeriodEndedAt: null,
    gracePeriodHistory: [],
  };
  const plan = (studentOverrides, extra = {}) => legacy.planLegacyStudentConversion({
    student: { ...baseStudent, ...studentOverrides },
    examDateById: new Map([["ex-end", "2026-09-22"], ["ex-one", "2026-09-05"]]),
    placeholders: [],
    existingPeriods: [],
    todayKey: "2026-09-26",
    ...extra,
  });

  const automatic = plan({});
  assert.deepEqual(automatic.periods.map(({ startDate, endDate }) => [startDate, endDate]), [["2026-09-20", "2026-09-22"]]);

  const manual = plan({ accountingGraceDays: 4, gracePeriodStartDate: "2026-09-22T00:00:00.000Z" });
  assert.deepEqual(manual.periods.map(({ startDate, endDate }) => [startDate, endDate]), [["2026-09-22", "2026-09-25"]], "manual replaces automatic");

  const ended = plan({
    gracePeriodEndedAt: "2026-09-22T10:00:00.000Z",
    gracePeriodHistory: [{ start: "2026-09-20", endExclusive: "2026-09-23", excludedExamIds: ["ex-end"] }],
  });
  assert.deepEqual(ended.periods.map(({ startDate, endDate }) => [startDate, endDate]), [["2026-09-20", "2026-09-21"]], "the exam that ended grace stays chargeable");
  assert.equal(ended.conflicts.length, 1);

  const perExam = plan({
    gracePeriodEndedAt: "2026-09-10T00:00:00.000Z",
    gracePeriodHistory: [{ start: "2026-09-05", endExclusive: "2026-09-06", excludedExamIds: [], examIds: ["ex-one"] }],
  });
  assert.deepEqual(perExam.periods.map(({ startDate, endDate }) => [startDate, endDate]), [["2026-09-05", "2026-09-05"]]);
  assert.equal(perExam.uncertainReasons.length, 1);

  const orphan = plan({ gracePeriodEndedAt: "2026-09-10T00:00:00.000Z" }, {
    placeholders: [{ examId: "a", examDate: "2026-09-08" }, { examId: "b", examDate: "2026-09-30" }],
  });
  assert.deepEqual(orphan.periods.map(({ startDate, endDate }) => [startDate, endDate]), [["2026-09-08", "2026-09-08"]], "past orphan placeholder keeps its day");
  assert.equal(orphan.futurePlaceholders, 1, "a future orphan placeholder is not protected");
  assert.equal(orphan.placeholdersToDelete, 2);

  const merged = plan({
    accountingGraceDays: 2,
    gracePeriodStartDate: "2026-09-24T00:00:00.000Z",
    gracePeriodHistory: [{ start: "2026-09-20", endExclusive: "2026-09-24", excludedExamIds: [] }],
  });
  assert.deepEqual(merged.periods.map(({ startDate, endDate }) => [startDate, endDate]), [["2026-09-20", "2026-09-25"]], "touching ranges merge into one non-overlapping period");

  const already = plan({}, { existingPeriods: [{ id: "x", startDate: "2026-09-20", endDate: "2026-09-22", source: "legacy", cancelled: false }] });
  assert.equal(already.status, "already-converted", "conversion is idempotent");

  const manualWins = plan({}, { existingPeriods: [{ id: "m", startDate: "2026-09-21", endDate: "2026-09-25", source: "manual", cancelled: false }] });
  assert.deepEqual(manualWins.periods.map(({ startDate, endDate }) => [startDate, endDate]), [["2026-09-20", "2026-09-20"]]);
  assert.equal(manualWins.conflicts.length, 1);
});
