/**
 * One-shot data completion — registers the missing grade rows for the exam
 * "الفصل الثاني - الامتحان الاول (ص1)" (2026-08-13).
 *
 * ROOT CAUSE (رقيه سمير هاشم issue): the bulk status-registration flow was
 * run for chapter-2 exams 2..6 but NEVER for exam 1. ~228 students have no
 * Grade row, so the exam never appears in their student file.
 *
 * Replicates /api/grades/mark-missing-absent, but processes students in
 * small batches (each its own serializable transaction) to keep every
 * transaction short — mirroring how the teacher runs the flow per batch.
 *
 * SAFETY: every target is shielded by a historical settlement (تسوية تاريخية
 * 08-14 transition / 08-30 pledge) or a reactivation-balance log, and the
 * exam date (08-13) is on/before those boundaries → the engine ignores the
 * new absence rows: zero penalties, zero dismissals. The rows exist purely
 * so the exam shows up in each student's file.
 *
 * Idempotency: fixed AuditLog id.
 */
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const ts = require("typescript");
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

const { syncAcademicGradeWriteback, AcademicGradeWritebackError } = require(
  path.join(root, "src/lib/academic-grade-writeback-server.ts"),
);
const { recalculateStudentsAcademicState } = require(
  path.join(root, "src/lib/academic-recalculate-server.ts"),
);
const { isExamWithinStudentGraceWindow } = require(
  path.join(root, "src/lib/student-grace.ts"),
);
const { isExamOnOrAfterStudentRegistration, studentMatchesExamMainSites, splitSelection } = require(
  path.join(root, "src/lib/exam-utils.ts"),
);

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const AUDIT_LOG_ID = "repair_bulk_register_exam1_ch2_20260904";
const BATCH_SIZE = 25;

console.log(`=== REPAIR: bulk-register missing rows for exam 1 chapter-2 (batched) ===\n`);

