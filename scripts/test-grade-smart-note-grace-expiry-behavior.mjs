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

const {
  reconcileExpiredGracePendingGrades,
} = require(
  path.join(root, "src/lib/grade-smart-note-grace-expiry-server.ts"),
);
const {
  upsertGradeSmartNote,
} = require(path.join(root, "src/lib/grade-smart-notes-server.ts"));

function matchesScalar(value, condition) {
  if (condition && typeof condition === "object" && "in" in condition) {
    return condition.in.includes(value);
  }
  return value === condition;
}

function matches(row, where) {
  return Object.entries(where).every(([key, condition]) =>
    matchesScalar(row[key], condition),
  );
}

function fakeTransaction({ notes, grades = [] }) {
  const state = {
    notes: structuredClone(notes),
    grades: structuredClone(grades),
  };
  let nextGrade = 1;

  return {
    state,
    gradeSmartNote: {
      async findMany({ where }) {
        return state.notes
          .filter((note) => matches(note, where))
          .sort(
            (left, right) =>
              new Date(left.attemptedAt).getTime() -
                new Date(right.attemptedAt).getTime() ||
              left.id.localeCompare(right.id),
          )
          .map((note) => ({
            id: note.id,
            studentId: note.studentId,
            examId: note.examId,
            score: note.score,
            reason: note.reason,
            examDateSnapshot: note.examDateSnapshot,
            student: structuredClone(note.student),
            exam: structuredClone(note.exam),
          }));
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const note of state.notes) {
          if (!matches(note, where)) continue;
          Object.assign(note, data);
          count += 1;
        }
        return { count };
      },
    },
    grade: {
      async findUnique({ where }) {
        const key = where.studentId_examId;
        const grade = state.grades.find(
          (candidate) =>
            candidate.studentId === key.studentId &&
            candidate.examId === key.examId,
        );
        return grade ? structuredClone(grade) : null;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const grade of state.grades) {
          if (!matches(grade, where)) continue;
          Object.assign(grade, data);
          count += 1;
        }
        return { count };
      },
      async createMany({ data }) {
        let count = 0;
        for (const input of data) {
          const duplicate = state.grades.some(
            (grade) =>
              (grade.studentId === input.studentId &&
                grade.examId === input.examId) ||
              (input.smartNoteId && grade.smartNoteId === input.smartNoteId),
          );
          if (duplicate) continue;
          state.grades.push({ id: `grade-${nextGrade++}`, ...input });
          count += 1;
        }
        return { count };
      },
    },
  };
}

function graceNote(overrides = {}) {
  return {
    id: "grace-note-1",
    category: "GRACE_SCORED",
    status: "PENDING",
    studentId: "student-1",
    examId: "exam-1",
    score: 74,
    reason: "درجة أُدخلت خلال فترة السماح",
    examDateSnapshot: "2026-08-02T00:00:00.000Z",
    attemptedAt: "2026-08-02T09:00:00.000Z",
    student: {
      createdAt: "2026-08-01T00:00:00.000Z",
      accountingGraceDays: 3,
      gracePeriodStartDate: "2026-08-01T00:00:00.000Z",
    },
    exam: { fullMark: 100 },
    ...overrides,
  };
}

function gracePlaceholder(overrides = {}) {
  return {
    id: "placeholder-grade",
    studentId: "student-1",
    examId: "exam-1",
    status: "ضمن فترة السماح",
    score: null,
    smartNoteId: null,
    academicEffectExcluded: false,
    ...overrides,
  };
}

test("legacy GRACE_SCORED settlement never runs implicitly", async () => {
  const previousFlag = process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  try {
    const tx = fakeTransaction({
      notes: [graceNote()],
      grades: [gracePlaceholder()],
    });

    const result = await reconcileExpiredGracePendingGrades({
      tx,
      now: new Date("2026-08-10T08:00:00.000Z"),
    });

    assert.equal(result.legacyMigrationDisabled, true);
    assert.equal(result.processed, 0);
    assert.equal(tx.state.notes[0].status, "PENDING");
    assert.equal(tx.state.grades[0].status, "ضمن فترة السماح");
    assert.equal(tx.state.grades[0].score, null);
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = previousFlag;
    }
  }
});

test("explicit migration settles an expired attempt into a counted grade", async () => {
  const previousFlag = process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = "1";
  try {
    const tx = fakeTransaction({
      notes: [graceNote()],
      grades: [gracePlaceholder()],
    });
    const now = new Date("2026-08-10T08:00:00.000Z");

    const result = await reconcileExpiredGracePendingGrades({ tx, now });

    assert.equal(result.processed, 1);
    assert.equal(tx.state.grades.length, 1);
    assert.equal(tx.state.grades[0].id, "placeholder-grade");
    assert.equal(tx.state.grades[0].status, "درجة");
    assert.equal(tx.state.grades[0].score, 74);
    assert.equal(tx.state.grades[0].academicEffectExcluded, false);
    assert.equal(tx.state.grades[0].academicEffectExclusionReason, null);
    assert.equal(tx.state.grades[0].academicEffectExclusionSource, null);
    assert.equal(tx.state.grades[0].smartNoteId, "grace-note-1");
    assert.equal(tx.state.notes[0].status, "PROCESSED");
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = previousFlag;
    }
  }
});

