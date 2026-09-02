import assert from "node:assert/strict";
import test from "node:test";
import {
  LEAVE_END_CONFIRMATION_MESSAGE,
  requiresLeaveEndConfirmation,
} from "../src/lib/grade-leave-safety.ts";

test("a zero numeric grade still requires explicit leave termination approval", () => {
  assert.equal(
    requiresLeaveEndConfirmation({
      hasBlockingLeave: true,
      status: "درجة",
      score: 0,
    }),
    true,
  );
});

test("an explicitly confirmed numeric grade may proceed", () => {
  assert.equal(
    requiresLeaveEndConfirmation({
      hasBlockingLeave: true,
      status: "درجة",
      score: 17,
      confirmLeaveEnd: true,
    }),
    false,
  );
});

test("an automated numeric writer without confirmation fails closed", () => {
  assert.equal(
    requiresLeaveEndConfirmation({
      hasBlockingLeave: true,
      status: "درجة",
      score: 12,
      confirmLeaveEnd: false,
    }),
    true,
  );
});

test("absence and cheating markers never request leave termination approval", () => {
  for (const status of ["غائب", "غش", "مجاز"]) {
    assert.equal(
      requiresLeaveEndConfirmation({
        hasBlockingLeave: true,
        status,
        score: null,
      }),
      false,
    );
  }
});

test("a numeric grade without a covering leave does not ask for confirmation", () => {
  assert.equal(
    requiresLeaveEndConfirmation({
      hasBlockingLeave: false,
      status: "درجة",
      score: 10,
    }),
    false,
  );
});

test("the warning explains the full effect of ending a period leave", () => {
  assert.match(LEAVE_END_CONFIRMATION_MESSAGE, /إجازة فترة/);
  assert.match(LEAVE_END_CONFIRMATION_MESSAGE, /الفترة كاملة/);
  assert.match(LEAVE_END_CONFIRMATION_MESSAGE, /بقية امتحاناتها/);
});
