#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { countAllManualGradesForExam } from "../src/lib/grade-entry-stats.ts";

test("counts all manual grades including pending and pre-registration ones", () => {
  const rows = [
    // درجات رقمية عادية
    { studentId: "manual-15", examId: "exam-a", status: "درجة", score: 15 },
    { studentId: "manual-zero", examId: "exam-a", status: "درجة", score: 0 },
    
    // درجات معلقة (ورق بدون درجة)
    { studentId: "pending-1", examId: "exam-a", status: "درجة", score: null },
    { studentId: "pending-2", examId: "exam-a", status: "درجة", score: undefined },
    
    // 🆕 درجات قبل التسجيل (مدخلة يدوياً - يجب أن تُحتسب!)
    { studentId: "pre-reg-1", examId: "exam-a", status: "قبل تسجيل الطالب", score: 46 },
    { studentId: "pre-reg-2", examId: "exam-a", status: "قبل تسجيل الطالب", score: 50 },
    
    // حالات تلقائية - يجب استبعادها
    { studentId: "auto-grace", examId: "exam-a", status: "ضمن فترة السماح", score: null },
    { studentId: "auto-absent", examId: "exam-a", status: "غائب", score: null },
    { studentId: "cheating", examId: "exam-a", status: "غش", score: 0 },
    { studentId: "leave", examId: "exam-a", status: "مجاز", score: null },
    { studentId: "before-reg-no-score", examId: "exam-a", status: "قبل تسجيل الطالب", score: null },
    
    // امتحان مختلف - يستبعد
    { studentId: "other-exam", examId: "exam-b", status: "درجة", score: 20 },
  ];

  const result = countAllManualGradesForExam(rows, "exam-a");
  
  assert.equal(result.numeric, 2, "يجب أن يحسب درجتين رقميتين عاديتين");
  assert.equal(result.preRegistration, 2, "يجب أن يحسب درجتين قبل التسجيل 🆕");
  assert.equal(result.pending, 2, "يجب أن يحسب درجتين معلقتين");
  assert.equal(result.total, 6, "يجب أن يكون الإجمالي 6");
});

test("returns zeros when no grades exist", () => {
  const result = countAllManualGradesForExam([], "exam-a");
  
  assert.equal(result.numeric, 0);
  assert.equal(result.preRegistration, 0);
  assert.equal(result.pending, 0);
  assert.equal(result.total, 0);
});

test("returns zeros when examId is empty", () => {
  const rows = [
    { studentId: "s1", examId: "exam-a", status: "درجة", score: 15 },
    { studentId: "s2", examId: "exam-a", status: "قبل تسجيل الطالب", score: 40 },
  ];
  
  const result = countAllManualGradesForExam(rows, "");
  
  assert.equal(result.numeric, 0);
  assert.equal(result.preRegistration, 0);
  assert.equal(result.pending, 0);
  assert.equal(result.total, 0);
});

test("does not double-count student with both numeric and pre-registration grade", () => {
  const rows = [
    { studentId: "s1", examId: "exam-a", status: "درجة", score: 15 },
    { studentId: "s1", examId: "exam-a", status: "قبل تسجيل الطالب", score: 46 }, // نفس الطالب قبل التسجيل
  ];
  
  const result = countAllManualGradesForExam(rows, "exam-a");
  
  assert.equal(result.numeric, 1, "الطالب يحتسب مرة واحدة كرقمي");
  assert.equal(result.preRegistration, 1, "الطالب يحتسب مرة واحدة كقبل تسجيل");
  assert.equal(result.total, 2, "الإجمالي يجب أن يكون 2 (لأنهما حالتان مختلفتان)");
});

test("BIO-648 case: pre-registration grade should be counted", () => {
  // محاكاة حالة هبة حيدر - درجة 46 قبل التسجيل
  const rows = [
    { 
      studentId: "bio-648-student", 
      examId: "bio-exam", 
      status: "قبل تسجيل الطالب", 
      score: 46  // الدرجة المدخلة يدوياً
    },
  ];
  
  const result = countAllManualGradesForExam(rows, "bio-exam");
  
  assert.equal(result.preRegistration, 1, "درجة BIO-648 يجب أن تُحتسب كـ before registration");
  assert.equal(result.total, 1, "الإجمالي يجب أن يكون 1");
  assert.equal(result.numeric, 0, "ليست درجة رقمية عادية (حالتها مختلفة)");
});

test("excludes only purely automatic statuses", () => {
  const rows = [
    // هذه تُحتسب (ليست تلقائية بحتة)
    { studentId: "s1", examId: "exam-a", status: "درجة", score: 90 },
    { studentId: "s2", examId: "exam-a", status: "قبل تسجيل الطالب", score: 75 },
    
    // هذه لا تُحتسب (تلقائية بحتة)
    { studentId: "s3", examId: "exam-a", status: "غائب", score: null },
    { studentId: "s4", examId: "exam-a", status: "غش", score: 0 },
    { studentId: "s5", examId: "exam-a", status: "مجاز", score: null },
    { studentId: "s6", examId: "exam-a", status: "ضمن فترة السماح", score: null },
  ];
  
  const result = countAllManualGradesForExam(rows, "exam-a");
  
  assert.equal(result.total, 2, "فقط الدرجات اليدوية تُحتسب");
  assert.equal(result.numeric, 1);
  assert.equal(result.preRegistration, 1);
});
