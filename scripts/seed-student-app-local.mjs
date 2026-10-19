#!/usr/bin/env node
// Local-only sample data for the student mobile app. Refuses any database
// that is not on this machine. Safe to re-run: every row is keyed by a fixed id.
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL || "";
const host = url.replace(/^.*@/, "").split("/")[0].split(":")[0];
if (!["127.0.0.1", "localhost"].includes(host)) {
  console.error(`refusing: DATABASE_URL host is "${host}", not localhost`);
  process.exit(1);
}
const db = new PrismaClient();
const now = new Date();
const hours = (h) => new Date(now.getTime() + h * 3600000);
const days = (d) => new Date(now.getTime() + d * 86400000);

async function main() {
  const course = await db.course.upsert({ where: { id: "seed-course" }, update: {}, create: { id: "seed-course", name: "أحياء سادس", availablePrograms: '["منهج كامل"]', availableStudyTypes: '["إلكتروني"]' } });
  const chapter = await db.chapter.upsert({ where: { id: "seed-chapter" }, update: {}, create: { id: "seed-chapter", name: "الفصل الأول", opportunities: 3 } });
  await db.courseChapter.upsert({ where: { id: "seed-link" }, update: { active: true, archived: false }, create: { id: "seed-link", courseId: course.id, chapterId: chapter.id, active: true } });

  const students = [
    { id: "seed-active", name: "طالب تجريبي", code: "HF1001", phone: "07701234567", phoneKey: "07701234567", parentPhone: "07709999999", opportunities: 2, status: "نشط" },
    { id: "seed-sib-a", name: "علي الأخ", code: "HF1002", phone: null, phoneKey: null, parentPhone: "07809876543", opportunities: 3, status: "نشط" },
    { id: "seed-sib-b", name: "سارة الأخت", code: "HF1003", phone: null, phoneKey: null, parentPhone: "07809876543", opportunities: 3, status: "نشط" },
    { id: "seed-dismissed", name: "طالب مفصول", code: "HF1004", phone: "07705555555", phoneKey: "07705555555", parentPhone: null, opportunities: 0, status: "مفصول", dismissalReason: "درجة فصل (10): الامتحان الثاني" },
  ];
  for (const s of students) {
    const { id, ...data } = s;
    await db.student.upsert({ where: { id }, update: data, create: { id, gender: "ذكر", courseId: course.id, studyType: "إلكتروني", mainSite: "بغداد", subSite: "الكرادة", nameKey: `seed:${id}`, ...data } });
  }

  const exams = [
    { id: "seed-exam-1", name: "الامتحان الأول", date: days(-14), telegramOpenAt: days(-14), telegramCloseAt: days(-13) },
    { id: "seed-exam-2", name: "الامتحان الثاني", date: days(-7), telegramOpenAt: days(-7), telegramCloseAt: days(-6) },
    { id: "seed-exam-open", name: "الامتحان الثالث", date: days(0), telegramOpenAt: hours(-1), telegramCloseAt: hours(5) },
    { id: "seed-exam-next", name: "الامتحان الرابع", date: days(1), telegramOpenAt: days(1), telegramCloseAt: hours(30) },
    { id: "seed-exam-nowindow", name: "امتحان بلا نافذة", date: days(2), telegramOpenAt: null, telegramCloseAt: null },
  ];
  for (const e of exams) {
    const { id, ...data } = e;
    await db.exam.upsert({ where: { id }, update: data, create: { id, type: "يومي", courseIds: JSON.stringify([course.id]), fullMark: 50, passMark: 25, discountMark: 20, opportunitiesPenalty: "1", dismissalGrade: 10, ...data } });
    await db.examCourse.upsert({ where: { examId_courseId: { examId: id, courseId: course.id } }, update: {}, create: { examId: id, courseId: course.id, chapterId: chapter.id } });
  }

  const grades = [
    { id: "seed-g-a1", studentId: "seed-active", examId: "seed-exam-1", status: "درجة", score: 42 },
    { id: "seed-g-a2", studentId: "seed-active", examId: "seed-exam-2", status: "غائب", score: null },
    { id: "seed-g-d1", studentId: "seed-dismissed", examId: "seed-exam-1", status: "درجة", score: 30 },
    { id: "seed-g-d2", studentId: "seed-dismissed", examId: "seed-exam-2", status: "درجة", score: 8 },
    { id: "seed-g-s1", studentId: "seed-sib-a", examId: "seed-exam-1", status: "درجة", score: 35 },
  ];
  for (const g of grades) {
    const { id, ...data } = g;
    await db.grade.upsert({ where: { id }, update: data, create: { id, ...data } });
  }

  const logs = [
    { id: "seed-log-a", studentId: "seed-active", examId: "seed-exam-2", chapterId: chapter.id, action: "خصم", amount: 1, appliedAmount: 1, balanceBefore: 3, balanceAfter: 2, reason: "غياب عن الامتحان الثاني", date: days(-6) },
    { id: "seed-log-d", studentId: "seed-dismissed", examId: "seed-exam-2", chapterId: chapter.id, action: "فصل تلقائي", amount: 0, balanceBefore: 0, balanceAfter: 0, reason: "تلقائي: درجة فصل (10): الامتحان الثاني", date: days(-6) },
  ];
  for (const l of logs) {
    const { id, ...data } = l;
    await db.opportunityLog.upsert({ where: { id }, update: data, create: { id, ...data } });
  }
  console.log("seeded:", { course: course.id, chapter: chapter.id, students: students.map((s) => `${s.code}`), exams: exams.map((e) => e.id) });
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(() => db.$disconnect());
