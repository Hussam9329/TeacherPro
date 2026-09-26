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
const result = input => recalculateAcademicState(input, new Set(["student"]));
const student = input => result(input).students[0];
function exam(id, day) {
  return {
    id, name: id, type: "يومي", date: date(day), fullMark: 20,
    passMark: 15, discountMark: 0, opportunitiesPenalty: 1,
    dismissalGrade: null, noDiscount: false, active: true, courseIds: ["course"],
    examCourses: [{ courseId: "course", chapterId: "chapter" }],
  };
}
function grade(id, entered) {
  return {
    id: `grade-${id}`, studentId: "student", examId: id, status: "غائب",
    score: null, createdAt: entered, updatedAt: entered,
  };
}
function fixture() {
  return {
    students: [{
      id: "student", courseId: "course", status: "نشط", dismissalReason: "",
      opportunities: 3, baseOpportunities: 3, createdAt: "2026-08-08T00:00:00.000Z",
      gracePeriods: [],
    }],
    chapters: [{ id: "chapter", name: "الفصل الحالي", opportunities: 3 }],
    courseChapters: [{ id: "link", courseId: "course", chapterId: "chapter", active: true, archived: false }],
    exams: [exam("fourth", "12"), exam("fifth", "16"), exam("sixth", "19"), exam("seventh", "23")],
    grades: [
      grade("fourth", date("16", "19:11:01")),
      grade("fifth", date("19", "05:51:52")),
      grade("sixth", date("22", "17:38:44")),
      grade("seventh", date("25", "18:36:22")),
    ],
    opportunityLogs: [
      {
        id: "grant", studentId: "student", action: "رصيد إعادة التفعيل",
        amount: 3, appliedAmount: 3, balanceBefore: 0, balanceAfter: 3,
        ledgerVersion: 2, settledGradeIds: "[]", reason: "استعادة سابقة",
        chapterId: "chapter", date: date("10", "17:31:59"),
      },
      {
        id: "credit", studentId: "student", action: "إضافة",
        amount: 3, appliedAmount: 3, balanceBefore: 0, balanceAfter: 3,
        ledgerVersion: 2, settledGradeIds: null, reason: "جديد",
        chapterId: "chapter", date: date("23", "16:22:29"),
      },
    ],
    studentLeaves: [], studentNotes: [],
  };
}

const input = fixture();
const original = JSON.stringify(input);
const beforeEntry = structuredClone(input);
beforeEntry.grades.pop();
assert.equal(student(beforeEntry).opportunities, 3);
const after = result(input);
assert.equal(after.students[0].status, "نشط");
assert.equal(after.students[0].opportunities, 2, "late absence spends one of the three recorded credits");
assert.equal(after.opportunityLogs.some(log => log.action === "فصل تلقائي"), false);
const debit = after.opportunityLogs.find(log => log.examId === "seventh" && log.action === "خصم تلقائي");
assert.equal(debit.amount, 1);
assert.equal(debit.date, date("23"), "displayed exam history retains its original date");
assert.equal(JSON.stringify(input), original, "replay never mutates its input");
assert.deepEqual(result({ ...input, ...after }), after, "repeating a replay never spends the credit twice");

const scored = fixture();
scored.grades.at(-1).status = "درجة";
scored.grades.at(-1).score = 0;
assert.equal(student(scored).opportunities, 2, "new recorded low scores use the same credit boundary");

for (const change of [
  state => { state.opportunityLogs.pop(); },
  state => { state.opportunityLogs[1].appliedAmount = 0; },
  state => { state.opportunityLogs[1].chapterId = "other-chapter"; },
  state => { state.opportunityLogs[1].date = date("26"); },
  state => { state.grades.at(-1).createdAt = date("23", "10:00:00"); },
  state => { state.grades.at(-1).createdAt = ""; },
]) {
  const state = fixture();
  change(state);
  assert.equal(student(state).status, "مفصول", "only an actual credit preceding a NEW grade qualifies");
}

const edited = fixture();
edited.grades.forEach(row => { row.updatedAt = date("26"); });
assert.equal(student(edited).opportunities, 2, "later edits do not replay old deductions against the new credit");

