#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolveFilename.call(this,
    request.startsWith("@/") ? path.join(process.cwd(), "src", request.slice(2)) : request,
    parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};

const { getGradeEntryGraceState } = require("../src/lib/grade-entry-grace.ts");
const { classifyGradeAcademicImpact } = require("../src/lib/grade-classification.ts");
const student = {
  createdAt: "2026-09-01",
  accountingGraceDays: 6,
  gracePeriodStartDate: "2026-09-24",
  gracePeriodEndedAt: null,
};
const exam = { id: "exam", date: "2026-09-24", fullMark: 20, passMark: 10, discountMark: 6, type: "يومي" };
const now = new Date("2026-09-24T12:00:00Z");
const state = (overrides = {}) => getGradeEntryGraceState({ student, exam, now, ...overrides });

assert.deepEqual(state(), { protectedForExam: true, numericGradeEndsGrace: true },
  "A missing grade in the grace window remains discoverable in the grace filter.");
assert.equal(state({ grade: { status: "درجة", score: null } }).protectedForExam, true,
  "A legacy blank grade is still missing and must remain discoverable in the grace filter.");
assert.deepEqual(state({ exam: { ...exam, date: "2026-09-10" } }),
  { protectedForExam: false, numericGradeEndsGrace: true },
  "An old exam outside grace must not carry a grace badge, while numeric entry still ends current grace.");

const endedStudent = { ...student, accountingGraceDays: 0, gracePeriodStartDate: null, gracePeriodEndedAt: now };
const historicalMarker = { status: "ضمن فترة السماح", score: null };
assert.deepEqual(state({ student: endedStudent, grade: historicalMarker }),
  { protectedForExam: true, numericGradeEndsGrace: false },
  "Historic grace markers must remain in the entry filter after another numeric grade ended grace.");
assert.equal(classifyGradeAcademicImpact(historicalMarker, exam, { student: endedStudent }), "grace-period",
  "Entry filtering must agree with grade records and student-profile classification.");

assert.deepEqual(state({ now: new Date("2026-09-30T12:00:00Z") }),
  { protectedForExam: true, numericGradeEndsGrace: false },
  "Natural expiry does not remove historical exam protection or suggest ending an already expired window.");
assert.equal(state({ hasLeave: true }).protectedForExam, false,
  "An actual leave takes precedence over the grace badge and filter.");
assert.equal(state({ grade: { status: "مجاز", score: null } }).protectedForExam, false,
  "A persisted leave marker must not be reclassified as grace.");
assert.equal(state({ grade: { status: "درجة", score: 5, academicEffectExcluded: true } }).protectedForExam, false,
  "Explicit archival/excluded records keep their own classification.");
assert.deepEqual(state({ exam: { ...exam, date: "2026-08-31" } }),
  { protectedForExam: false, numericGradeEndsGrace: false },
  "Pre-registration exams retain their separate notice and behavior.");

console.log("Grade-entry grace display/filter behavior checks passed (9 scenarios).");
