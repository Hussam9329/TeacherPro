#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  isPreRegistrationNumericGrade,
  PRE_REGISTRATION_GRADE_EXCLUSION_REASON,
  PRE_REGISTRATION_GRADE_EXCLUSION_SOURCE,
} from "../src/lib/pre-registration-grade.ts";

test("accepts a manually entered numeric score before registration", () => {
  assert.equal(
    isPreRegistrationNumericGrade({
      examOnOrAfterRegistration: false,
      status: "درجة",
      score: 46,
    }),
    true,
  );
  assert.equal(
    isPreRegistrationNumericGrade({
      examOnOrAfterRegistration: false,
      status: "درجة",
      score: 0,
    }),
    true,
  );
  assert.match(PRE_REGISTRATION_GRADE_EXCLUSION_REASON, /الخصم والفصل/);
  assert.equal(
    PRE_REGISTRATION_GRADE_EXCLUSION_SOURCE,
    "PreRegistrationGrade:Direct",
  );
});

test("does not treat automatic or scoreless states as manual grades", () => {
  for (const row of [
    { examOnOrAfterRegistration: false, status: "درجة", score: null },
    { examOnOrAfterRegistration: false, status: "غائب", score: null },
    {
      examOnOrAfterRegistration: false,
      status: "قبل تسجيل الطالب",
      score: null,
    },
    { examOnOrAfterRegistration: true, status: "درجة", score: 46 },
  ]) {
    assert.equal(isPreRegistrationNumericGrade(row), false);
  }
});
