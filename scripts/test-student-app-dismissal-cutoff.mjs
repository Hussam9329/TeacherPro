#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { gradeBeforeCutoff, loadDismissalCutoff } from "../src/lib/student-app/dismissal-cutoff.ts";

const CUTOFF = new Date("2026-10-05T00:00:00Z");
const REASON = "درجة فصل (10): Dismissal exam";
const d = (days, hours = 0) => new Date(CUTOFF.getTime() + days * 86400000 + hours * 3600000);

function fixture() {
  const state = { exams: [], grades: [], logs: [], notes: [], student: { id: "student", dismissalReason: REASON } };
  const matches = (row, where) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v);
  state.client = {
    opportunityLog: { findMany: async ({ where }) => state.logs.filter((r) => matches(r, where)) },
    exam: { findMany: async ({ where }) => state.exams.filter((r) => matches(r, where)) },
    grade: { findMany: async ({ where }) => state.grades.filter((r) => matches(r, where)) },
    studentNote: { findMany: async ({ where }) => state.notes.filter((r) => matches(r, where)) },
  };
  state.exam = (id, name, date, score = 10) => {
    state.exams.push({ id, name, date });
    state.grades.push({ id: `grade-${id}`, studentId: "student", examId: id, score });
  };
  state.log = (id, extra) => state.logs.push({ id, studentId: "student", examId: null, action: "", amount: 0, reason: null, date: CUTOFF, settledGradeIds: null, reversalOfLogId: null, ...extra });
  state.boundary = () => {
    state.exam("old", "Earlier exam", d(-4), 32);
    state.exam("cause", "Dismissal exam", CUTOFF, 10);
    state.exam("new", "Later exam", d(3), 45);
    state.log("dismissal", { examId: "cause", action: "فصل تلقائي", reason: `تلقائي: ${REASON}`, date: d(2) });
  };
  state.run = () => loadDismissalCutoff(state.client, state.student);
  return state;
}

test("automatic dismissal uses the exam date", async () => {
  const s = fixture(); s.boundary();
  const cutoff = await s.run();
  assert.deepEqual(cutoff, { at: CUTOFF, examId: "cause", examName: "Dismissal exam" });
});

test("late log recording keeps exam chronology", async () => {
  const s = fixture(); s.boundary();
  s.student.dismissalReason = null;
  s.logs.find((l) => l.id === "dismissal").date = d(9);
  s.log("later-dismissal", { examId: "new", action: "فصل تلقائي", reason: "تلقائي: Later dismissal", date: d(3) });
  assert.equal((await s.run()).examId, "new");
});

test("current recorded reason wins over an unrelated newer log", async () => {
  const s = fixture(); s.boundary();
  s.log("unrelated", { examId: "new", action: "فصل تلقائي", reason: "تلقائي: Different reason", date: d(9) });
  assert.equal((await s.run()).examId, "cause");
});

test("equal date sources use exam id order, not log ids", async () => {
  const s = fixture();
  for (const id of ["same-a", "same-b", "same-c"]) s.exam(id, id, CUTOFF);
  s.log("z-first", { examId: "same-a", action: "فصل تلقائي", reason: `تلقائي: ${REASON}` });
  s.log("a-second", { examId: "same-b", action: "فصل تلقائي", reason: `تلقائي: ${REASON}` });
  assert.equal((await s.run()).examId, "same-b");
});

test("same day reactivation excludes settled evidence", async () => {
  const s = fixture();
  for (const id of ["same-a", "same-b", "same-c"]) s.exam(id, id, CUTOFF, 20);
  s.student.dismissalReason = null;
  s.log("z-old-dismissal", { examId: "same-a", action: "فصل تلقائي", reason: "Old reason" });
  s.log("a-new-dismissal", { examId: "same-b", action: "فصل تلقائي", reason: "New reason" });
  s.log("recovered", { action: "رصيد إعادة التفعيل", amount: 2, date: d(0, 12), settledGradeIds: JSON.stringify(["grade-same-a"]) });
  assert.equal((await s.run()).examId, "same-b");
});

test("reactivation link exempts the previous source", async () => {
  for (const [key, value] of [["sourceExamId", "same-z"], ["sourceGradeId", "grade-same-z"], ["sourceAutomaticLogId", "z-old-dismissal"]]) {
    const s = fixture();
    for (const id of ["same-a", "same-b", "same-z"]) s.exam(id, id, CUTOFF);
    s.log("z-old-dismissal", { examId: "same-z", action: "فصل تلقائي", reason: `تلقائي: ${REASON}` });
    s.log("a-new-dismissal", { examId: "same-b", action: "فصل تلقائي", reason: `تلقائي: ${REASON}` });
    s.log("recovered", { action: "إعادة تفعيل", date: d(0, 12), reason: `تثبيت إعادة التفعيل [academic-reactivation-link:${new URLSearchParams({ [key]: value })}]` });
    assert.equal((await s.run()).examId, "same-b", key);
  }
});

