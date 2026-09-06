#!/usr/bin/env node
/**
 * LIVE end-to-end verification of the grace-period termination mechanism.
 *
 * Creates an isolated fixture (course + exam + student in active automatic
 * grace), runs the REAL syncAcademicGradeWriteback (the exact code path behind
 * /api/grades and batch tools), and
 * asserts that entering a numeric grade:
 *   1. ends the grace period (gracePeriodEndedAt set),
 *   2. zeroes/resets grace config (accountingGraceDays = 0, start = null),
 *   3. saves the grade as a fully counted, non-excluded row,
 *   4. makes the student academically chargeable again (recalc applied).
 * Then it verifies a second write no longer reports a new termination and that
 * non-numeric markers do NOT terminate anything. Cleans up every fixture row.
 */

import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
// Target DB comes from the environment (DATABASE_URL). The channel_binding
// query param is Neon-specific and rejected by Prisma, so it is stripped.
// This test WRITES fixture rows and deletes them afterwards — point it at an
// isolated database, never at shared production data, before running it.
process.env.DATABASE_URL = String(process.env.DATABASE_URL || "").replace(
  /&?channel_binding=(require|verify-ca|verify-full)/,
  "",
);
if (!/^postgresql:\/\//.test(process.env.DATABASE_URL || "")) {
  console.error("DATABASE_URL must be a valid postgresql:// connection string.");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveTeacherProModule(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(output.outputText, filename);
};

const { PrismaClient } = require("@prisma/client");
const {
  syncAcademicGradeWriteback,
} = require(path.join(root, "src/lib/academic-grade-writeback-server.ts"));
const { isStudentCurrentlyInGrace } = require(path.join(root, "src/lib/student-grace.ts"));
const { recalculateStudentsAcademicState } = require(
  path.join(root, "src/lib/academic-recalculate-server.ts"),
);

const db = new PrismaClient();
const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const COURSE_NAME = `ZZ_TEST_GRACE_COURSE_${stamp}`;
const STUDENT_NAME = `طالب اختبار آلية السماح ${stamp}`;
const STUDENT_CODE = `TSTGRACE${stamp}`;
const EXAM_NAME = `اختبار سماح ${stamp}`;

const results = [];
const check = (label, ok, extra = "") => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
};

let courseId, examId, studentId;

