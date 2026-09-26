const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const { recalculateAcademicState } = require("../src/lib/academic-engine.ts");

const date = (day, time = "00:00:00") => `2026-09-${day}T${time}.000Z`;
const exam = (id, day, penalty = 1) => ({
  id, name: id, date: date(day), type: penalty === 2 ? "تراكمي" : "يومي",
  fullMark: 100, passMark: 50, discountMark: 49, opportunitiesPenalty: penalty,
  dismissalGrade: null, noDiscount: false, active: true, courseIds: ["course"],
  examCourses: [{ courseId: "course", chapterId: "chapter" }],
});
const grade = (id, entered, overrides = {}) => ({
  id: `grade-${id}`, studentId: "student", examId: id, status: "غائب", score: null,
  createdAt: date(entered, "08:00:00"), updatedAt: date(entered, "08:00:00"), ...overrides,
});
const command = (id, day, amount, overrides = {}) => ({
  id, studentId: "student", examId: "", action: "إضافة", amount, appliedAmount: amount,
  balanceBefore: 1, balanceAfter: 2, ledgerVersion: 2, reason: "إضافة إدارية",
  chapterId: "chapter", date: date(day, "12:00:00"), ...overrides,
});
const fixture = (exams = [], grades = [], commands = []) => ({
  students: [{
    id: "student", courseId: "course", status: "نشط", dismissalReason: "",
    opportunities: 2, baseOpportunities: 3, createdAt: date("01"), gracePeriods: [],
  }],
  chapters: [{ id: "chapter", name: "الفصل الحالي", opportunities: 3 }],
  courseChapters: [{ id: "link", courseId: "course", chapterId: "chapter", active: true, archived: false }],
  exams, grades,
  opportunityLogs: [
    command("opening", "10", 3, { action: "إعادة تعيين", balanceAfter: 3, settledGradeIds: "[]", reason: "انتقال فصل" }),
    ...commands,
  ],
  studentLeaves: [], studentNotes: [],
});

function observe(state) {
  const original = JSON.stringify(state);
  const expected = recalculateAcademicState(state, new Set(["student"]));
  const effects = [];
  const result = recalculateAcademicState(state, new Set(["student"]), {
    onOpportunityCommand(effect) {
      assert.ok(Object.isFrozen(effect), "observer data is an immutable copy");
      assert.throws(() => {
        "use strict";
        effect.balanceAfter = 999;
      }, TypeError);
      effects.push(effect);
    },
  });
  assert.deepEqual(result, expected, "collecting command effects never changes the academic calculation");
  assert.equal(JSON.stringify(state), original, "collecting effects does not mutate grades, pending notes, or recorded command snapshots");
  return { result, effects };
}

const cappedAddition = fixture(
  [exam("old-absence", "16")],
  [grade("old-absence", "19")],
  [command("two-opportunity-credit", "18", 2, { balanceBefore: 1, balanceAfter: 3 })],
);
const capped = observe(cappedAddition);
assert.equal(capped.result.students[0].opportunities, 3);
assert.deepEqual(capped.effects, [{
  studentId: "student", chapterId: "chapter", logId: "two-opportunity-credit",
  balanceBefore: 2, balanceAfter: 3, amount: 1, cap: 3,
}], "a recorded two-opportunity grant applies only one opportunity when the recomputed balance is already two");
assert.equal(cappedAddition.opportunityLogs[1].appliedAmount, 2, "the original applied amount is retained as history");

const twoDistinctAdds = observe(fixture(
  [exam("cumulative-absence", "13", 2), exam("daily-absence", "16")],
  [grade("cumulative-absence", "13"), grade("daily-absence", "19")],
  [command("first-credit", "18", 1), command("second-credit", "19", 1)],
));
assert.equal(twoDistinctAdds.result.students[0].opportunities, 2);
assert.deepEqual(twoDistinctAdds.effects.map(({ logId, balanceBefore, balanceAfter, amount }) => ({ logId, balanceBefore, balanceAfter, amount })), [
  { logId: "first-credit", balanceBefore: 0, balanceAfter: 1, amount: 1 },
  { logId: "second-credit", balanceBefore: 1, balanceAfter: 2, amount: 1 },
], "separate additions follow the authoritative 0 → 1 → 2 replay, not their old identical balance snapshots");

