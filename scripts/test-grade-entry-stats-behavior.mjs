#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { countAllManualGradesForExam } from "../src/lib/grade-entry-stats.ts";

test("counts all manual grades including pending-review and pre-registration ones", () => {
  const rows = [
    // درجات رقمية عادية
    { studentId: "manual-15", examId: "exam-a", status: "درجة", score: 15 },
    { studentId: "manual-zero", examId: "exam-a", status: "درجة", score: 0 },
    
    // درجات معلّقة للمراجعة (حالة صريحة يسجلها النظام لمحاولة رقمية محمية)
    { studentId: "pending-review-1", examId: "exam-a", status: "درجة معلّقة", score: 26 },
    
    // درجات قبل التسجيل (مدخلة يدوياً - يجب أن تُحتسب!)
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
  assert.equal(result.preRegistration, 2, "يجب أن يحسب درجتين قبل التسجيل");
  assert.equal(result.pending, 1, "درجة معلّقة واحدة فقط (المراجعة الصريحة)");
  assert.equal(result.total, 5, "يجب أن يكون الإجمالي 5");
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

test("REGRESSION: ورقة انتظار التصحيح (درجة بدون رقم) لا تُحتسب — حالة الامتحان الثامن فصل ثاني ص1", () => {
  // السيناريو الفعلي من قاعدة البيانات:
  // - أنشئ الامتحان ولم يدخل المعلم أي درجة بعد
  // - استلم النظام ورقة الطالب عبر التصحيح/بوت تلغرام فأنشأ سجلاً
  //   تلقائياً بحالة «درجة» و score=null (مثل id: correction_grade_*)
  // - القديم: العداد كان يعرض «معلقة 1» والإجمالي 1
  // - الصحيح: الإجمالي يجب أن يكون 0 لأن المعلم لم يُدخل شيئاً
  const rows = [
    { studentId: "st_hussein", examId: "exam-8-p1", status: "درجة", score: null }, // ورقة بانتظار التصحيح
    { studentId: "auto-1", examId: "exam-8-p1", status: "مجاز", score: null },
    { studentId: "auto-2", examId: "exam-8-p1", status: "ضمن فترة السماح", score: null },
  ];
  
  const result = countAllManualGradesForExam(rows, "exam-8-p1");
  
  assert.equal(result.pending, 0, "ورقة الانتظار التلقائية ليست إدخالاً يدوياً");
  assert.equal(result.numeric, 0);
  assert.equal(result.total, 0, "المعلم لم يدخل شيئاً فيجب أن يكون التعداد صفراً");
});

test("REGRESSION: ورقة الانتظار لا تُحتسب حتى مع وجود درجات يدوية أخرى", () => {
  const rows = [
    { studentId: "manual-1", examId: "exam-x", status: "درجة", score: 30 },
    { studentId: "placeholder-1", examId: "exam-x", status: "درجة", score: null }, // بانتظار التصحيح
    { studentId: "placeholder-2", examId: "exam-x", status: "درجة", score: undefined }, // بانتظار التصحيح
  ];
  
  const result = countAllManualGradesForExam(rows, "exam-x");
  
  assert.equal(result.numeric, 1, "فقط الدرجة الرقمية المحفوظة تُحتسب");
  assert.equal(result.pending, 0);
  assert.equal(result.total, 1);
});

test("explicit pending-review status (درجة معلّقة) is still counted as pending", () => {
  const rows = [
    { studentId: "dismissed-attempt", examId: "exam-y", status: "درجة معلّقة", score: 12 },
  ];
  
  const result = countAllManualGradesForExam(rows, "exam-y");
  
  assert.equal(result.pending, 1, "درجة معلّقة الصريحة تبقى محتسبة");
  assert.equal(result.total, 1);
});
