#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveTeacherProModule(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
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

const {
  reconcileProtectedGradeMarkersForExamEdit,
} = require(path.join(root, "src/lib/protected-grade-markers-server.ts"));

function protectedClient({ exam, grade, leaves = [], backups = [] }) {
  const events = [];
  return {
    events,
    client: {
      exam: { findUnique: async () => exam },
      grade: {
        findMany: async () => [grade],
        update: async ({ data }) => {
          Object.assign(grade, data);
          events.push({ type: "grade.update", data });
          return grade;
        },
        delete: async () => {
          events.push({ type: "grade.delete" });
          return grade;
        },
      },
      studentLeave: { findMany: async () => leaves },
      studentLeaveGradeBackup: {
        findMany: async () => backups,
        upsert: async ({ create }) => {
          backups.push(create);
          events.push({ type: "backup.upsert", data: create });
          return create;
        },
        deleteMany: async () => {
          events.push({ type: "backup.deleteMany" });
          return { count: 0 };
        },
      },
    },
  };
}

function exam(overrides = {}) {
  return {
    id: "exam-1",
    courseIds: JSON.stringify(["course-1"]),
    mainSite: "أربيل",
    date: new Date("2026-02-10T00:00:00.000Z"),
    ...overrides,
  };
}

function grade(overrides = {}) {
  return {
    id: "grade-1",
    studentId: "student-1",
    examId: "exam-1",
    status: "درجة",
    score: 80,
    notes: "درجة أصلية",
    academicAccountingChecked: true,
    academicEffectExcluded: false,
    academicEffectExclusionReason: null,
    academicEffectExclusionSource: null,
    smartNoteId: null,
    createdAt: new Date("2026-02-10T00:00:00.000Z"),
    updatedAt: new Date("2026-02-10T00:00:00.000Z"),
    student: {
      courseId: "course-1",
      mainSite: "اربيل",
      subSite: null,
      locationScope: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      accountingGraceDays: 3,
      gracePeriodStartDate: null,
      gracePeriodEndedAt: null,
    },
    ...overrides,
  };
}

test("exam date entering a leave backs up the real grade before converting it", async () => {
  const originalGrade = grade();
  const leave = {
    id: "leave-1",
    studentId: "student-1",
    examId: "exam-1",
    leaveType: "exam",
    date: new Date("2026-02-10T00:00:00.000Z"),
    dateFrom: null,
    dateTo: null,
    createdAt: new Date("2026-02-09T00:00:00.000Z"),
  };
  const fixture = protectedClient({ exam: exam(), grade: originalGrade, leaves: [leave] });
  const result = await reconcileProtectedGradeMarkersForExamEdit(fixture.client, "exam-1");

  assert.equal(result.backedUpGrades, 1);
  assert.equal(result.convertedToExcused, 1);
  assert.equal(originalGrade.status, "مجاز");
  assert.equal(originalGrade.score, null);
  assert.ok(fixture.events.some((event) => event.type === "backup.upsert"));
});

test("an expired grace placeholder is removed so the current marker can be rebuilt", async () => {
  const staleGrade = grade({ status: "ضمن فترة السماح", score: null });
  const fixture = protectedClient({ exam: exam(), grade: staleGrade });
  const result = await reconcileProtectedGradeMarkersForExamEdit(fixture.client, "exam-1");

  assert.equal(result.removedStaleMarkers, 1);
  assert.ok(fixture.events.some((event) => event.type === "grade.delete"));
});

test("a real grade outside the edited exam site remains stored", async () => {
  const historicalGrade = grade({
    student: { ...grade().student, mainSite: "بغداد" },
  });
  const fixture = protectedClient({ exam: exam(), grade: historicalGrade });
  const result = await reconcileProtectedGradeMarkersForExamEdit(fixture.client, "exam-1");

  assert.deepEqual(result, {
    convertedToExcused: 0,
    restoredFromLeaveBackup: 0,
    removedStaleMarkers: 0,
    backedUpGrades: 0,
  });
  assert.equal(fixture.events.length, 0);
});