test("explicit migration is idempotent and upgrades a zero score", async () => {
  const previousFlag = process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = "1";
  try {
    const tx = fakeTransaction({
      notes: [graceNote({ score: 0 })],
      grades: [gracePlaceholder()],
    });
    const now = new Date("2026-08-04T08:00:00.000Z");

    const first = await reconcileExpiredGracePendingGrades({ tx, now });
    const second = await reconcileExpiredGracePendingGrades({ tx, now });

    assert.equal(first.processed, 1);
    assert.equal(first.conflicts, 0);
    assert.equal(second.processed, 0);
    assert.equal(tx.state.grades.length, 1);
    assert.equal(tx.state.grades[0].status, "درجة");
    assert.equal(tx.state.grades[0].score, 0);
    assert.equal(tx.state.grades[0].academicEffectExcluded, false);
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = previousFlag;
    }
  }
});

test("explicit migration boundary follows Baghdad midnight, not the server's UTC day", async () => {
  const previousFlag = process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = "1";
  try {
    const tx = fakeTransaction({
      notes: [graceNote()],
      grades: [gracePlaceholder()],
    });

    const beforeMidnight = await reconcileExpiredGracePendingGrades({
      tx,
      now: new Date("2026-08-03T20:59:00.000Z"),
    });
    const afterMidnight = await reconcileExpiredGracePendingGrades({
      tx,
      now: new Date("2026-08-03T21:00:00.000Z"),
    });

    assert.equal(beforeMidnight.processed, 0);
    assert.equal(beforeMidnight.stillInGrace, 1);
    assert.equal(afterMidnight.processed, 1);
    assert.equal(tx.state.grades[0].status, "درجة");
    assert.equal(tx.state.grades[0].academicEffectExcluded, false);
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = previousFlag;
    }
  }
});

test("explicit migration creates a counted Grade when no placeholder exists", async () => {
  const previousFlag = process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = "1";
  try {
    const tx = fakeTransaction({ notes: [graceNote()], grades: [] });

    const result = await reconcileExpiredGracePendingGrades({
      tx,
      now: new Date("2026-08-10T08:00:00.000Z"),
    });

    assert.equal(result.processed, 1);
    assert.equal(tx.state.grades.length, 1);
    assert.equal(tx.state.grades[0].status, "درجة");
    assert.equal(tx.state.grades[0].score, 74);
    assert.equal(tx.state.grades[0].academicEffectExcluded, false);
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = previousFlag;
    }
  }
});

test("changing the grace window settles an attempt whose exam left that window", async () => {
  const previousFlag = process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = "1";
  try {
    const tx = fakeTransaction({
      notes: [
        graceNote({
          student: {
            createdAt: "2026-08-01T00:00:00.000Z",
            accountingGraceDays: 5,
            gracePeriodStartDate: "2026-08-05T00:00:00.000Z",
          },
        }),
      ],
      grades: [gracePlaceholder()],
    });

    const result = await reconcileExpiredGracePendingGrades({
      tx,
      // The new window is still open, but the captured exam (Aug 2) is no
      // longer covered by it, so the historical attempt settles as counted.
      now: new Date("2026-08-06T08:00:00.000Z"),
    });

    assert.equal(result.processed, 1);
    assert.equal(tx.state.grades[0].score, 74);
    assert.equal(tx.state.grades[0].academicEffectExcluded, false);
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = previousFlag;
    }
  }
});

test("a real Grade wins at grace expiry and is never overwritten", async () => {
  const previousFlag = process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = "1";
  try {
    const tx = fakeTransaction({
      notes: [graceNote({ score: 14 })],
      grades: [
        gracePlaceholder({
          id: "official-grade",
          status: "درجة",
          score: 91,
        }),
      ],
    });

    const result = await reconcileExpiredGracePendingGrades({
      tx,
      now: new Date("2026-08-10T08:00:00.000Z"),
    });

    assert.equal(result.processed, 0);
    assert.equal(result.conflicts, 1);
    assert.equal(tx.state.grades.length, 1);
    assert.equal(tx.state.grades[0].score, 91);
    assert.equal(tx.state.grades[0].academicEffectExcluded, false);
    assert.equal(tx.state.notes[0].status, "CONFLICT");
    assert.match(tx.state.notes[0].resolution, /لم يُستبدل السجل الموجود/);
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = previousFlag;
    }
  }
});

test("a score above the exam's current full mark is rejected without writing Grade", async () => {
  const previousFlag = process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
  process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = "1";
  try {
    const tx = fakeTransaction({
      notes: [graceNote({ score: 74, exam: { fullMark: 50 } })],
      grades: [gracePlaceholder()],
    });

    const result = await reconcileExpiredGracePendingGrades({
      tx,
      now: new Date("2026-08-10T08:00:00.000Z"),
    });

    assert.equal(result.processed, 0);
    assert.equal(result.rejected, 1);
    assert.equal(tx.state.notes[0].status, "REJECTED");
    assert.equal(tx.state.grades[0].status, "ضمن فترة السماح");
    assert.equal(tx.state.grades[0].score, null);
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION = previousFlag;
    }
  }
});

test("a stale retry cannot reopen a resolved smart note", async () => {
  const resolved = {
    id: "resolved-note",
    status: "PROCESSED",
    category: "GRACE_SCORED",
  };
  let upsertCalled = false;
  const tx = {
    gradeSmartNote: {
      async findUnique() {
        return resolved;
      },
      async upsert() {
        upsertCalled = true;
        throw new Error("resolved note must not be reopened");
      },
    },
  };

  const result = await upsertGradeSmartNote({
    tx,
    category: "GRACE_SCORED",
    status: "PENDING",
    student: { id: "student-1", name: "طالب", code: "S-1" },
    exam: {
      id: "exam-1",
      name: "امتحان",
      date: "2026-08-02T00:00:00.000Z",
    },
    score: 74,
    reason: "إعادة إرسال قديمة",
  });

  assert.equal(result, resolved);
  assert.equal(upsertCalled, false);
});
