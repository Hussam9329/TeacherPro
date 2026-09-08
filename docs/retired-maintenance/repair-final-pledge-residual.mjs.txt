/**
 * One-shot residual repair — completes repair-final-pledge-two-opportunities.
 *
 * After the main repair, the engine recalculation exposed two leftover sources
 * that still pushed pledged students away from فرصتان:
 *
 *  1. Grades marked «أثر أكاديمي فعّال بعد التسوية:» (set by the one-time
 *     academic-repair flow to keep specific July absences effective ACROSS the
 *     2026-08-14 chapter settlement). The 2026-08-30 pledge settlement is newer
 *     and explicitly ignores all exam effects dated before it, so for PLEDGED
 *     students only, the marker prefix is stripped from pre-pledge grades; the
 *     underlying note is preserved and the grade returns to the normal
 *     settlement-skip path. Non-pledged students keep their markers untouched.
 *
 *  2. Post-pledge manual workarounds (إضافة/خصم with reasons like «تعهد»،
 *     «تم التعهد لفاينل الفصل الاول»، «خطا»، «18 تموز») recorded on 2026-09-02
 *     while the root was broken. They were manual attempts to reach the pledged
 *     balance and would double-count on top of the fixed root, so they are
 *     merged into the same pledge reset (إعادة تعيين = 2).
 *
 * Then every pledged student is recalculated through the production engine, so
 * the persisted balance equals any future recalculation — all at فرصتان.
 *
 * Idempotency: fixed AuditLog id; re-running aborts at the guard.
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

const { recalculateStudentsAcademicState } = require(
  path.join(root, "src/lib/academic-recalculate-server.ts"),
);

const AUDIT_LOG_ID = "repair_final_pledge_residual_20260903";
const PLEDGE_REASON_PREFIX =
  "تسوية تاريخية: تعهد الطالب للامتحان الفاينل الفصل الأول";
const MANUAL_WORKAROUND_REASON = `${PLEDGE_REASON_PREFIX} — تسوية يدوية لاحقة للتعهد؛ الرصيد فرصتان مع تجاهل الامتحانات السابقة للتعهد`;
const EFFECTIVE_MARKER_PREFIX = "أثر أكاديمي فعّال بعد التسوية:";
// الامتحانات التي تعهد المعاهدون بتجاهل آثارها (ما قبل 31/8 حصراً).
const PRE_PLEDGE_EXAM_END = new Date("2026-08-31T00:00:00.000Z");

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

console.log("=== RESIDUAL REPAIR: تسوية متبقيات تعهد الفاينل 30/8 ===\n");

try {
  const existing = await db.auditLog.findUnique({
    where: { id: AUDIT_LOG_ID },
    select: { id: true, time: true },
  });
  if (existing) {
    throw new Error(`Repair already ran at ${existing.time}. Aborting.`);
  }

  const result = await db.$transaction(
    async (tx) => {
      const pledgeLogs = await tx.opportunityLog.findMany({
        where: { reason: { startsWith: PLEDGE_REASON_PREFIX } },
        select: { studentId: true, date: true },
      });
      const pledgeDateByStudent = new Map();
      for (const log of pledgeLogs) {
        const known = pledgeDateByStudent.get(log.studentId);
        if (!known || log.date > known) pledgeDateByStudent.set(log.studentId, log.date);
      }
      const studentIds = [...pledgeDateByStudent.keys()];
      if (!studentIds.length) throw new Error("No pledged students found.");

      // 1) دمج الترقيعات اليدوية اللاحقة للتعهد.
      const candidates = await tx.opportunityLog.findMany({
        where: {
          studentId: { in: studentIds },
          action: { in: ["إضافة", "خصم"] },
        },
        select: { id: true, studentId: true, reason: true, date: true },
      });
      const isWorkaround = (log) => {
        if (log.date <= (pledgeDateByStudent.get(log.studentId) || new Date(0))) return false;
        const reason = String(log.reason || "").trim();
        return reason.includes("تعهد") || reason === "خطا" || reason === "18 تموز";
      };
      let mergedLogs = 0;
      for (const log of candidates.filter(isWorkaround)) {
        await tx.opportunityLog.update({
          where: { id: log.id },
          data: {
            action: "إعادة تعيين",
            amount: 2,
            reason: MANUAL_WORKAROUND_REASON,
          },
        });
        mergedLogs += 1;
      }

      // 2) إزالة علامة «أثر فعّال بعد التسوية» عن درجات المعاهدين لامتحانات
      //    ما قبل التعهد فقط — التعهد أحدث من العلامة ويتجاهلها صراحةً.
      const markedGrades = await tx.grade.findMany({
        where: {
          studentId: { in: studentIds },
          notes: { startsWith: EFFECTIVE_MARKER_PREFIX },
        },
        select: { id: true, studentId: true, notes: true, examId: true },
      });
      const examDates = new Map(
        (await tx.exam.findMany({
          where: { id: { in: markedGrades.map((g) => g.examId) } },
          select: { id: true, date: true },
        })).map((e) => [e.id, e.date]),
      );
      let strippedMarkers = 0;
      for (const grade of markedGrades) {
        const examDate = examDates.get(grade.examId);
        if (!examDate || examDate >= PRE_PLEDGE_EXAM_END) continue;
        const rest = String(grade.notes || "")
          .slice(EFFECTIVE_MARKER_PREFIX.length)
          .trim();
        await tx.grade.update({
          where: { id: grade.id },
          data: { notes: rest },
        });
        strippedMarkers += 1;
      }

      await tx.student.updateMany({
        where: { id: { in: studentIds } },
        data: { opportunities: 2 },
      });

      await tx.auditLog.create({
        data: {
          id: AUDIT_LOG_ID,
          module: "إدارة الفرص",
          action: "تسوية متبقيات تعهد الفاينل — دمج الترقيعات وإزالة علامات ما قبل التعهد",
          details: JSON.stringify({
            students: studentIds.length,
            manualWorkaroundsMerged: mergedLogs,
            effectiveMarkersStripped: strippedMarkers,
          }),
          userName: "repair-final-pledge-residual",
        },
      });

      return { studentIds, mergedLogs, strippedMarkers };
    },
    { timeout: 120_000 },
  );

  console.log(
    `خطوة 1: ${result.mergedLogs} ترقيع يدوي دُمج، ${result.strippedMarkers} علامة (فعّال بعد التسوية) أُزيلت عن درجات المعاهدين قبل التعهد.`,
  );

  console.log("خطوة 2 (إعادة الاحتساب بالمحرك)...");
  await recalculateStudentsAcademicState(result.studentIds);

  const after = await db.student.findMany({
    where: { id: { in: result.studentIds } },
    select: { name: true, code: true, opportunities: true, status: true },
  });
  const dist = {};
  after.forEach((s) => { dist[s.opportunities] = (dist[s.opportunities] || 0) + 1; });
  console.log("\nالتوزيع النهائي للمعاهدين:", JSON.stringify(dist));

  const notTwo = after.filter((s) => s.opportunities !== 2);
  if (notTwo.length) {
    console.log(`\n⚠️ ${notTwo.length} ليس على فرصتين:`);
    notTwo.slice(0, 15).forEach((s) => console.log(`  ${s.name} (${s.code}) | ${s.opportunities} | ${s.status}`));
  } else {
    console.log("\n✅ كل المعاهدين على فرصتين.");
  }
} catch (error) {
  console.error("\nREPAIR FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
