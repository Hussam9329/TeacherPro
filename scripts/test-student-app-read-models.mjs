#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { displayGrade, examMatchesCourse, listRecentGrades, listUpcomingExams } from "../src/lib/student-app/read-models.ts";

const NOW = new Date("2026-10-17T12:00:00Z");
const h = (hours) => new Date(NOW.getTime() + hours * 3600000);
const CUTOFF = new Date("2026-10-05T00:00:00Z");
const REASON = "درجة فصل (10): Dismissal exam";
const d = (days) => new Date(CUTOFF.getTime() + days * 86400000);

function store() {
  const s = { exams: [], grades: [], logs: [], notes: [] };
  const matches = (row, where) => Object.entries(where).every(([k, v]) => {
    if (k === "exam") return matches(s.exams.find((e) => e.id === row.examId) ?? {}, v);
    if (k === "OR") return v.some((alt) => matches(row, alt));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("lt" in v) return row[k] != null && row[k] < v.lt;
      if ("gt" in v) return row[k] != null && row[k] > v.gt;
      return matches(row[k] ?? {}, v);
    }
    return v instanceof Date ? row[k]?.getTime() === v.getTime() : row[k] === v;
  });
  s.client = {
    exam: { findMany: async ({ where }) => s.exams.filter((r) => matches(r, where)) },
    grade: {
      findMany: async ({ where, orderBy, take }) => {
        const rows = s.grades.filter((r) => matches(r, where)).map((g) => ({ ...g, exam: s.exams.find((e) => e.id === g.examId) }));
        rows.sort((a, b) => (b.exam.date?.getTime() ?? 0) - (a.exam.date?.getTime() ?? 0) || b.createdAt - a.createdAt);
        assert.ok(orderBy, "orderBy required");
        return take ? rows.slice(0, take) : rows;
      },
    },
    opportunityLog: { findMany: async ({ where }) => s.logs.filter((r) => matches(r, where)) },
    studentNote: { findMany: async ({ where }) => s.notes.filter((r) => matches(r, where)) },
  };
  s.exam = (id, extra) => s.exams.push({ id, name: id, date: NOW, active: true, courseIds: JSON.stringify(["c1"]), telegramOpenAt: null, telegramCloseAt: null, fullMark: 50, ...extra });
  s.grade = (examId, extra) => s.grades.push({ id: `grade-${examId}`, studentId: "student", examId, status: "درجة", score: 10, createdAt: NOW, ...extra });
  return s;
}

test("examMatchesCourse mirrors the bot", () => {
  assert.equal(examMatchesCourse({ courseIds: null }, "c1"), true);
  assert.equal(examMatchesCourse({ courseIds: '["c1","c2"]' }, "c1"), true);
  assert.equal(examMatchesCourse({ courseIds: '["c2"]' }, "c1"), false);
  assert.equal(examMatchesCourse({ courseIds: "{bad" }, "c1"), false);
  assert.equal(examMatchesCourse({ courseIds: '["c1"]' }, ""), false);
});

test("upcoming exams: window, course and ordering rules", async () => {
  const s = store();
  s.exam("no-window");
  s.exam("open-null", { telegramCloseAt: h(5) });
  s.exam("closed", { telegramOpenAt: h(-10), telegramCloseAt: h(-1) });
  s.exam("bad-json", { courseIds: "{bad", telegramOpenAt: h(1), telegramCloseAt: h(5) });
  s.exam("other-course", { courseIds: '["c9"]', telegramOpenAt: h(1), telegramCloseAt: h(5) });
  s.exam("inactive", { active: false, telegramOpenAt: h(1), telegramCloseAt: h(5) });
  s.exam("all-courses", { courseIds: null, telegramOpenAt: h(24), telegramCloseAt: h(30) });
  s.exam("future", { telegramOpenAt: h(2), telegramCloseAt: h(6) });
  s.exam("open-now", { telegramOpenAt: h(-1), telegramCloseAt: h(5) });
  const rows = await listUpcomingExams(s.client, { courseId: "c1" }, NOW);
  assert.deepEqual(rows.map((r) => r.id), ["open-now", "future", "all-courses"]);
  assert.deepEqual(rows.map((r) => r.isOpen), [true, false, false]);
  assert.equal(rows[0].openAt.getTime(), h(-1).getTime());
  assert.equal(rows[0].closeAt.getTime(), h(5).getTime());
});

test("displayGrade formats score, status text and pending", () => {
  assert.equal(displayGrade({ score: 32, status: "درجة" }, 50), "32 / 50");
  assert.equal(displayGrade({ score: 0, status: "درجة" }, null), "0 / —");
  assert.equal(displayGrade({ score: null, status: "غائب" }, 50), "غائب");
  assert.equal(displayGrade({ score: null, status: "ضمن فترة السماح" }, 50), "ضمن فترة السماح");
  assert.equal(displayGrade({ score: null, status: "درجة" }, 50), "بانتظار التصحيح");
  assert.equal(displayGrade({ score: null, status: "" }, 50), "بانتظار التصحيح");
});

function boundary(s) {
  s.exam("old", { name: "Earlier exam", date: d(-4) }); s.grade("old", { score: 32, createdAt: d(10) });
  s.exam("cause", { name: "Dismissal exam", date: CUTOFF }); s.grade("cause", { score: 10 });
  s.exam("new", { name: "Later exam", date: d(3) }); s.grade("new", { score: 45 });
  s.logs.push({ id: "dismissal", studentId: "student", examId: "cause", action: "فصل تلقائي", amount: 0, reason: `تلقائي: ${REASON}`, date: d(2), settledGradeIds: null, reversalOfLogId: null });
}
const dismissed = { id: "student", status: "مفصول", dismissalReason: REASON };

test("active student sees all recent grades newest first", async () => {
  const s = store(); boundary(s);
  const result = await listRecentGrades(s.client, { ...dismissed, status: "نشط" });
  assert.equal(result.unavailable, false);
  assert.deepEqual(result.grades.map((g) => g.examName), ["Later exam", "Dismissal exam", "Earlier exam"]);
  assert.deepEqual(result.grades.map((g) => g.display), ["45 / 50", "10 / 50", "32 / 50"]);
  assert.equal(result.grades[0].examDate.getTime(), d(3).getTime());
});

test("dismissed student: hidden newer rows do not consume the limit", async () => {
  const s = store(); boundary(s);
  for (let i = 0; i < 12; i += 1) { s.exam(`extra-${i}`, { date: d(i + 5) }); s.grade(`extra-${i}`, { score: 40 }); }
  const result = await listRecentGrades(s.client, dismissed);
  assert.equal(result.unavailable, false);
  assert.deepEqual(result.grades.map((g) => g.examName), ["Earlier exam"]);
});

test("dismissed student without evidence gets unavailable, not a crash", async () => {
  const s = store();
  s.exam("low", { date: CUTOFF }); s.grade("low", { score: 0 });
  const result = await listRecentGrades(s.client, dismissed);
  assert.deepEqual(result, { grades: null, unavailable: true });
});

test("status with surrounding spaces still counts as dismissed", async () => {
  const s = store(); boundary(s);
  const result = await listRecentGrades(s.client, { ...dismissed, status: " مفصول " });
  assert.deepEqual(result.grades.map((g) => g.examName), ["Earlier exam"]);
});
