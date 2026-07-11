export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { recalculateAllStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";

type Mode = "active-only" | "include-dismissed";

function readMode(req: NextRequest): Mode {
  const raw = new URL(req.url).searchParams.get("mode");
  if (raw === "include-dismissed") return "include-dismissed";
  return "active-only";
}

/**
 * PATCH /api/students/fix-zero-opportunities
 *
 * إصلاح شامل لكل الطلاب الذين فرصهم معطوبة (0/0 أو 0/X أو X/0 أو
 * baseOpportunities لا تساوي فرص الفصل النشط) بناءً على فرص الفصل النشط
 * الحالي لكل دورة.
 *
 * الطلاب المؤرشفون لا يُعاد لهم فرص إطلاقاً.
 * الطلاب المفصولون يُعاد لهم baseOpportunities ولا تُعاد احتساب حالتهم
 * إلا إذا طلب المستخدم صراحةً mode=include-dismissed.
 *
 * بعد إصلاح الفرص، يُستدعى recalculation الأكاديمي الشامل لضمان أن
 * opportunities والحالة الأكاديمية متوافقة مع سجلات الدرجات/الإجازات/التعهدات.
 *
 * Admin-only. Returns per-course details + global recalculation summary.
 */
export async function PATCH(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  const mode = readMode(req);

  try {
    // 1. اجلب كل روابط الفصول النشطة غير المؤرشفة + فرص كل فصل.
    const activeLinks = await db.courseChapter.findMany({
      where: { active: true, archived: false },
      select: {
        courseId: true,
        chapterId: true,
        chapter: { select: { id: true, opportunities: true } },
      },
    });

    if (activeLinks.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "لا توجد فصول نشطة حالياً. لا حاجة للإصلاح.",
        fixedTotal: 0,
        skippedArchivedTotal: 0,
        perCourse: [],
        mode,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }

    // courseId -> فرص الفصل النشط الوحيد (إذا تعدد، نتخطى الدورة)
    const chapterOppByCourseId = new Map<string, number>();
    const activeLinksByCourseId = new Map<string, number>();
    for (const link of activeLinks) {
      const count = (activeLinksByCourseId.get(link.courseId) || 0) + 1;
      activeLinksByCourseId.set(link.courseId, count);
      if (count === 1) {
        const opp = Math.max(0, Math.trunc(Number(link.chapter?.opportunities || 0)));
        chapterOppByCourseId.set(link.courseId, opp);
      }
    }
    // احذف الدورات التي بها أكثر من فصل نشط (تتعارض الحسابات)
    for (const [courseId, count] of activeLinksByCourseId) {
      if (count > 1) chapterOppByCourseId.delete(courseId);
    }

    const allowedStatuses = mode === "include-dismissed" ? ["نشط", "مفصول"] : ["نشط"];

    const perCourse: Array<{
      courseId: string;
      chapterOpportunities: number;
      fixedCount: number;
      skippedArchived: number;
    }> = [];
    let fixedTotal = 0;
    let skippedArchivedTotal = 0;

    // 2. لكل دورة فيها فصل نشط واحد، أصلح أي طالب فرصه معطوبة.
    for (const [courseId, baseOpp] of chapterOppByCourseId) {
      if (baseOpp <= 0) continue; // الفصل نفسه فرصه 0 — لا شيء لنصلحه

      // عدّ الطلاب المؤرشفين قبل تحديث البقية (للشفافية فقط)
      const archivedCount = await db.student.count({
        where: { courseId, status: "مؤرشف" },
      });
      skippedArchivedTotal += archivedCount;

      // أصلح كل الطلاب النشطين والمفصولين في الدورات ذات الفصل النشط،
      // بصرف النظر عن قيم opportunities/baseOpportunities الحالية.
      // نعيد baseOpportunities إلى فرص الفصل النشط، ثم نعتمد على
      // recalculateAllStudentsAcademicState لإعادة بناء opportunities
      // من سجلات الدرجات/الإجازات/التعهدات.
      const update = await db.student.updateMany({
        where: {
          courseId,
          status: { in: allowedStatuses },
        },
        data: {
          baseOpportunities: baseOpp,
          // opportunities سيُعاد احتسابها في recalculation
        },
      });

      if (update.count > 0) {
        perCourse.push({
          courseId,
          chapterOpportunities: baseOpp,
          fixedCount: update.count,
          skippedArchived: archivedCount,
        });
        fixedTotal += update.count;
      }
    }

    // 3. أعِد احتساب الحالة الأكاديمية لكل الطلاب غير المؤرشفين لضمان
    // أن opportunities والحالة متوافقة مع سجلات الدرجات/الإجازات/التعهدات.
    const recalcResult = await recalculateAllStudentsAcademicState({ batchSize: 250 });

    await writeRequestAuditLog(
      req,
      "الطلاب",
      `إصلاح شامل لفرص الطلاب المعطوبة (الوضع: ${mode})`,
      {
        fixedTotal,
        skippedArchivedTotal,
        perCourse,
        recalc: recalcResult,
      },
    );

    return NextResponse.json({
      ok: true,
      message:
        fixedTotal > 0
          ? `تم إصلاح ${fixedTotal} طالب عبر ${perCourse.length} دورة، وأعيد احتساب ${recalcResult.recalculatedStudents} طالب.`
          : "لا يوجد طلاب يحتاجون إصلاحاً. جميع الطلاب في الدورات ذات الفصول النشطة لديهم فرص صحيحة.",
      fixedTotal,
      skippedArchivedTotal,
      perCourse,
      recalc: recalcResult,
      mode,
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر إكمال إصلاح فرص الطلاب. تحقق من السجلات ثم حاول مرة أخرى.",
    );
  }
}

export const POST = PATCH;
