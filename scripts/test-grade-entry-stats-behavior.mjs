#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { countManualNumericGradesForExam } from "../src/lib/grade-entry-stats.ts";

test("counts only official numeric grades for the selected exam", () => {
  const rows = [
    { studentId: "manual-15", examId: "exam-a", status: "درجة", score: 15 },
    { studentId: "manual-zero", examId: "exam-a", status: "درجة", score: 0 },
    {
      studentId: "auto-grace",
      examId: "exam-a",
      status: "ضمن فترة السماح",
      score: null,
    },
    { studentId: "auto-absent", examId: "exam-a", status: "غائب", score: null },
    {
      studentId: "auto-before-registration",
      examId: "exam-a",
      status: "قبل تسجيل الطالب",
      score: null,
    },
    { studentId: "leave", examId: "exam-a", status: "مجاز", score: null },
    { studentId: "pending-paper", examId: "exam-a", status: "درجة", score: null },
    { studentId: "other-exam", examId: "exam-b", status: "درجة", score: 20 },
  ];

  assert.equal(countManualNumericGradesForExam(rows, "exam-a"), 2);
});

test("does not double-count a student if a stale duplicate appears in memory", () => {
  const duplicated = [
    { studentId: "student-1", examId: "exam-a", status: "درجة", score: 10 },
    { studentId: "student-1", examId: "exam-a", status: "درجة", score: 12 },
  ];

  assert.equal(countManualNumericGradesForExam(duplicated, "exam-a"), 1);
  assert.equal(countManualNumericGradesForExam(duplicated, ""), 0);
});
