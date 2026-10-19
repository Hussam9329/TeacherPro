#!/usr/bin/env node
// The exam-window push: which exams are due, who receives, the Baghdad text,
// and idempotency through the unique examId of the log.
import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

import { examCourseIds, pushDueExamWindows } from "../src/lib/student-app/push-exam-window.ts";

const NOW = new Date("2026-10-17T10:00:00Z");
const m = (minutes) => new Date(NOW.getTime() + minutes * 60000);

function store() {
  const s = {
    exams: [],
    students: [
      { id: "s1", courseId: "c1", status: "نشط" },
      { id: "s2", courseId: "c1", status: "مفصول" },
      { id: "s3", courseId: "c2", status: "نشط" },
      { id: "s4", courseId: "c3", status: "نشط" },
    ],
    devices: [
      { id: "d1", studentId: "s1", platform: "ios", pushToken: "ios-1", revokedAt: null },
      { id: "d2", studentId: "s2", platform: "ios", pushToken: "ios-2", revokedAt: null },
      { id: "d3", studentId: "s3", platform: "android", pushToken: "fcm-3", revokedAt: null },
      { id: "d4", studentId: "s4", platform: "ios", pushToken: "ios-4", revokedAt: null },
    ],
    logs: [],
  };
  const studentMatches = (st, where) => !where.status.notIn.includes(st.status) && (!where.courseId || where.courseId.in.includes(st.courseId));
  s.client = {
    exam: { findMany: async ({ where }) => s.exams.filter((e) => e.active === where.active && e.telegramOpenAt && e.telegramOpenAt <= where.telegramOpenAt.lte && e.telegramOpenAt >= where.telegramOpenAt.gte && e.telegramCloseAt > where.telegramCloseAt.gt) },
    course: { findMany: async ({ where }) => where.id.in.map((id) => ({ id, name: `course ${id}` })) },
    student: { count: async ({ where }) => s.students.filter((st) => studentMatches(st, where)).length },
    studentDevice: {
      findMany: async ({ where }) => s.devices.filter((d) => d.revokedAt === null && d.pushToken && studentMatches(s.students.find((st) => st.id === d.studentId), where.student)).map(({ id, platform, pushToken, studentId }) => ({ id, platform, pushToken, studentId })),
      updateMany: async ({ where, data }) => { s.devices.filter((d) => where.id.in.includes(d.id)).forEach((d) => Object.assign(d, data)); },
    },
    studentPushLog: {
      create: async ({ data }) => {
        if (data.examId && s.logs.some((l) => l.examId === data.examId)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" });
        const row = { id: `log-${s.logs.length + 1}`, sent: 0, failed: 0, ...data };
        s.logs.push(row);
        return row;
      },
      update: async ({ where, data }) => { Object.assign(s.logs.find((l) => l.id === where.id), data); },
    },
  };
  s.exam = (id, extra) => s.exams.push({ id, name: id, active: true, courseIds: "[]", telegramOpenAt: null, telegramCloseAt: null, examCourses: [], ...extra });
  return s;
}

const fakeSender = (dead = []) => ({ sent: [], send: async function (tokens) { this.sent.push(...tokens); return tokens.map((token) => ({ token, ok: !dead.includes(token), unregistered: dead.includes(token) })); } });

test("examCourseIds: ExamCourse rows win, the JSON column is the fallback", () => {
  assert.deepEqual(examCourseIds({ courseIds: '["x"]', examCourses: [{ courseId: "a", course: { name: "" } }, { courseId: "a", course: { name: "" } }] }), ["a"]);
  assert.deepEqual(examCourseIds({ courseIds: '["x", "", 3]', examCourses: [] }), ["x"]);
  assert.deepEqual(examCourseIds({ courseIds: "not json", examCourses: [] }), []);
});

test("only exams whose window opened within the look-back and is still open are due", async () => {
  const s = store();
  s.exam("due", { telegramOpenAt: m(-2), telegramCloseAt: m(300), examCourses: [{ courseId: "c1", course: { name: "أحياء" } }] });
  s.exam("future", { telegramOpenAt: m(5), telegramCloseAt: m(300), examCourses: [{ courseId: "c1", course: { name: "أحياء" } }] });
  s.exam("old", { telegramOpenAt: m(-60), telegramCloseAt: m(300), examCourses: [{ courseId: "c1", course: { name: "أحياء" } }] });
  s.exam("closed", { telegramOpenAt: m(-3), telegramCloseAt: m(-1), examCourses: [{ courseId: "c1", course: { name: "أحياء" } }] });
  s.exam("inactive", { active: false, telegramOpenAt: m(-3), telegramCloseAt: m(300), examCourses: [{ courseId: "c1", course: { name: "أحياء" } }] });
  const apns = fakeSender(), fcm = fakeSender();
  const result = await pushDueExamWindows({ client: s.client, senders: { apns, fcm }, now: NOW });
  assert.equal(result.scanned, 1);
  assert.deepEqual(result.notified.map((n) => n.examId), ["due"]);
  assert.deepEqual(s.logs.map((l) => l.examId), ["due"]);
});

test("active students of the exam's courses receive it; dismissed and other courses do not", async () => {
  const s = store();
  s.exam("e1", { name: "الامتحان الثالث", telegramOpenAt: m(0), telegramCloseAt: new Date("2026-10-17T15:00:00Z"), examCourses: [{ courseId: "c1", course: { name: "أحياء" } }, { courseId: "c2", course: { name: "كيمياء" } }] });
  const apns = fakeSender(), fcm = fakeSender();
  const result = await pushDueExamWindows({ client: s.client, senders: { apns, fcm }, now: NOW });
  assert.deepEqual(apns.sent, ["ios-1"]);
  assert.deepEqual(fcm.sent, ["fcm-3"]);
  assert.deepEqual(result.notified, [{ examId: "e1", name: "الامتحان الثالث", students: 2, devices: 2, sent: 2, failed: 0 }]);
  const log = s.logs[0];
  assert.equal(log.kind, "exam-window");
  assert.equal(log.target, "exam");
  assert.equal(log.courseName, "أحياء، كيمياء");
  assert.equal(log.courseId, null);
  assert.equal(log.title, "فتحت نافذة امتحان «الامتحان الثالث»");
  assert.equal(log.body, "يمكنك الإرسال الآن عبر @hfexam_bot. تغلق النافذة الساعة 6:00 م اليوم.");
  assert.equal(log.recipients, 2);
  assert.equal(log.sent, 2);
  assert.equal(log.userName, "TeacherPro Server");
});

test("a second run (or an overlapping one) skips an exam already claimed", async () => {
  const s = store();
  s.exam("e1", { telegramOpenAt: m(0), telegramCloseAt: m(60), examCourses: [{ courseId: "c1", course: { name: "أحياء" } }] });
  const apns = fakeSender(), fcm = fakeSender();
  await pushDueExamWindows({ client: s.client, senders: { apns, fcm }, now: NOW });
  const again = await pushDueExamWindows({ client: s.client, senders: { apns, fcm }, now: m(1) });
  assert.deepEqual(again.notified, []);
  assert.deepEqual(again.skipped, ["e1"]);
  assert.deepEqual(apns.sent, ["ios-1"], "sent once");
  assert.equal(s.logs.length, 1);
});

test("a dead token is cleared and counted as failed; the legacy JSON courses still resolve names", async () => {
  const s = store();
  s.exam("e1", { telegramOpenAt: m(0), telegramCloseAt: m(60), courseIds: '["c3"]' });
  const apns = fakeSender(["ios-4"]), fcm = fakeSender();
  const result = await pushDueExamWindows({ client: s.client, senders: { apns, fcm }, now: NOW });
  assert.deepEqual(result.notified[0], { examId: "e1", name: "e1", students: 1, devices: 1, sent: 0, failed: 1 });
  assert.equal(s.devices.find((d) => d.id === "d4").pushToken, null);
  assert.equal(s.logs[0].courseName, "course c3");
  assert.equal(s.logs[0].courseId, "c3");
});

test("an exam without courses is claimed with nobody to reach, so it is not retried every minute", async () => {
  const s = store();
  s.exam("lonely", { telegramOpenAt: m(0), telegramCloseAt: m(60) });
  const result = await pushDueExamWindows({ client: s.client, senders: { apns: fakeSender(), fcm: fakeSender() }, now: NOW });
  assert.deepEqual(result.notified, [{ examId: "lonely", name: "lonely", students: 0, devices: 0, sent: 0, failed: 0 }]);
});