const multiple = fixture();
multiple.opportunityLogs.push({ ...multiple.opportunityLogs[1], id: "later-credit", amount: 1, appliedAmount: 1, date: date("26"), balanceBefore: 2, balanceAfter: 3 });
multiple.exams.push(exam("late-second", "24"));
multiple.grades.push(grade("late-second", date("27")));
assert.equal(student(multiple).opportunities, 2, "a next-day exam is deducted before a still-later credit despite delayed entry");

function chronologicalFixture(exams, grades, credits, opening = 3) {
  const state = fixture();
  state.exams = exams;
  state.grades = grades;
  state.students[0].opportunities = opening;
  state.opportunityLogs = [
    { ...state.opportunityLogs[0], amount: opening, appliedAmount: opening, balanceAfter: opening },
    ...credits.map((credit, index) => ({
      ...state.opportunityLogs[1], id: `chronological-credit-${index}`,
      balanceBefore: undefined, balanceAfter: undefined, ...credit,
    })),
  ];
  return state;
}

const reordered = fixture();
reordered.exams.at(-1).date = date("13");
assert.equal(student(reordered).opportunities, 3, "an old result entered after a future credit is charged before it without retroactively dismissing a student whose known ledger had not violated zero");
assert.equal(student(reordered).status, "نشط");
assert.equal(result(reordered).opportunityLogs.some(log => log.action === "فصل تلقائي"), false);
assert.deepEqual(result({ ...reordered, ...result(reordered) }), result(reordered), "deferred old penalties remain stable on repeated replay");

const actualDay = chronologicalFixture(
  [exam("absence-before-addition", "16")],
  [grade("absence-before-addition", date("19", "08:00:00"))],
  [{ date: date("18", "10:00:00"), amount: 2, appliedAmount: 2 }],
);
const actualDayBefore = JSON.stringify(actualDay);
assert.equal(student(actualDay).status, "نشط");
assert.equal(student(actualDay).opportunities, 3, "September 16 absence is deducted before the September 18 addition, regardless of September 19 entry");
assert.equal(result(actualDay).opportunityLogs.filter(log => log.action === "خصم تلقائي").length, 1);
assert.equal(JSON.stringify(actualDay), actualDayBefore);
assert.deepEqual(result({ ...actualDay, ...result(actualDay) }), result(actualDay), "actual-day replay is idempotent");

const futureCredits = chronologicalFixture(
  [exam("older-absence", "16"), exam("actual-later-absence", "19")],
  [grade("older-absence", date("25", "08:00:00")), grade("actual-later-absence", date("25", "09:00:00"))],
  [
    { date: date("17", "10:00:00"), amount: 2, appliedAmount: 2 },
    { date: date("18", "10:00:00"), amount: 1, appliedAmount: 1 },
  ],
);
assert.equal(student(futureCredits).opportunities, 2, "the older absence precedes both future credits, followed by the genuine later exam penalty");
assert.equal(student(futureCredits).status, "نشط");
assert.deepEqual(result(futureCredits).opportunityLogs.filter(log => log.action === "خصم تلقائي").map(log => log.examId), ["older-absence", "actual-later-absence"]);

const pinnedToCredit = chronologicalFixture(
  [exam("late-same-day", "16"), exam("next-day", "17")],
  [grade("late-same-day", date("25", "08:00:00")), grade("next-day", date("17", "09:00:00"))],
  [
    { date: date("16", "10:00:00"), amount: 1, appliedAmount: 1 },
    { date: date("18", "10:00:00"), amount: 2, appliedAmount: 2 },
  ],
  0,
);
assert.equal(student(pinnedToCredit).status, "مفصول", "same-day credit protection cannot delay its penalty beyond a real next-day penalty at zero");
assert.equal(result(pinnedToCredit).opportunityLogs.find(log => log.action === "فصل تلقائي").examId, "next-day");
assert.equal(result(pinnedToCredit).opportunityLogs.find(log => log.examId === "late-same-day" && log.action === "خصم تلقائي").amount, 1);

const noEarlyCredit = chronologicalFixture(
  [exam("already-recorded", "15"), exam("delayed", "16"), exam("following", "17")],
  [grade("already-recorded", date("15", "08:00:00")), grade("delayed", date("25", "08:00:00")), grade("following", date("17", "08:00:00"))],
  [{ date: date("16", "10:00:00"), amount: 2, appliedAmount: 2 }],
);
assert.equal(student(noEarlyCredit).opportunities, 1, "credit stays after the already-recorded earlier exam, then both later penalties are charged in exam order");
assert.deepEqual(result(noEarlyCredit).opportunityLogs.filter(log => log.action === "خصم تلقائي").map(log => log.examId), ["already-recorded", "delayed", "following"]);

