import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCallHistoryMigrationPlan,
  CALL_STUDENT_NOTE_CATEGORY,
  effectiveCallStatus,
} from "./call-history-migration-core.mjs";

function call(overrides = {}) {
  return {
    id: overrides.id || `call-${Math.random()}`,
    studentId: "student-1",
    examId: "exam-1",
    category: "absent",
    target: "ولي الأمر",
    phone: "07700000000",
    status: "",
    completed: false,
    completedAt: null,
    notes: "",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

test("legacy completed=true with empty status is preserved as contacted", () => {
  assert.deepEqual(effectiveCallStatus(call({ completed: true })), {
    status: "تم الاتصال",
    unsupportedStatus: null,
  });
});

test("empty + one valid status merges safely without losing that status", () => {
  const plan = buildCallHistoryMigrationPlan([
    call({ id: "a", category: "absent" }),
    call({
      id: "b",
      category: "grade:old",
      status: "تم الاتصال",
      completed: true,
      completedAt: "2026-08-02T10:00:00.000Z",
      createdAt: "2026-08-02T10:00:00.000Z",
    }),
  ]);
  assert.equal(plan.summary.duplicateGroups, 1);
  assert.equal(plan.summary.unresolvedConflictGroups, 0);
  assert.equal(plan.duplicateGroups[0].merge.status, "تم الاتصال");
  assert.equal(plan.duplicateGroups[0].merge.completed, true);
  assert.deepEqual(plan.duplicateGroups[0].deleteIds, ["b"]);
});

test("two different valid statuses block automatic apply", () => {
  const plan = buildCallHistoryMigrationPlan([
    call({ id: "a", status: "تم الاتصال", completed: true }),
    call({ id: "b", category: "grade:new", status: "لم يرد", createdAt: "2026-08-03" }),
  ]);
  assert.equal(plan.summary.statusConflictGroups, 1);
  assert.equal(plan.summary.unresolvedConflictGroups, 1);
  assert.ok(plan.duplicateGroups[0].conflictTypes.includes("STATUS_CONFLICT"));
});

test("different non-empty notes block automatic apply", () => {
  const plan = buildCallHistoryMigrationPlan([
    call({ id: "a", status: "لم يرد", notes: "اتصل صباحاً" }),
    call({ id: "b", category: "grade:new", status: "لم يرد", notes: "اتصل مساءً", createdAt: "2026-08-03" }),
  ]);
  assert.equal(plan.summary.noteConflictGroups, 1);
  assert.equal(plan.summary.unresolvedConflictGroups, 1);
});

test("explicit resolutions unblock a conflicting logical call", () => {
  const rows = [
    call({ id: "a", status: "تم الاتصال", completed: true, notes: "أول اتصال" }),
    call({ id: "b", category: "grade:new", status: "لم يرد", notes: "ثاني اتصال", createdAt: "2026-08-03" }),
  ];
  const plan = buildCallHistoryMigrationPlan(rows, {
    "student-1::exam-1": {
      status: "تم الاتصال",
      notes: "أول اتصال / ثاني اتصال",
    },
  });
  assert.equal(plan.summary.unresolvedConflictGroups, 0);
  assert.equal(plan.duplicateGroups[0].resolutionApplied, true);
  assert.equal(plan.duplicateGroups[0].merge.status, "تم الاتصال");
  assert.equal(plan.duplicateGroups[0].merge.notes, "أول اتصال / ثاني اتصال");
});

test("manual call-student-note rows are excluded from exam-call deduplication", () => {
  const plan = buildCallHistoryMigrationPlan([
    call({ id: "call" }),
    call({
      id: "note",
      category: CALL_STUDENT_NOTE_CATEGORY,
      notes: "ملاحظة مستقلة",
    }),
  ]);
  assert.equal(plan.summary.duplicateGroups, 0);
  assert.equal(plan.summary.manualStudentNoteRows, 1);
});

test("different exams for the same student never merge", () => {
  const plan = buildCallHistoryMigrationPlan([
    call({ id: "a", examId: "exam-1" }),
    call({ id: "b", examId: "exam-2", category: "grade:x" }),
  ]);
  assert.equal(plan.summary.duplicateGroups, 0);
  assert.equal(plan.summary.logicalExamCalls, 2);
});

test("metadata differences are warnings, not silent blockers", () => {
  const plan = buildCallHistoryMigrationPlan([
    call({ id: "a", status: "لم يرد", phone: "0771" }),
    call({ id: "b", category: "grade:x", status: "لم يرد", phone: "0772", createdAt: "2026-08-03" }),
  ]);
  assert.equal(plan.summary.unresolvedConflictGroups, 0);
  assert.equal(plan.summary.metadataWarningGroups, 1);
  assert.equal(plan.duplicateGroups[0].merge.phone, "0772");
});

test("unsupported historical statuses require explicit resolution", () => {
  const plan = buildCallHistoryMigrationPlan([
    call({ id: "a", status: "حالة قديمة" }),
    call({ id: "b", category: "grade:x", status: "", createdAt: "2026-08-03" }),
  ]);
  assert.equal(plan.summary.unsupportedStatusGroups, 1);
  assert.equal(plan.summary.unresolvedConflictGroups, 1);
});
