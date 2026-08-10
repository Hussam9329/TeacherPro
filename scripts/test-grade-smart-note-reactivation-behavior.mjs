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
  classifyGradeImpact,
  gradeHasAcademicEffect,
  recalculateAcademicState,
} = require(path.join(root, "src/lib/academic-engine.ts"));
const { classifyGradeAcademicImpact } = require(
  path.join(root, "src/lib/grade-classification.ts"),
);
const { isProtectedDismissedPendingGrade } = require(
  path.join(root, "src/lib/grade-smart-notes-server.ts"),
);
const {
  DISMISSED_PENDING_GRADE_EXCLUSION_REASON,
  migrateDismissedPendingGradesAfterActivation,
} = require(
  path.join(root, "src/lib/grade-smart-note-reactivation-server.ts"),
);

test("dismissed historical protection survives smart-note relation removal", () => {
  assert.equal(
    isProtectedDismissedPendingGrade({
      academicEffectExcluded: true,
      academicEffectExclusionSource:
        "GradeSmartNote:DISMISSED_PENDING:note-dismissed",
      smartNoteId: null,
    }),
    true,
  );
  assert.equal(
    isProtectedDismissedPendingGrade({
      academicEffectExcluded: true,
      academicEffectExclusionSource: "GradeSmartNote:GRACE_SCORED:note-grace",
    }),
    false,
  );
});

test("a GRACE_SCORED grade stays excluded after the grace window changes", () => {
  const student = {
    id: "student-grace",
    courseId: "course-1",
    status: "نشط",
    dismissalType: "",
    dismissalReason: "",
    dismissalNotes: "",
    opportunities: 3,
    baseOpportunities: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    accountingGraceDays: 0,
    gracePeriodStartDate: null,
  };
  const exam = {
    id: "exam-grace",
    name: "اختبار قديم",
    type: "اختبار",
    date: "2026-05-01T00:00:00.000Z",
    fullMark: 100,
    passMark: 50,
    discountMark: 20,
    opportunitiesPenalty: 1,
    dismissalGrade: null,
    noDiscount: false,
    active: true,
    scheduledActivateAt: null,
    scheduledDeactivateAt: null,
    courseIds: ["course-1"],
  };
  const grade = {
    id: "grade-grace",
    studentId: student.id,
    examId: exam.id,
    status: "درجة",
    score: 0,
    notes: null,
    academicEffectExcluded: true,
    academicEffectExclusionReason: "درجة داخل السماح",
    academicEffectExclusionSource: "GradeSmartNote:GRACE_SCORED:note-grace",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };

  assert.equal(gradeHasAcademicEffect(grade, exam), false);
  const result = recalculateAcademicState({
    students: [student],
    exams: [exam],
    grades: [grade],
    courseChapters: [
      {
        id: "course-chapter-1",
        courseId: "course-1",
        chapterId: "chapter-1",
        active: true,
        archived: false,
      },
    ],
    chapters: [{ id: "chapter-1", name: "الفصل", opportunities: 3 }],
    opportunityLogs: [],
    studentLeaves: [],
    studentNotes: [],
  });
  assert.equal(result.students[0].status, "نشط");
  assert.equal(result.students[0].opportunities, 3);
  assert.equal(result.opportunityLogs.length, 0);
});

function createFakeTransaction(initialNotes, initialGrades = []) {
  const notes = structuredClone(initialNotes);
  const grades = structuredClone(initialGrades);
  let nextGradeId = 1;

  const matches = (row, where) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  return {
    state: { notes, grades },
    gradeSmartNote: {
      async findMany({ where }) {
        return notes
          .filter((note) => matches(note, where))
          .sort(
            (a, b) =>
              new Date(a.attemptedAt).getTime() -
                new Date(b.attemptedAt).getTime() ||
              a.id.localeCompare(b.id),
          )
          .map(({ id, examId, score, reason }) => ({
            id,
            examId,
            score,
            reason,
          }));
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const note of notes) {
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
        const grade = grades.find(
          (item) =>
            item.studentId === key.studentId && item.examId === key.examId,
        );
        return grade
          ? { id: grade.id, smartNoteId: grade.smartNoteId ?? null }
          : null;
      },
      async createMany({ data }) {
        let count = 0;
        for (const input of data) {
          const duplicate = grades.some(
            (grade) =>
              (grade.studentId === input.studentId &&
                grade.examId === input.examId) ||
              (input.smartNoteId && grade.smartNoteId === input.smartNoteId),
          );
          if (duplicate) continue;
          grades.push({ id: `migrated-grade-${nextGradeId++}`, ...input });
          count += 1;
        }
        return { count };
      },
    },
  };
}