const firstFutureCreditOnly = chronologicalFixture(
  [exam("deferred-old", "11"), exam("known-after-first-credit", "14"), exam("known-zero-violation", "15")],
  [grade("deferred-old", date("20", "08:00:00")), grade("known-after-first-credit", date("14", "08:00:00")), grade("known-zero-violation", date("15", "08:00:00"))],
  [
    { date: date("13", "10:00:00"), amount: 1, appliedAmount: 1 },
    { date: date("17", "10:00:00"), amount: 1, appliedAmount: 1 },
  ],
  0,
);
assert.equal(student(firstFutureCreditOnly).status, "مفصول", "deferred-old-grade protection ends at the first future credit; a later real zero violation is not erased by another credit");
assert.equal(student(firstFutureCreditOnly).opportunities, 0);
assert.equal(result(firstFutureCreditOnly).opportunityLogs.find(log => log.action === "فصل تلقائي").examId, "known-zero-violation");

const existingZeroViolation = chronologicalFixture(
  [exam("deferred-old", "11"), exam("known-zero-before-credit", "12")],
  [grade("deferred-old", date("20", "08:00:00")), grade("known-zero-before-credit", date("12", "08:00:00"))],
  [{ date: date("13", "10:00:00"), amount: 2, appliedAmount: 2 }],
  0,
);
assert.equal(student(existingZeroViolation).status, "مفصول", "a known violation already at zero in the original ledger remains a dismissal before the future credit");
assert.equal(result(existingZeroViolation).opportunityLogs.find(log => log.action === "فصل تلقائي").examId, "known-zero-before-credit");

const latestSameDayCredit = chronologicalFixture(
  [exam("same-day-two-credits", "16")],
  [grade("same-day-two-credits", date("19", "08:00:00"))],
  [
    { date: date("16", "08:00:00"), amount: 1, appliedAmount: 1 },
    { date: date("16", "12:00:00"), amount: 1, appliedAmount: 1 },
  ],
  2,
);
assert.equal(student(latestSameDayCredit).opportunities, 2, "latest qualifying same-day credit anchors the delayed result; both recorded credits precede that deduction");

const acrossUtcMidnight = chronologicalFixture(
  [{ ...exam("baghdad-same-day", "16"), date: date("16", "21:30:00") }],
  [grade("baghdad-same-day", date("19", "08:00:00"))],
  [{ date: date("17", "07:00:00"), amount: 2, appliedAmount: 2 }],
  0,
);
assert.equal(student(acrossUtcMidnight).status, "نشط", "different UTC dates on the same Baghdad day still qualify for same-day protection");
assert.equal(student(acrossUtcMidnight).opportunities, 1);
const acrossBaghdadMidnight = chronologicalFixture(
  [{ ...exam("baghdad-prior-day", "16"), date: date("16", "20:59:59") }],
  [grade("baghdad-prior-day", date("19", "08:00:00"))],
  [{ date: date("16", "21:00:00"), amount: 2, appliedAmount: 2 }],
  2,
);
assert.equal(student(acrossBaghdadMidnight).status, "نشط");
assert.equal(student(acrossBaghdadMidnight).opportunities, 3, "same UTC date across Baghdad midnight is a later-day credit, applied after the prior exam");

const oldRecordedGrade = chronologicalFixture(
  [exam("edited-after-credit", "16")],
  [{ ...grade("edited-after-credit", date("16", "07:00:00")), updatedAt: date("25", "08:00:00") }],
  [{ date: date("16", "10:00:00"), amount: 1, appliedAmount: 1 }],
  3,
);
assert.equal(student(oldRecordedGrade).opportunities, 3, "updatedAt cannot move a previously recorded exam after a same-day credit");

