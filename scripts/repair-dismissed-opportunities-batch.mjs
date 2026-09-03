/**
 * One-shot comprehensive data repair for the three reported issues:
 *
 * PART 1 — Reactivate the 65 dismissed-but-pledged students
 *   (المفصولين والتعهدات): they carry the pledge settlement log
 *   (balance pinned to 2) but were never reactivated. The teacher already
 *   reactivated 354 identical students one-by-one via «تم تعهد الطالب».
 *   This mirrors that exact flow: status=نشط, opportunities=2, the two
 *   reactivation opportunity logs, a student note, and the pending
 *   DISMISSED_PENDING smart-note migration.
 *
 * PART 2 — Reactivate BIO-2582 (حوراء عماد جدوع حسين) and
 *   BIO-2327 (زهراء وسام نوري كامل): false dismissals. They were
 *   auto-dismissed by a wrong "غياب فاينل" registration, then the teacher
 *   corrected the final-exam grades to 100 and 97 (passing). The engine
 *   preserved the stale dismissed status while recomputing balance 3/3.
 *   Correct state: active with the engine-computed 3/3 balance.
 *
 * PART 3 — Zero the balance of BIO-652 (فهد علي محمد جميل): valid dismissal
 *   (broke his pledge), but a manual "إضافة 3" workaround left him dismissed
 *   with 3/3. Per the system invariant a dismissed student carries no
 *   opportunities.
 *
 * PART 4 — Reactivate BIO-2715 (حسين عبدالله عبدالكاظم جيجان — the student
 *   in the attached photo): dismissed by the chapter-1 final score 28 AFTER
 *   the 08-30 emergency repair had already restored the rest of his course.
 *   The user wants him belonging to chapter 2: reactivate with a historical
 *   settlement log so chapter-1 exam effects are ignored, balance 3/3 —
 *   identical to the emergency-repair treatment.
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

const { migrateDismissedPendingGradesAfterActivation } = require(
  path.join(root, "src/lib/grade-smart-note-reactivation-server.ts"),
);

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const AUDIT_LOG_ID = "repair_dismissed_opportunities_batch_20260904";
const PLEDGE_REASON_PREFIX = "تسوية تاريخية: تعهد الطالب";
const REACTIVATION_GRANT = 2;

console.log("=== REPAIR: dismissed students with opportunities — 4 parts ===\n");

async function getActiveChapter(tx, courseId) {
  const link = await tx.courseChapter.findFirst({
    where: { courseId, active: true, archived: false },
    include: { chapter: true },
  });
  if (!link) throw new Error(`No active chapter for course ${courseId}`);
  return { id: link.chapter.id, name: link.chapter.name, opportunities: link.chapter.opportunities };
}

try {
  const existing = await db.auditLog.findUnique({
    where: { id: AUDIT_LOG_ID },
    select: { id: true, time: true },
  });
  if (existing) throw new Error(`Repair already ran at ${existing.time}. Aborting.`);

  const summary = await db.$transaction(
    async (tx) => {
      const now = new Date();

      // ---------- PART 1: pledged dismissed → reactivated with 2 ----------
      const pledgeLogs = await tx.opportunityLog.findMany({
        where: { reason: { startsWith: PLEDGE_REASON_PREFIX } },
        select: { studentId: true },
      });
      const pledgedIds = [...new Set(pledgeLogs.map((l) => l.studentId))];
      const dismissedPledged = await tx.student.findMany({
        where: { id: { in: pledgedIds }, status: "مفصول" },
        select: {
          id: true, code: true, name: true, courseId: true,
          dismissalReason: true, dismissalNotes: true,
          opportunities: true, baseOpportunities: true,
        },
        orderBy: { code: "asc" },
      });
      console.log(`PART 1: dismissed-but-pledged students = ${dismissedPledged.length}`);

      const part1Results = [];
      const chapterByCourse = new Map();
      for (const s of dismissedPledged) {
        if (!chapterByCourse.has(s.courseId)) {
          chapterByCourse.set(s.courseId, await getActiveChapter(tx, s.courseId));
        }
        const chapter = chapterByCourse.get(s.courseId);
        const previousReason = s.dismissalReason || "بدون سبب مسجل";

        await tx.student.update({
          where: { id: s.id },
          data: {
            status: "نشط",
            dismissalReason: null,
            dismissalNotes: null,
            opportunities: REACTIVATION_GRANT,
          },
        });

        const migration = await migrateDismissedPendingGradesAfterActivation(
          tx,
          s.id,
          { name: "TeacherPro repair — تعهدات معلقة" },
          now,
        );

        await tx.opportunityLog.create({
          data: {
            studentId: s.id,
            examId: null,
            action: "إعادة تفعيل",
            amount: 0,
            reason: "تثبيت إعادة التفعيل بعد تعهد الطالب: الطالب نشط برصيد فرصتين؛ الوصول إلى 0 لا يفصله، والمخالفة التالية وهو بدون فرص تؤدي إلى الفصل",
            date: now,
            chapterId: chapter.id,
            chapterNameSnapshot: chapter.name,
          },
        });
        await tx.opportunityLog.create({
          data: {
            studentId: s.id,
            examId: null,
            action: "رصيد إعادة التفعيل",
            amount: REACTIVATION_GRANT,
            reason: "تم تعهد الطالب: إرجاعه إلى الحالة النشطة برصيد فرصتين بسبب التعهد",
            date: now,
            chapterId: chapter.id,
            chapterNameSnapshot: chapter.name,
          },
        });
        await tx.studentNote.create({
          data: {
            studentId: s.id,
            kind: "إجراء",
            text: `تم تعهد الطالب: إعادة تفعيله بفرصتين بعد فصل سابق: ${previousReason}`,
            date: now,
            sourceType: "student-status-action",
            sourceId: s.id,
          },
        });
        part1Results.push({
          code: s.code,
          name: s.name,
          previousReason: (previousReason || "").slice(0, 60),
          previousOpportunities: s.opportunities,
          pendingMigrated: migration.processed,
          pendingConflicts: migration.conflicts,
        });
      }
      console.log(`  reactivated=${part1Results.length}, migrated pending grades=${part1Results.reduce((a, r) => a + r.pendingMigrated, 0)}`);

      // ---------- PART 2: false dismissals (grade corrected after dismissal) ----------
      const part2Codes = ["BIO-2582", "BIO-2327"];
      const part2Results = [];
      for (const code of part2Codes) {
        const s = await tx.student.findUnique({ where: { code } });
        if (!s) throw new Error(`PART 2: student ${code} not found`);
        if (s.status !== "مفصول") { console.log(`  ${code} already ${s.status} — skipping`); continue; }
        await tx.student.update({
          where: { id: s.id },
          data: {
            status: "نشط",
            dismissalReason: null,
            dismissalNotes: null,
            opportunities: 3,
            baseOpportunities: 3,
          },
        });
        await tx.studentNote.create({
          data: {
            studentId: s.id,
            kind: "إجراء",
            text: "تصحيح فصل غير صحيح: فُصل الطالب بغياب وهمي في امتحان الفاينل ثم صُححت درجته إلى درجة ناجحة؛ أُعيد إلى الحالة النشطة برصيد الفصل الثاني (3/3) لأن بياناته لا تسبب أي فصل.",
            date: now,
          },
        });
        part2Results.push({ code: s.code, name: s.name, previousReason: (s.dismissalReason || "").slice(0, 60) });
      }
      console.log(`PART 2: false dismissals reactivated = ${part2Results.length} (BIO-2582 حوراء عماد، BIO-2327 زهراء وسام)`);

      // ---------- PART 3: dismissed with stale balance → zero ----------
      const part3Results = [];
      const bio652 = await tx.student.findUnique({ where: { code: "BIO-652" } });
      if (bio652 && bio652.status === "مفصول" && bio652.opportunities > 0) {
        await tx.student.update({
          where: { id: bio652.id },
          data: { opportunities: 0 },
        });
        await tx.studentNote.create({
          data: {
            studentId: bio652.id,
            kind: "إجراء",
            text: `تصفير رصيد طالب مفصول: كان رصيده ${bio652.opportunities}/${bio652.baseOpportunities} بسبب إضافة يدوية سابقة؛ الطالب المفصول لا يحمل فرصاً، وإعادة تفعيله تمنحه فرصتين.`,
            date: now,
          },
        });
        part3Results.push({ code: bio652.code, name: bio652.name, zeroed: bio652.opportunities });
      }
      console.log(`PART 3: dismissed balance zeroed = ${part3Results.length} (BIO-652 فهد علي)`);

      // ---------- PART 4: BIO-2715 → belongs to chapter 2 ----------
      const bio2715 = await tx.student.findUnique({ where: { code: "BIO-2715" } });
      if (!bio2715) throw new Error("PART 4: BIO-2715 not found");
      let part4Result = null;
      if (bio2715.status === "مفصول") {
        const chapter = await getActiveChapter(tx, bio2715.courseId);
        const base = Math.max(0, Math.trunc(Number(chapter.opportunities || 0)));
        await tx.student.update({
          where: { id: bio2715.id },
          data: {
            status: "نشط",
            opportunities: base,
            baseOpportunities: base,
            dismissalReason: null,
            dismissalNotes: null,
          },
        });
        await tx.opportunityLog.create({
          data: {
            studentId: bio2715.id,
            action: "إعادة تعيين",
            amount: base,
            reason: "تسوية تاريخية: إعادة تفعيل طالب مفصول من الفصل الأول بعد انتقال دورته إلى الفصل الثاني - الانسجة؛ تجاهل آثار امتحانات الفصل السابق وبدء رصيد جديد بثلاث فرص",
            date: now,
            chapterId: chapter.id,
            chapterNameSnapshot: chapter.name,
          },
        });
        await tx.studentNote.create({
          data: {
            studentId: bio2715.id,
            kind: "إجراء",
            text: `إعادة تفعيل الطالب لينتمي إلى ${chapter.name}: كان مفصولاً بسبب ${bio2715.dismissalReason || ""}. بدء رصيد جديد ${base}/${base} مع تجاهل آثار امتحانات الفصل السابق.`,
            date: now,
          },
        });
        part4Result = { code: bio2715.code, name: bio2715.name, base, chapter: chapter.name, previousReason: (bio2715.dismissalReason || "").slice(0, 60) };
      } else {
        console.log(`  BIO-2715 already ${bio2715.status} — skipping`);
      }
      console.log(`PART 4: BIO-2715 reactivated into chapter 2 = ${part4Result ? "done" : "skipped"}`);

      await tx.auditLog.create({
        data: {
          id: AUDIT_LOG_ID,
          module: "سجل الطلاب",
          action: "إصلاح شامل: تفعيل المعاهدين المفصولين + تصحيح فصلين خاطئين + تصفير رصيد مفصول + إعادة طالب الفاينل للفصل الثاني",
          details: JSON.stringify({
            part1_pledgedReactivated: part1Results.length,
            part1_details: part1Results,
            part2_falseDismissalsFixed: part2Results,
            part3_balanceZeroed: part3Results,
            part4_chapter2Restored: part4Result,
            executedAt: now.toISOString(),
          }),
          userName: "TeacherPro repair — dismissed opportunities batch",
        },
      });

      return { part1Results, part2Results, part3Results, part4Result };
    },
    { timeout: 300_000, isolationLevel: "Serializable" },
  );

  console.log("\n=== DONE ===");
  console.log(`Part1 reactivated: ${summary.part1Results.length}`);
  const user22 = ["BIO-2445","BIO-2474","BIO-2512","BIO-2007","BIO-2050","BIO-1864","BIO-1865","BIO-1873","BIO-1874","BIO-1875","BIO-1888","BIO-1913","BIO-1943","BIO-1944","BIO-1948","BIO-1963","BIO-1797","BIO-1815","BIO-1817","BIO-1818","BIO-1822"];
  const fixedCodes = new Set(summary.part1Results.map(r => r.code));
  const missingFromFix = user22.filter(c => !fixedCodes.has(c));
  console.log(`User-list pledged students covered: ${user22.length - missingFromFix.length}/${user22.length}${missingFromFix.length ? " MISSING: " + missingFromFix.join(",") : ""}`);
  console.log(`Part2 (BIO-2582 حوراء عماد from user list): fixed`);
  console.log(`Part3 (BIO-652): ${summary.part3Results.length}`);
  console.log(`Part4 (BIO-2715 image student): ${summary.part4Result ? "fixed" : "skipped"}`);
} catch (error) {
  console.error("\nREPAIR FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
