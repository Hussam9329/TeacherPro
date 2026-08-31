#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseExamNumber,
  validateExamForm,
  validateExamGradePolicy,
} from "../src/lib/exam-form-validation.ts";

function validForm(overrides = {}) {
  return {
    name: "امتحان تجريبي",
    type: "يومي",
    courseIds: ["course-1"],
    mainSites: ["كركوك"],
    date: "2026-08-26",
    fullMark: "100",
    passMark: "60",
    discountMark: "45",
    opportunitiesPenalty: "1",
    dismissalGrade: "",
    noDiscount: false,
    statusMode: "نشط",
    scheduledActivateAt: "",
    ...overrides,
  };
}

test("accepts a coherent exam and allows passMark to equal fullMark", () => {
  assert.equal(validateExamForm(validForm()).isValid, true);

  const equalBoundary = validateExamForm(
    validForm({ passMark: "100", discountMark: "99" }),
  );
  assert.equal(equalBoundary.isValid, true);
  assert.equal(equalBoundary.firstError, null);
});

test("rejects passMark above fullMark and identifies the exact field", () => {
  const result = validateExamForm(validForm({ passMark: "101" }));

  assert.equal(result.isValid, false);
  assert.equal(
    result.firstError,
    "درجة النجاح يجب أن تكون بين صفر والدرجة الكاملة",
  );
  assert.match(result.fieldErrors.passMark || "", /لا يمكن أن تتجاوز/);
});

test("does not silently coerce blank, boolean, fractional, or non-finite marks", () => {
  for (const passMark of ["", "   ", true, "60.5", "Infinity", "abc"]) {
    const result = validateExamForm(validForm({ passMark }));
    assert.equal(result.isValid, false, `passMark=${String(passMark)}`);
    assert.ok(result.fieldErrors.passMark, `passMark=${String(passMark)}`);
  }

  assert.equal(parseExamNumber(""), null);
  assert.equal(parseExamNumber(true), null);
  assert.equal(parseExamNumber("Infinity"), null);
  assert.equal(parseExamNumber("0x10"), null);
  assert.equal(parseExamNumber("1e2"), null);
});

test("normalizes Arabic and Persian digits without changing the academic rule", () => {
  const result = validateExamGradePolicy({
    type: "يومي",
    noDiscount: false,
    fullMark: "١٠٠",
    passMark: "۶۰",
    discountMark: "٤٥",
    opportunitiesPenalty: "۱",
  });

  assert.equal(result.isValid, true);
  assert.deepEqual(result.values, {
    fullMark: 100,
    passMark: 60,
    discountMark: 45,
    opportunitiesPenalty: 1,
    dismissalGrade: null,
  });
});

test("validates every numeric relationship for daily and cumulative exams", () => {
  const cases = [
    {
      overrides: { fullMark: "0" },
      field: "fullMark",
    },
    {
      overrides: { passMark: "-1" },
      field: "passMark",
    },
    {
      overrides: { discountMark: "101" },
      field: "discountMark",
    },
    {
      overrides: { passMark: "45", discountMark: "45" },
      field: "passMark",
      secondField: "discountMark",
    },
    {
      overrides: { opportunitiesPenalty: "0" },
      field: "opportunitiesPenalty",
    },
    {
      overrides: { opportunitiesPenalty: "1.5" },
      field: "opportunitiesPenalty",
    },
  ];

  for (const { overrides, field, secondField } of cases) {
    const result = validateExamForm(validForm(overrides));
    assert.equal(result.isValid, false, JSON.stringify(overrides));
    assert.ok(result.fieldErrors[field], `${field}: ${JSON.stringify(overrides)}`);
    if (secondField) {
      assert.ok(
        result.fieldErrors[secondField],
        `${secondField}: ${JSON.stringify(overrides)}`,
      );
    }
  }
});

test("final exams ignore disabled discount fields but validate optional dismissal grade", () => {
  const validFinal = validateExamForm(
    validForm({
      type: "فاينل",
      discountMark: "not-used",
      opportunitiesPenalty: "not-used",
      dismissalGrade: "35",
    }),
  );
  assert.equal(validFinal.isValid, true);

  for (const dismissalGrade of ["101", "-1", "20.5", "invalid", true]) {
    const invalidFinal = validateExamForm(
      validForm({ type: "فاينل", dismissalGrade }),
    );
    assert.equal(invalidFinal.isValid, false, String(dismissalGrade));
    assert.ok(invalidFinal.fieldErrors.dismissalGrade);
  }
});

test("no-discount exams ignore disabled policy fields but still validate full/pass marks", () => {
  const validNoDiscount = validateExamForm(
    validForm({
      noDiscount: true,
      discountMark: "invalid-but-disabled",
      opportunitiesPenalty: "invalid-but-disabled",
      dismissalGrade: "invalid-but-disabled",
    }),
  );
  assert.equal(validNoDiscount.isValid, true);

  const invalidPass = validateExamForm(
    validForm({ noDiscount: true, passMark: "101" }),
  );
  assert.equal(invalidPass.isValid, false);
  assert.ok(invalidPass.fieldErrors.passMark);
});

test("validates required selections, date, name, and scheduled activation", () => {
  const result = validateExamForm(
    validForm({
      name: "",
      courseIds: [],
      mainSites: [],
      date: "",
      statusMode: "تفعيل مجدول",
      scheduledActivateAt: "",
    }),
  );

  assert.equal(result.isValid, false);
  assert.ok(result.fieldErrors.name);
  assert.ok(result.fieldErrors.courseIds);
  assert.ok(result.fieldErrors.mainSites);
  assert.ok(result.fieldErrors.date);
  assert.ok(result.fieldErrors.scheduledActivateAt);
});

test("preflight and course eligibility blockers participate in the same form result", () => {
  const preflight = validateExamForm(
    validForm({ preflightError: "سياق الامتحان غير جاهز" }),
  );
  assert.equal(preflight.isValid, false);
  assert.equal(preflight.fieldErrors.form, "سياق الامتحان غير جاهز");

  const courseBlocker = validateExamForm(
    validForm({ courseSelectionError: "الدورة بلا فصل نشط" }),
  );
  assert.equal(courseBlocker.isValid, false);
  assert.equal(courseBlocker.fieldErrors.courseIds, "الدورة بلا فصل نشط");
});