for (const [status, score] of [["درجة", 20], ["درجة معلّقة", null], ["درجة", null]]) {
  const protectedResult = chronologicalFixture(
    [exam("unpenalized-result", "16")],
    [{ ...grade("unpenalized-result", date("19", "08:00:00")), status, score }],
    [{ date: date("18", "10:00:00"), amount: 2, appliedAmount: 2 }],
  );
  protectedResult.studentNotes = [{ id: "pending-note", studentId: "student", kind: "متابعة", text: "درجة قيد المراجعة", date: date("19") }];
  const before = JSON.stringify(protectedResult);
  const replay = result(protectedResult);
  assert.equal(replay.students[0].opportunities, 3);
  assert.equal(replay.students[0].status, "نشط");
  assert.equal(replay.opportunityLogs.some(log => log.action === "خصم تلقائي" || log.action === "فصل تلقائي"), false, "full scores and pending results never invent penalties");
  assert.equal(JSON.stringify(protectedResult), before, "grades, pending statuses and notes remain untouched");
}

for (const [id, day, remaining, status] of [
  ["eighth", "26", 1, "نشط"],
  ["ninth", "26", 0, "نشط"],
  ["tenth", "26", 0, "مفصول"],
]) {
  input.exams.push(exam(id, day));
  input.grades.push(grade(id, date(day, "18:00:00")));
  assert.equal(student(input).opportunities, remaining);
  assert.equal(student(input).status, status, "zero balance dismisses only on the NEXT penalty");
}

for (const protect of [
  state => { state.exams.at(-1).noDiscount = true; },
  state => { state.exams.at(-1).examCourses[0].chapterId = "previous-chapter"; },
  state => { state.grades.at(-1).academicEffectExcluded = true; },
  state => { state.students[0].gracePeriods = [{ startDate: "2026-09-23", endDate: "2026-09-23" }]; },
  state => { state.studentLeaves = [{ id: "leave", studentId: "student", examId: "seventh", leaveType: "exam", date: date("23") }]; },
]) {
  const state = fixture();
  protect(state);
  assert.equal(student(state).opportunities, 3, "existing exam-date and exclusion protections still apply");
  assert.equal(student(state).status, "نشط");
}

for (const trigger of [
  state => { state.exams.at(-1).type = "فاينل"; },
  state => { state.grades.at(-1).status = "غش"; },
]) {
  const state = fixture();
  trigger(state);
  assert.equal(student(state).status, "مفصول", "credits cannot waive direct dismissal policies");
}

const dismissed = fixture();
dismissed.students[0].status = "مفصول";
dismissed.students[0].opportunities = 0;
dismissed.students[0].dismissalReason = "مخالفة بعد انتهاء الفرص - غياب في امتحان يومي: seventh";
assert.equal(student(dismissed).status, "مفصول", "persisted dismissals still require explicit restoration");
assert.equal(student(dismissed).opportunities, 0);
const unrelated = { ...dismissed.students[0], id: "untargeted", opportunities: 0 };
dismissed.students.push(unrelated);
assert.deepEqual(result(dismissed).students[1], unrelated, "scoped replay preserves other students");

const historicalZeroReplay = chronologicalFixture(
  [exam("late-old-result", "11"), exam("known-first", "12"), exam("known-second", "13"), exam("introduced-zero", "14"), exam("known-zero", "15")],
  [grade("late-old-result", date("19", "08:00:00")), grade("known-first", date("12", "08:00:00")), grade("known-second", date("13", "08:00:00")), grade("introduced-zero", date("14", "08:00:00")), grade("known-zero", date("15", "08:00:00"))],
  [{ date: date("18", "12:00:00"), amount: 3, appliedAmount: 3 }],
  3,
);
const firstHistoricalZeroReplay = result(historicalZeroReplay);
assert.equal(firstHistoricalZeroReplay.students[0].status, "مفصول", "an already-known zero violation still dismisses after the earlier introduced zero is suppressed");
assert.equal(firstHistoricalZeroReplay.students[0].opportunities, 0);
assert.deepEqual(firstHistoricalZeroReplay.opportunityLogs.filter(log => log.action === "فصل تلقائي").map(log => log.examId), ["known-zero"], "the late old result must not invent a September 14 dismissal before the real September 15 violation");
assert.deepEqual(result({ ...historicalZeroReplay, ...firstHistoricalZeroReplay }), firstHistoricalZeroReplay, "persisting dismissed status must not reintroduce the suppressed historical dismissal on a second replay");

console.log("PASS: exam-day chronology precedes future credits; same-Baghdad-day protection stays at the credit time without changing grades, pending results, caps, exclusions or dismissal rules");