function parseCourseIds(value) {
  const text = String(value || "");
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const existing = await db.auditLog.findUnique({
    where: { id: AUDIT_LOG_ID },
    select: { id: true, time: true },
  });
  if (existing) throw new Error(`Repair already ran at ${existing.time}. Aborting.`);

  const exam = await db.exam.findFirst({
    where: { name: { contains: "الامتحان الاول" }, AND: [{ name: { contains: "(ص1)" } }] },
  });
  if (!exam) throw new Error("Exam not found.");
  console.log(`Exam: "${exam.name}" (${exam.id}) date=${exam.date.toISOString().slice(0, 10)}`);

  const linkedCourseIds = parseCourseIds(exam.courseIds);
  const activeLinks = await db.courseChapter.findMany({
    where: { courseId: { in: linkedCourseIds }, active: true, archived: false },
    select: { courseId: true },
  });
  const activeCourseIds = new Set(activeLinks.map((l) => l.courseId));
  const selectedMainSites = splitSelection(exam.mainSite);

  const students = await db.student.findMany({
    where: { courseId: { in: linkedCourseIds }, status: { not: "مؤرشف" } },
  });
  const existingGrades = await db.grade.findMany({
    where: { examId: exam.id },
    select: { studentId: true },
  });
  const hasGrade = new Set(existingGrades.map((g) => g.studentId));
  const leaves = await db.studentLeave.findMany({
    where: { OR: [{ examId: exam.id }, { leaveType: "period" }] },
    select: { studentId: true, leaveType: true, examId: true, dateFrom: true, dateTo: true },
  });
  const leaveByStudent = new Map();
  for (const l of leaves) leaveByStudent.set(l.studentId, l);

  const targets = [];
  for (const s of students) {
    if (hasGrade.has(s.id)) continue;
    if (!activeCourseIds.has(s.courseId)) continue;
    if (!studentMatchesExamMainSites(s, selectedMainSites)) continue;
    if (s.status === "مفصول") continue;
    const l = leaveByStudent.get(s.id);
    if (l) {
      if (l.leaveType === "exam" && l.examId === exam.id) continue;
      if (l.leaveType === "period" && l.dateFrom && l.dateTo && exam.date >= l.dateFrom && exam.date <= l.dateTo) continue;
    }
    targets.push(s);
  }
  console.log(`Targets: ${targets.length}`);

  const planned = targets.map((s) => {
    const registered = isExamOnOrAfterStudentRegistration(s, exam);
    const withinGrace = registered && isExamWithinStudentGraceWindow(s, exam);
    const status = !registered ? "قبل تسجيل الطالب" : withinGrace ? "ضمن فترة السماح" : "غائب";
    return { student: s, status };
  });
  const statusDist = {};
  planned.forEach((p) => { statusDist[p.status] = (statusDist[p.status] || 0) + 1; });
  console.log(`Planned statuses: ${JSON.stringify(statusDist)}`);

  const allCreated = [];
  const allFailed = [];
  const allDismissedAfter = [];

  for (let i = 0; i < planned.length; i += BATCH_SIZE) {
    const batch = planned.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const total = Math.ceil(planned.length / BATCH_SIZE);
    const t0 = Date.now();
    try {
      const batchResult = await db.$transaction(
        async (tx) => {
          const created = [];
          const failures = [];
          for (const p of batch) {
            try {
              const existingRow = await tx.grade.findUnique({
                where: { studentId_examId: { studentId: p.student.id, examId: exam.id } },
              });
              if (existingRow) continue;
              const writeback = await syncAcademicGradeWriteback({
                tx,
                studentId: p.student.id,
                examId: exam.id,
                status: p.status,
                score: null,
                notes: p.status === "قبل تسجيل الطالب"
                  ? "تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب"
                  : p.status === "ضمن فترة السماح"
                    ? "تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان"
                    : "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم",
                sourceLabel: "تسجيل الحالات الجماعي",
                allowBlankGrade: false,
                blockOnLeave: true,
                enforceExamAvailability: true,
                deferAcademicRecalculation: true,
              });
              if (!writeback) throw new AcademicGradeWritebackError("تعذر إنشاء سجل حالة الطالب.");
              created.push(p.student.id);
            } catch (error) {
              if (error instanceof AcademicGradeWritebackError) {
                failures.push({ studentId: p.student.id, code: p.student.code, error: error.message });
                continue;
              }
              throw error;
            }
          }
          const recalc = created.length
            ? await recalculateStudentsAcademicState(created, { tx })
            : null;
          return { created, failures, recalc };
        },
        { timeout: 240_000, isolationLevel: "Serializable" },
      );
      allCreated.push(...batchResult.created);
      allFailed.push(...batchResult.failures);
      const dismissed = (batchResult.recalc?.students || []).filter((s) => s.status === "مفصول");
      allDismissedAfter.push(...dismissed);
      const balances = (batchResult.recalc?.students || []).map((s) => `${s.code || s.id.slice(-6)}:${s.status}/${s.opportunities}`);
      console.log(`  batch ${batchNum}/${total}: created=${batchResult.created.length} failed=${batchResult.failures.length} dismissed=${dismissed.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      if (batchResult.failures.length) {
        batchResult.failures.slice(0, 5).forEach(f => console.log(`     FAIL [${f.code}]: ${f.error.slice(0, 80)}`));
      }
    } catch (error) {
      console.error(`  batch ${batchNum}/${total} TRANSACTION FAILED: ${String(error.message || error).slice(0, 200)}`);
      throw error;
    }
  }

  console.log(`\nTotal created: ${allCreated.length}, failed: ${allFailed.length}`);
  console.log(`Dismissed after recalculation: ${allDismissedAfter.length} (must be 0 — all shielded)`);
  if (allDismissedAfter.length) {
    allDismissedAfter.slice(0, 10).forEach(s => console.log(`   STILL DISMISSED: ${s.code || s.id} ${s.opportunities}`));
  }

  await db.auditLog.create({
    data: {
      id: AUDIT_LOG_ID,
      module: "الدرجات",
      action: "تسجيل الحالات الجماعي لغير المدخلين — استكمال الامتحان الأول للفصل الثاني (ص1)",
      details: JSON.stringify({
        examId: exam.id,
        examName: exam.name,
        requested: planned.length,
        created: allCreated.length,
        failed: allFailed.length,
        plannedStatusDist: statusDist,
        dismissedAfterRecalculation: allDismissedAfter.length,
        executedAt: new Date().toISOString(),
      }),
      userName: "TeacherPro repair — exam1 chapter-2 bulk registration",
    },
  });
  console.log("\n=== DONE ===");
}

main().catch((error) => {
  console.error("\nREPAIR FAILED:", error.message);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