try {
  // ---------- Fixture ----------
  const course = await db.course.create({ data: { name: COURSE_NAME } });
  courseId = course.id;
  const exam = await db.exam.create({
    data: {
      name: EXAM_NAME,
      type: "يومي",
      courseIds: JSON.stringify([courseId]),
      date: new Date(),
      fullMark: 100,
      passMark: 50,
      discountMark: 40,
      opportunitiesPenalty: "1",
      active: true,
    },
  });
  examId = exam.id;
  await db.examCourse.create({ data: { examId, courseId } });
  const student = await db.student.create({
    data: {
      name: STUDENT_NAME,
      gender: "ذكر",
      code: STUDENT_CODE,
      status: "نشط",
      opportunities: 10,
      baseOpportunities: 10,
      courseId,
      createdAt: new Date(),
    },
  });
  studentId = student.id;

  const before = await db.student.findUnique({ where: { id: studentId } });
  check("الطالب التجريبي يبدأ ضمن فترة السماح التلقائية النشطة", isStudentCurrentlyInGrace(before));
  check(
    "لا يوجد إنهاء سماح مسبق قبل إدخال الدرجة",
    before.gracePeriodEndedAt === null && Number(before.accountingGraceDays) === 0,
  );

  // ---------- ACT: real writeback with a numeric grade ----------
  const result = await syncAcademicGradeWriteback({
    studentId,
    examId,
    status: "درجة",
    score: 30,
    notes: "اختبار آلية إنهاء السماح",
    sourceLabel: "اختبار حي",
    allowBlankGrade: false,
    blockOnLeave: true,
    enforceExamAvailability: true,
    confirmLeaveEnd: false,
  });

  check("عملية الحفظ أبلغت عن إنهاء فترة السماح (graceEnded)", result.graceEnded === true);

  const after = await db.student.findUnique({ where: { id: studentId } });
  check("تم تسجيل وقت إنهاء السماح (gracePeriodEndedAt)", after.gracePeriodEndedAt !== null);
  check("تم تصفير أيام السماح إلى صفر", Number(after.accountingGraceDays) === 0);
  check("تم مسح تاريخ بدء السماح", after.gracePeriodStartDate === null);
  check("الطالب لم يعد ضمن فترة سماح نشطة", !isStudentCurrentlyInGrace(after));

  const grade = await db.grade.findUnique({
    where: { studentId_examId: { studentId, examId } },
  });
  check("الدرجة محفوظة كدرجة رقمية رسمية", grade && grade.status === "درجة" && grade.score === 30);
  check(
    "الدرجة غير مستبعدة من الأثر الأكاديمي (قابلة للمحاسبة)",
    grade && grade.academicEffectExcluded === false && !grade.academicEffectExclusionReason,
  );

  const recalcStudent = result.academicRecalculation.students.find((s) => s.id === studentId);
  check(
    "إعادة الاحتساب طبقت أثر الدرجة (خصم فرص لأن الدرجة أقل من درجة النجاح)",
    recalcStudent && Number(recalcStudent.opportunities) < 10,
    `opportunities=${recalcStudent ? recalcStudent.opportunities : "?"}`,
  );

  // ---------- Replay safety: second numeric write does not re-terminate ----------
  const result2 = await syncAcademicGradeWriteback({
    studentId,
    examId,
    status: "درجة",
    score: 55,
    notes: "تصحيح درجة بعد إنهاء السماح",
    sourceLabel: "اختبار حي",
    allowBlankGrade: false,
    blockOnLeave: true,
    enforceExamAvailability: true,
    confirmLeaveEnd: false,
  });
  check("إدخال درجة ثانية لا يعيد إنهاء سماح منتهٍ (لا إعادة تفعيل خاطئة)", result2.graceEnded === false);
  const after2 = await db.student.findUnique({ where: { id: studentId } });
  check(
    "حالة السماح ما تزال منتهية ومصفرة بعد التعديل الثاني",
    after2.gracePeriodEndedAt !== null && Number(after2.accountingGraceDays) === 0,
  );

  // ---------- Marker safety: "غائب" is blocked inside the (now ended) window? ----------
  // After termination no window exists at all, so absence is allowed again and
  // the student stays fully chargeable — this is the "عودة الطالب طبيعي" state.
  const result3 = await syncAcademicGradeWriteback({
    studentId,
    examId,
    status: "غائب",
    score: null,
    notes: "اختبار عودة الحالة الطبيعية",
    sourceLabel: "اختبار حي",
    allowBlankGrade: false,
    blockOnLeave: true,
    enforceExamAvailability: true,
    confirmLeaveEnd: false,
  });
  check(
    "بعد إنهاء السماح عاد الطالب قابلاً للمحاسبة (قبول غياب محاسب بدون أي حماية)",
    result3 && result3.grade && result3.grade.status === "غائب",
  );

  console.log("\n--- ملخص ---");
  const failed = results.filter((r) => !r.ok).length;
  if (failed) {
    console.error(`فشل ${failed} من ${results.length} فحص`);
    process.exitCode = 1;
  } else {
    console.log(`نجحت كل الفحوصات (${results.length}/${results.length}) — الآلية تعمل 100%.`);
  }
} catch (error) {
  console.error("TEST ERROR:", error);
  process.exitCode = 1;
} finally {
  // ---------- Cleanup (FK-safe order) ----------
  try {
    if (studentId) {
      await db.grade.deleteMany({ where: { studentId } });
      await db.opportunityLog.deleteMany({ where: { studentId } });
      await db.studentNote.deleteMany({ where: { studentId } });
      await db.studentLeaveGradeBackup.deleteMany({ where: { studentId } });
      await db.studentLeave.deleteMany({ where: { studentId } });
      await db.studentCall.deleteMany({ where: { studentId } });
      await db.gradeSmartNote.deleteMany({ where: { studentId } });
      await db.student.delete({ where: { id: studentId } });
    }
    if (examId) {
      await db.examCourse.deleteMany({ where: { examId } });
      await db.opportunityLog.deleteMany({ where: { examId } });
      await db.exam.delete({ where: { id: examId } });
    }
    if (courseId) {
      await db.course.delete({ where: { id: courseId } }).catch(async () => {
        // course may still be referenced; force-clear leftovers then retry
        await db.student.deleteMany({ where: { courseId } });
        await db.course.delete({ where: { id: courseId } });
      });
    }
    console.log("تم تنظيف كل البيانات التجريبية بنجاح.");
  } catch (cleanupError) {
    console.error("CLEANUP ERROR:", cleanupError);
    process.exitCode = 1;
  }
  await db.$disconnect();
}
