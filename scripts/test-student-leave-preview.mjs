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
const { buildStudentLeavePreview } = require(path.join(root, "src/lib/student-leave-preview.ts"));

const student = { id: "s", courseId: "course", mainSite: "اربيل", subSite: "", locationScope: "محافظات" };
const exam = (id, date, overrides = {}) => ({ id, name: `امتحان ${id}`, date, courseIds: ["course"], mainSite: "أربيل", active: true, ...overrides });
const leave = (id, overrides = {}) => ({ id, studentId: "s", leaveType: "exam", examId: "early", date: "2026-09-27", ...overrides });
const base = {
  mode: "period", student, leaves: [], dateFrom: "2026-09-16", dateTo: "2026-09-23",
  exams: [
    exam("late", "2026-09-23T23:59:59.999Z", { active: false }),
    exam("other-course", "2026-09-20", { courseIds: ["other"] }),
    exam("early", "2026-09-16T00:00:00.000Z"),
    exam("other-site", "2026-09-20", { mainSite: "بغداد" }),
    exam("all-sites", "2026-09-19", { mainSite: "الكل" }),
    exam("next-day", "2026-09-24T00:00:00.000Z"),
    exam("previous-day", "2026-09-15T23:59:59.999Z"),
  ],
};

test("period lists only eligible course/site exams chronologically, includes inactive and the whole last UTC day", () => {
  const result = buildStudentLeavePreview(base);
  assert.deepEqual(result.periodExams.map((e) => e.id), ["early", "all-sites", "late"]);
  assert.equal(result.periodExams.length, 3);
  assert.equal(result.hasPeriodDates, true);
  assert.deepEqual([result.from, result.to], ["2026-09-16", "2026-09-23"]);
});

test("reversed range matches the saved normalized range; incomplete/invalid dates do not invent coverage or overlap", () => {
  const reversed = buildStudentLeavePreview({ ...base, dateFrom: base.dateTo, dateTo: base.dateFrom });
  assert.deepEqual(reversed.periodExams, buildStudentLeavePreview(base).periodExams);
  assert.deepEqual([reversed.from, reversed.to], [base.dateFrom, base.dateTo]);
  for (const dateTo of ["", null, "invalid"]) {
    const result = buildStudentLeavePreview({ ...base, dateTo, leaves: [leave("period", { leaveType: "period", dateFrom: base.dateFrom, dateTo: base.dateTo })] });
    assert.equal(result.hasPeriodDates, false);
    assert.deepEqual(result.periodExams, []);
    assert.deepEqual(result.conflicts, []);
  }
});

test("preview uses server site aliases and does not add registration or study-type restrictions", () => {
  const result = buildStudentLeavePreview({ ...base,
    student: { ...student, locationScope: "خارج القطر - تركيا", createdAt: "2026-09-30", studyType: "حضوري" },
    exams: [exam("outside", "2026-09-17", { mainSite: "خارج القطر", studyType: "إلكتروني" })],
  });
  assert.deepEqual(result.periodExams.map((e) => e.id), ["outside"]);
});

test("specific exam is course-scoped but not site-scoped; foreign and missing exams cannot become selected", () => {
  assert.equal(buildStudentLeavePreview({ ...base, mode: "exam", examId: "other-site" }).selectedExam?.id, "other-site");
  for (const examId of ["other-course", "missing", ""]) {
    const result = buildStudentLeavePreview({ ...base, mode: "exam", examId, leaves: [leave("duplicate", { examId })] });
    assert.equal(result.selectedExam, null);
    assert.deepEqual(result.conflicts, []);
  }
});

test("same-exam duplicate blocks, excludes edited row and other students, regardless of documentation date", () => {
  const result = buildStudentLeavePreview({ ...base, mode: "exam", examId: "early", editingLeaveId: "self", leaves: [
    leave("self"), leave("other-student", { studentId: "other" }), leave("duplicate", { date: "2020-01-01", dateFrom: "2020-01-01", dateTo: "2020-01-01" }),
  ] });
  assert.deepEqual(result.conflicts, [{ leaveId: "duplicate", kind: "duplicate-exam", blocking: true }]);
});

test("period overlaps include boundary days and legacy null ranges, excluding edited and other-student leaves", () => {
  const result = buildStudentLeavePreview({ ...base, editingLeaveId: "self", leaves: [
    leave("touching", { leaveType: "period", dateFrom: "2026-09-23", dateTo: "2026-09-25" }),
    leave("legacy", { leaveType: "period", dateFrom: null, dateTo: null, date: "2026-09-16" }),
    leave("outside", { leaveType: "period", dateFrom: "2026-09-24", dateTo: "2026-09-25" }),
    leave("self", { leaveType: "period", dateFrom: base.dateFrom, dateTo: base.dateTo }),
    leave("other-student", { studentId: "other", leaveType: "period", dateFrom: base.dateFrom, dateTo: base.dateTo }),
  ] });
  assert.deepEqual(result.conflicts, [
    { leaveId: "touching", kind: "period-overlap", blocking: true },
    { leaveId: "legacy", kind: "period-overlap", blocking: true },
  ]);
});

test("new period warns only for covered specific exams; uses exam date instead of documentation date", () => {
  const result = buildStudentLeavePreview({ ...base, leaves: [
    leave("covered", { examId: "early", date: "2027-01-01" }),
    leave("outside", { examId: "next-day", date: "2026-09-20" }),
    leave("wrong-site", { examId: "other-site", date: "2026-09-20" }),
    leave("wrong-course", { examId: "other-course", date: "2026-09-20" }),
  ] });
  assert.deepEqual(result.conflicts, [{ leaveId: "covered", kind: "covered-exam", blocking: false }]);
});

test("new specific exam warns only for periods which actually cover that exam's date and site", () => {
  const leaves = [leave("period", { leaveType: "period", dateFrom: "2026-09-16", dateTo: "2026-09-23", date: "2020-01-01" })];
  const result = buildStudentLeavePreview({ ...base, mode: "exam", examId: "early", dateFrom: "2027-01-01", dateTo: "2027-01-01", leaves });
  assert.deepEqual(result.conflicts, [{ leaveId: "period", kind: "covered-exam", blocking: false }]);
  for (const examId of ["other-site", "next-day"]) {
    assert.deepEqual(buildStudentLeavePreview({ ...base, mode: "exam", examId, leaves }).conflicts, []);
  }
});

test("no selected student yields no affected exams or conflicts", () => {
  const result = buildStudentLeavePreview({ ...base, student: null, examId: "early", leaves: [leave("leave")] });
  assert.deepEqual(result.periodExams, []);
  assert.equal(result.selectedExam, null);
  assert.deepEqual(result.conflicts, []);
});
