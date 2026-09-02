/**
 * One-shot DB repair — ROOT FIX for the 2026-08-30 final-exam pledge batch.
 *
 * Background: the batch created one OpportunityLog per pledged student with
 * action="إعادة تعيين", amount=2, reason="تعديل الفرص إلى فرصتين (2/3)
 * بسبب تعهد الطالب للامتحان الفاينل الفصل الأول [قبل: 3 → بعد: 2، فرق: -1]".
 * The academic engine replayed every "إعادة تعيين" log by resetting the
 * balance to the chapter ceiling (3), ignoring the stored amount — so any
 * later recalculation (grade edits, bulk absence marking) silently restored
 * opportunities to 3 for students without post-settlement deductions.
 *
 * The engine now honors the stored reset amount (see academic-engine.ts), and
 * this repair aligns the DATA with that fixed engine:
 *  1. Rewrites each 30/8 campaign log's reason to the canonical settlement
 *     form ("تسوية تاريخية: تعهد الطالب ... — تجاهل آثار الامتحانات السابقة
 *     للتعهد وبدء الرصيد بفرصتين [قبل: ... → بعد: 2، فرق: ...]") so the
 *     engine also treats the pledge date as a historical settlement boundary:
 *     exams on/before 30/8 no longer deduct from the pledged balance.
 *  2. Rewrites the same-day+ manual workaround logs (action "إضافة"/"خصم"
 *     with reason "تعهد") into the same pledge reset (2) — they were manual
 *     attempts to reach the pledged balance and would otherwise double-count
 *     on top of the fixed root.
 *  3. Recalculates every affected student through the real engine
 *     (recalculateStudentsAcademicState) so the persisted balance equals what
 *     any future recalculation produces — the definition of "fixed roots".
 *
 * Idempotency: the AuditLog uses a fixed unique id; re-running after success
 * aborts at the guard without modifying anything.
 */
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;

// نفس آلية اختبارات السلامة: تحميل مصادر TypeScript الفعلية مع اختصار @/
// حتى يعمل الإصلاح بنفس كود الإنتاج بالحرف (لا نسخ منطق).
Module._resolveFilename = function resolveTeacherProModule(
  request,
  parent,
  isMain,
  options,
) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  return originalResolveFilename.call(
    this,
    resolvedRequest,
    parent,
    isMain,
    options,
  );
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

const AUDIT_LOG_ID = "repair_final_pledge_two_opportunities_20260902";

const CAMPAIGN_REASON_PREFIX = "تعديل الفرص إلى فرصتين";
const CAMPAIGN_REASON_MARKER = "بسبب تعهد الطالب للامتحان الفاينل الفصل الأول";
const PLEDGE_SETTLEMENT_PREFIX =
  "تسوية تاريخية: تعهد الطالب للامتحان الفاينل الفصل الأول — تجاهل آثار الامتحانات السابقة للتعهد وبدء الرصيد بفرصتين";
const MANUAL_WORKAROUND_REASON =
  "تسوية تاريخية: تعهد الطالب للامتحان الفاينل الفصل الأول — تسوية يدوية لاحقة للتعهد؛ الرصيد فرصتان مع تجاهل الامتحانات السابقة للتعهد";

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

console.log("=== ROOT REPAIR: تعهد الفاينل 30/8 — فرصتان لا تعود 3 ===\n");