const atCap = observe(fixture([], [], [command("already-full", "18", 2)]));
assert.equal(atCap.result.students[0].opportunities, 3);
assert.deepEqual(atCap.effects.map(({ balanceBefore, balanceAfter, amount }) => ({ balanceBefore, balanceAfter, amount })), [
  { balanceBefore: 3, balanceAfter: 3, amount: 0 },
], "an executed addition is observable even when the chapter cap makes its current effect zero");

const afterSettlement = observe(fixture([], [], [
  command("historical-credit", "18", 1),
  command("new-opening", "20", 2, { action: "إعادة تعيين", balanceAfter: 2, settledGradeIds: "[]" }),
  command("current-credit", "21", 1),
]));
assert.deepEqual(afterSettlement.effects.map(effect => effect.logId), ["current-credit"], "commands before the latest settlement are not projected as current replay effects");
assert.equal(afterSettlement.effects[0].balanceBefore, 2);
assert.equal(afterSettlement.effects[0].balanceAfter, 3);

const pendingState = fixture(
  [exam("pending-exam", "16")],
  [grade("pending-exam", "19", { status: "درجة معلّقة", score: 20, smartNoteId: "pending-note" })],
  [command("pending-student-credit", "18", 1)],
);
pendingState.studentNotes = [{ id: "pending-note", studentId: "student", kind: "متابعة", text: "درجة قيد المراجعة", date: date("19") }];
const pending = observe(pendingState);
assert.equal(pending.result.students[0].opportunities, 3);
assert.equal(pending.result.opportunityLogs.some(log => log.action === "خصم تلقائي" || log.action === "فصل تلقائي"), false);
assert.equal(pending.effects[0].amount, 0, "pending scores cannot create room under the cap by inventing a deduction");

const manualDeduction = observe(fixture([], [], [command("manual-debit", "18", 2, { action: "خصم" })]));
assert.deepEqual(manualDeduction.effects.map(({ balanceBefore, balanceAfter, amount }) => ({ balanceBefore, balanceAfter, amount })), [
  { balanceBefore: 3, balanceAfter: 1, amount: 2 },
], "deduction effects use the same observed absolute delta");

const sameTimeCommands = fixture([], [], [
  command("z-same-time-debit", "18", 1, { action: "خصم" }),
  command("a-same-time-credit", "18", 1),
]);
sameTimeCommands.opportunityLogs[0].amount = 1;
sameTimeCommands.opportunityLogs[0].balanceAfter = 1;
const sameTimeForward = observe(sameTimeCommands);
const sameTimeReversed = observe({
  ...sameTimeCommands,
  opportunityLogs: [...sameTimeCommands.opportunityLogs].reverse(),
});
assert.deepEqual(sameTimeForward.effects.map(({ logId, balanceBefore, balanceAfter }) => ({ logId, balanceBefore, balanceAfter })), [
  { logId: "a-same-time-credit", balanceBefore: 1, balanceAfter: 2 },
  { logId: "z-same-time-debit", balanceBefore: 2, balanceAfter: 1 },
], "equal-timestamp commands use ascending IDs as their stable tie-breaker");
assert.deepEqual(sameTimeForward.effects, sameTimeReversed.effects, "reversing the source query order cannot change command effects");
assert.deepEqual(sameTimeForward.result.students, sameTimeReversed.result.students, "reversing the source query order cannot change calculated students");
const logsById = result => [...result.opportunityLogs].sort((a, b) => a.id.localeCompare(b.id));
assert.deepEqual(logsById(sameTimeForward.result), logsById(sameTimeReversed.result), "reversing the source query order cannot change the returned ledger's contents");

console.log("PASS: immutable command effects expose actual capped replay balances, preserve historical snapshots and pending grades, and leave academic results unchanged");
