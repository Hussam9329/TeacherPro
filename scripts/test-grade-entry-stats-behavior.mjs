#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { countManualNumericGradesForExam, countAllManualGradesForExam } from "../src/lib/grade-entry-stats.ts";

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

test("counts all manual grades including pending ones (الدرجات المعلقة)", () => {
  const rows = [
    { studentId: "manual-15", examId: "exam-a", status: "درجة", score: 15 },
    { studentId: "manual-zero", examId: "exam-a", status: "درجة", score: 0 },
    { studentId: "pending-paper-1", examId: "exam-a", status: "درجة", score: null },
    { studentId: "pending-paper-2", examId: "exam-a", status: "درجة", score: null },
    // هذه يجب تستبعد (حالات تلقائية)
    { studentId: "auto-grace", examId: "exam-a", status: "ضمن فترة السماح", score: null },
    { studentId: "auto-absent", examId: "exam-a", status: "غائب", score: null },
    { studentId: "cheating", examId: "exam-a", status: "غش", score: 0 },
    { studentId: "leave", examId: "exam-a", status: "مجاز", score: null },
    { studentId: "before-reg", examId: "exam-a", status: "قبل تسجيل الطالب", score: null },
    // امتحان مختلف - يستبعد
    { studentId: "other-exam", examId: "exam-b", status: "درجة", score: 20 },
  ];

  const result = countAllManualGradesForExam(rows, "exam-a");
  
  assert.equal(result.numeric, 2, "يجب أن يحسب درجتين رقميتين");
  assert.equal(result.pending, 2, "يجب أن يحسب درجتين معلقتين");
  assert.equal(result.total, 4, "يجب أن يكون الإجمالي 4");
});

test("returns zeros when no grades exist", () => {
  const result = countAllManualGradesForExam([], "exam-a");
  
  assert.equal(result.numeric, 0);
  assert.equal(result.pending, 0);
  assert.equal(result.total, 0);
});

test("returns zeros when examId is empty", () => {
  const rows = [
    { studentId: "s1", examId: "exam-a", status: "درجة", score: 15 },
  ];
  
  const result = countAllManualGradesForExam(rows, "");
  
  assert.equal(result.numeric, 0);
  assert.equal(result.pending, 0);
  assert.equal(result.total, 0);
});

test("does not double-count student with both numeric and pending grade", () => {
  const rows = [
    { studentId: "s1", examId: "exam-a", status: "درجة", score: 15 },
    { studentId: "s1", examId: "exam-a", status: "درجة", score: null }, // نفس الطالب معلق
  ];
  
  const result = countAllManualGradesForExam(rows, "exam-a");
  
  assert.equal(result.numeric, 1, "الطالب يحتسب مرة واحدة كرقمي");
  assert.equal(result.pending, 1, "الطالب يحتسب مرة واحدة كمعلق");
});
