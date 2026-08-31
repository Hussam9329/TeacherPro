#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveTeacherProModule(
  request,
  parent,
  isMain,
  options,
) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  return originalResolveFilename.call(
    this,
    resolvedRequest,
    parent,
    isMain,
    options,
  );
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

const { shouldEndGraceForNumericGrade } = require(
  path.join(root, "src/lib/grace-grade-activation.ts"),
);

const now = new Date("2026-08-22T09:00:00.000Z");
const activeStudent = {
  createdAt: "2026-08-21T00:00:00.000Z",
  accountingGraceDays: 0,
  gracePeriodStartDate: null,
  gracePeriodEndedAt: null,
};
const decision = (overrides = {}) =>
  shouldEndGraceForNumericGrade({
    student: activeStudent,
    status: "درجة",
    score: 0,
    examOnOrAfterRegistration: true,
    now,
    ...overrides,
  });

assert.equal(decision(), true, "zero must be treated as a real numeric grade");
assert.equal(decision({ score: null }), false, "blank grade must not end grace");
assert.equal(decision({ status: "غائب", score: null }), false);
assert.equal(decision({ status: "غش", score: null }), false);
assert.equal(decision({ examOnOrAfterRegistration: false }), false);
assert.equal(
  decision({ student: { ...activeStudent, gracePeriodEndedAt: now } }),
  false,
  "an already-ended grace period must stay ended and not retrigger",
);
assert.equal(
  decision({
    student: {
      ...activeStudent,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  }),
  false,
  "an expired automatic window must not report a new termination",
);

console.log("Grace numeric-grade activation behavior checks passed.");