test("same baghdad day remains eligible across utc midnight", async () => {
  const s = fixture();
  const causeDate = d(0, -1);
  s.exam("old", "Earlier exam", d(0, -4), 40);
  s.exam("cause", "Dismissal exam", causeDate, 10);
  s.log("recovered", { action: "رصيد إعادة التفعيل", amount: 2, date: d(0, 1), settledGradeIds: '["grade-old"]' });
  s.log("dismissal", { examId: "cause", action: "فصل تلقائي", reason: `تلقائي: ${REASON}`, date: causeDate });
  const cutoff = await s.run();
  assert.equal(cutoff?.examId, "cause");
});

test("manual dismissal note uses its dismissalDate", async () => {
  const s = fixture();
  s.exam("old", "Before", d(-1), 0);
  s.exam("new", "After", d(1), 50);
  s.student.dismissalReason = "سبب إداري";
  s.notes.push({ id: "manual", studentId: "student", kind: "إجراء", text: "فصل الطالب: سبب إداري", dismissalReason: "سبب إداري", dismissalDate: CUTOFF, date: d(3) });
  s.notes.push({ id: "recovery-note", studentId: "student", kind: "إجراء", text: "إعادة تفعيل الطالب بعد فصل الطالب سابقاً", dismissalReason: "", dismissalDate: null, date: d(5) });
  assert.deepEqual(await s.run(), { at: CUTOFF, examId: null, examName: null });
});

test("manual deduction uses the recorded reason and ignores reversals", async () => {
  for (const legacy of [false, true]) {
    const s = fixture();
    s.exam("old", "Before deduction", d(-1), 32);
    s.exam("new", "At deduction", CUTOFF, 40);
    const reason = "مخالفة مسجلة";
    s.student.dismissalReason = `مخالفة بعد انتهاء الفرص - خصم يدوي: ${reason}`;
    s.log("deduction", { action: "خصم", amount: 0, reason, date: CUTOFF });
    s.log("undone", { action: "خصم", amount: 1, reason, date: d(2) });
    s.log("undo", legacy
      ? { action: "إضافة", amount: 1, reason: "تراجع [undo-ref:undone]", date: d(3) }
      : { action: "إضافة", amount: 1, reversalOfLogId: "undone", date: d(3) });
    const cutoff = await s.run();
    assert.equal(cutoff?.at.getTime(), CUTOFF.getTime(), `legacy=${legacy}`);
    assert.equal(cutoff?.examId, null);
  }
});

test("missing or mismatched evidence returns null", async () => {
  const s = fixture();
  s.exam("low", "Low mark", CUTOFF, 0);
  assert.equal(await s.run(), null);
  s.log("unrelated", { examId: "low", action: "فصل تلقائي", reason: "تلقائي: Different dismissal reason" });
  assert.equal(await s.run(), null);
});

test("another student's dismissal cannot establish this cutoff", async () => {
  const s = fixture();
  s.exam("cause", "Dismissal exam", CUTOFF, 10);
  s.logs.push({ id: "other-log", studentId: "other", examId: "cause", action: "فصل تلقائي", reason: `تلقائي: ${REASON}`, date: CUTOFF, settledGradeIds: null, reversalOfLogId: null });
  s.notes.push({ id: "other-note", studentId: "other", kind: "إجراء", text: `فصل الطالب: ${REASON}`, dismissalReason: REASON, dismissalDate: CUTOFF, date: CUTOFF });
  assert.equal(await s.run(), null);
});

test("undated dismissal exam returns null", async () => {
  const s = fixture();
  s.exam("unknown-date", "Undated", null, 10);
  s.log("undated", { examId: "unknown-date", action: "فصل تلقائي", reason: `تلقائي: ${REASON}` });
  assert.equal(await s.run(), null);
});

test("invalid reactivation settlement returns null", async () => {
  for (const value of ["invalid-json", '{"grade-old": true}', "[123]"]) {
    const s = fixture(); s.boundary();
    s.log("recovered", { action: "رصيد إعادة التفعيل", amount: 2, date: d(0, 12), settledGradeIds: value });
    assert.equal(await s.run(), null, value);
  }
});

test("gradeBeforeCutoff shape", () => {
  const withExam = gradeBeforeCutoff({ at: CUTOFF, examId: "cause", examName: "x" });
  assert.equal(withExam.examId.not, "cause");
  assert.equal(withExam.exam.OR.length, 2);
  assert.deepEqual(withExam.exam.OR[0], { date: { lt: CUTOFF } });
  assert.deepEqual(withExam.exam.OR[1], { date: CUTOFF, id: { lt: "cause" } });
  const without = gradeBeforeCutoff({ at: CUTOFF, examId: null, examName: null });
  assert.equal("examId" in without, false);
  assert.deepEqual(without.exam, { date: { lt: CUTOFF } });
});