try {
  // 1) Idempotency guard.
  const existing = await db.auditLog.findUnique({
    where: { id: AUDIT_LOG_ID },
    select: { id: true, time: true },
  });
  if (existing) {
    throw new Error(
      `Repair already ran at ${existing.time}. Aborting to prevent duplicate execution.`,
    );
  }

  const result = await db.$transaction(
    async (tx) => {
      // 2) حملة 30/8 الأصلية.
      const campaignLogs = await tx.opportunityLog.findMany({
        where: {
          action: "إعادة تعيين",
          reason: {
            startsWith: CAMPAIGN_REASON_PREFIX,
            contains: CAMPAIGN_REASON_MARKER,
          },
        },
        select: { id: true, studentId: true, reason: true, date: true },
      });

      let rewrittenCampaign = 0;
      for (const log of campaignLogs) {
        const bracket = (log.reason || "").match(/\[قبل:[^\]]*\]\s*$/)?.[0]?.trim() || "";
        const nextReason = bracket
          ? `${PLEDGE_SETTLEMENT_PREFIX} ${bracket}`
          : PLEDGE_SETTLEMENT_PREFIX;
        await tx.opportunityLog.update({
          where: { id: log.id },
          data: { reason: nextReason },
        });
        rewrittenCampaign += 1;
      }

      const studentIds = [
        ...new Set(campaignLogs.map((log) => log.studentId).filter(Boolean)),
      ];
      if (studentIds.length === 0) {
        throw new Error("No pledge campaign logs found — nothing to repair.");
      }

      // 3) التسويات اليدوية اللاحقة (إضافة/خصم بسبب «تعهد») لنفس الطلبة:
      //    قصدُها الوصول لرصيد التعهد؛ بدون دمجها تُحسب مرتين بعد إصلاح الجذر.
      const campaignDateByStudent = new Map();
      for (const log of campaignLogs) {
        const known = campaignDateByStudent.get(log.studentId);
        if (!known || log.date > known) campaignDateByStudent.set(log.studentId, log.date);
      }
      const laterWorkarounds = await tx.opportunityLog.findMany({
        where: {
          studentId: { in: studentIds },
          action: { in: ["إضافة", "خصم"] },
          reason: "تعهد",
        },
        select: { id: true, studentId: true, date: true },
      });
      let rewrittenWorkarounds = 0;
      for (const log of laterWorkarounds) {
        const campaignDate = campaignDateByStudent.get(log.studentId);
        if (!campaignDate || log.date <= campaignDate) continue;
        await tx.opportunityLog.update({
          where: { id: log.id },
          data: {
            action: "إعادة تعيين",
            amount: 2,
            reason: MANUAL_WORKAROUND_REASON,
          },
        });
        rewrittenWorkarounds += 1;
      }

      // 4) تثبيت الرصيد على فرصتين (إعادة الاحتساب الفعلية تحسم القيمة
      //    النهائية بعد قليل — هذه الكتابة ضمان أولي متسق مع المحرك المصلح).
      const balanceUpdate = await tx.student.updateMany({
        where: { id: { in: studentIds } },
        data: { opportunities: 2 },
      });

      // 5) سجل تدقيق موحد يلخص الدفعة.
      await tx.auditLog.create({
        data: {
          id: AUDIT_LOG_ID,
          module: "إدارة الفرص",
          action: "إصلاح جذري لتعهد الفاينل 30/8 — فرصتان بلا عودة إلى 3",
          details: JSON.stringify({
            students: studentIds.length,
            campaignLogsRewritten: rewrittenCampaign,
            manualWorkaroundLogsMerged: rewrittenWorkarounds,
            balancesPinnedToTwo: balanceUpdate.count,
          }),
          userName: "repair-final-pledge",
        },
      });

      return { studentIds, rewrittenCampaign, rewrittenWorkarounds, balanceUpdate };
    },
    { timeout: 120_000 },
  );

  console.log(
    `خطوة 1 (البيانات): ${result.rewrittenCampaign} حركة حملة أُعيدت صياغتها، ` +
      `${result.rewrittenWorkarounds} تسوية يدوية دُمجت، ` +
      `${result.balanceUpdate.count} طالب ثُبّت رصيدهم على فرصتين.`,
  );

  // 6) إعادة الاحتساب الفعلية عبر محرك الإنتاج المُصلح — القيمة النهائية
  //    هنا هي نفسها التي ستحسبها أي عملية مستقبلية.
  console.log("خطوة 2 (إعادة الاحتساب بالمحرك)...");
  const before = await db.student.findMany({
    where: { id: { in: result.studentIds } },
    select: { id: true, opportunities: true },
  });
  const beforeDist = {};
  before.forEach((s) => {
    beforeDist[s.opportunities] = (beforeDist[s.opportunities] || 0) + 1;
  });

  const recalc = await recalculateStudentsAcademicState(result.studentIds);

  const after = await db.student.findMany({
    where: { id: { in: result.studentIds } },
    select: { id: true, name: true, opportunities: true, status: true },
  });
  const afterDist = {};
  after.forEach((s) => {
    afterDist[s.opportunities] = (afterDist[s.opportunities] || 0) + 1;
  });

  console.log("\nتوزيع الرصيد قبل الإصلاح:", JSON.stringify(beforeDist));
  console.log("توزيع الرصيد بعد الإصلاح:", JSON.stringify(afterDist));

  const notTwo = after.filter((s) => s.opportunities !== 2);
  if (notTwo.length > 0) {
    console.log(`\n⚠️ ${notTwo.length} طالب رصيدهم النهائي ليس فرصتين (للمراجعة):`);
    notTwo.slice(0, 20).forEach((s) =>
      console.log(`  ${s.name} | فرص: ${s.opportunities} | ${s.status}`),
    );
  } else {
    console.log("\n✅ كل المعاهدين رصيدهم النهائي فرصتان.");
  }

  console.log(`\nإعادة الاحتساب شملت ${recalc.students.length} طالباً.`);
} catch (error) {
  console.error("\nREPAIR FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
