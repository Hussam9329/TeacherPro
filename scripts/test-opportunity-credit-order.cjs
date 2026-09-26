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
assert.equal(student(multiple).opportunities, 2, "late results interleave with multiple credits in entry order");

const reordered = fixture();
reordered.exams.at(-1).date = date("13");
assert.equal(student(reordered).opportunities, 2, "late backdated result cannot advance credit ahead of already-recorded later exams");

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

console.log("PASS: recorded credits precede newly entered backdated results; old debits, caps, exclusions, dismissal rules and scoped recovery remain intact");