function smartNote(overrides = {}) {
  return {
    id: "note-dismissed",
    studentId: "student-1",
    examId: "exam-1",
    category: "DISMISSED_PENDING",
    status: "PENDING",
    score: 0,
    reason: "محاولة أثناء الفصل",
    attemptedAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

test("a migrated dismissed score is permanently excluded from academic effects", () => {
  const student = {
    id: "student-1",
    courseId: "course-1",
    status: "نشط",
    dismissalType: "",
    dismissalReason: "",
    dismissalNotes: "",
    opportunities: 3,
    baseOpportunities: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    accountingGraceDays: 0,
    gracePeriodStartDate: null,
  };
  const exam = {
    id: "exam-1",
    name: "فاينل",
    type: "فاينل",
    date: "2026-08-01T00:00:00.000Z",
    fullMark: 100,
    passMark: 50,
    discountMark: 20,
    opportunitiesPenalty: 1,
    dismissalGrade: null,
    noDiscount: false,
    active: true,
    scheduledActivateAt: null,
    scheduledDeactivateAt: null,
    courseIds: ["course-1"],
  };
  const excludedGrade = {
    id: "migrated-grade",
    studentId: student.id,
    examId: exam.id,
    status: "درجة",
    score: 0,
    notes: null,
    academicEffectExcluded: true,
    academicEffectExclusionReason:
      DISMISSED_PENDING_GRADE_EXCLUSION_REASON,
    academicEffectExclusionSource:
      "GradeSmartNote:DISMISSED_PENDING:note-dismissed",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  assert.equal(gradeHasAcademicEffect(excludedGrade, exam), false);
  assert.equal(classifyGradeImpact(excludedGrade, exam, 3).type, "none");
  assert.equal(
    classifyGradeAcademicImpact(excludedGrade, exam, { student }),
    "academic-effect-excluded",
  );

  const result = recalculateAcademicState({
    students: [student],
    exams: [exam],
    grades: [excludedGrade],
    courseChapters: [
      {
        id: "course-chapter-1",
        courseId: "course-1",
        chapterId: "chapter-1",
        active: true,
        archived: false,
      },
    ],
    chapters: [{ id: "chapter-1", name: "الفصل", opportunities: 3 }],
    opportunityLogs: [],
    studentLeaves: [],
    studentNotes: [],
  });
  assert.equal(result.students[0].status, "نشط");
  assert.equal(result.students[0].opportunities, 3);
  assert.equal(result.opportunityLogs.length, 0);
});

test("reactivation migrates only DISMISSED_PENDING once and records provenance", async () => {
  const tx = createFakeTransaction([
    smartNote(),
    smartNote({
      id: "note-before-registration",
      examId: "exam-2",
      category: "BEFORE_REGISTRATION_PENDING",
    }),
    smartNote({
      id: "note-leave",
      examId: "exam-3",
      category: "LEAVE_PENDING",
    }),
  ]);
  const resolvedAt = new Date("2026-08-10T10:00:00.000Z");

  const first = await migrateDismissedPendingGradesAfterActivation(
    tx,
    "student-1",
    { id: "admin-1", name: "مدير النظام" },
    resolvedAt,
  );
  const second = await migrateDismissedPendingGradesAfterActivation(
    tx,
    "student-1",
    { id: "admin-1", name: "مدير النظام" },
    resolvedAt,
  );

  assert.equal(first.processed, 1);
  assert.equal(first.conflicts, 0);
  assert.equal(second.processed, 0);
  assert.equal(second.conflicts, 0);
  assert.equal(tx.state.grades.length, 1);
  assert.equal(tx.state.grades[0].academicEffectExcluded, true);
  assert.equal(
    tx.state.grades[0].academicEffectExclusionReason,
    DISMISSED_PENDING_GRADE_EXCLUSION_REASON,
  );
  assert.equal(
    tx.state.grades[0].academicEffectExclusionSource,
    "GradeSmartNote:DISMISSED_PENDING:note-dismissed",
  );
  assert.equal(tx.state.grades[0].smartNoteId, "note-dismissed");

  const dismissed = tx.state.notes.find((note) => note.id === "note-dismissed");
  assert.equal(dismissed.status, "PROCESSED");
  assert.deepEqual(dismissed.resolvedAt, resolvedAt);
  assert.equal(
    tx.state.notes.find((note) => note.id === "note-before-registration").status,
    "PENDING",
  );
  assert.equal(
    tx.state.notes.find((note) => note.id === "note-leave").status,
    "PENDING",
  );
});

test("an official grade wins and the dismissed attempt becomes CONFLICT", async () => {
  const tx = createFakeTransaction(
    [smartNote({ score: 12 })],
    [
      {
        id: "official-grade",
        studentId: "student-1",
        examId: "exam-1",
        status: "درجة",
        score: 91,
        academicEffectExcluded: false,
        // Even a stale/reopened note that already points at a Grade must not
        // turn that existing official row back into a migration retry.
        smartNoteId: "note-dismissed",
      },
    ],
  );

  const result = await migrateDismissedPendingGradesAfterActivation(
    tx,
    "student-1",
    { name: "مدير النظام" },
  );

  assert.equal(result.processed, 0);
  assert.equal(result.conflicts, 1);
  assert.equal(tx.state.grades.length, 1);
  assert.equal(tx.state.grades[0].score, 91);
  assert.equal(tx.state.grades[0].academicEffectExcluded, false);
  assert.equal(tx.state.notes[0].status, "CONFLICT");
  assert.match(tx.state.notes[0].resolution, /لم تُستبدل الدرجة الرسمية/);
});
