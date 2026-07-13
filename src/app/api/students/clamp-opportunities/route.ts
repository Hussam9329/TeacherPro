export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";

/**
 * PATCH /api/students/clamp-opportunities
 *
 * Backfill endpoint that repairs students whose `opportunities` exceed the
 * `baseOpportunities` of the active chapter for their course.
 *
 * This happens when a stale client cache writes an inflated value to the
 * server (e.g. a bulk-add operation that ran against an outdated local list
 * before a chapter change), or when a chapter was re-activated with a lower
 * opportunities count than the student currently has.
 *
 * The endpoint is idempotent and safe to call anytime. It only writes when
 * a student's opportunities actually exceeds the cap; otherwise it's a no-op.
 *
 * Admin-only. Returns per-course statistics so the caller can see what was
 * fixed.
 */
export async function PATCH(req: NextRequest) {
  // Q96 FIX: Use dedicated system.maintenance permission (was students.edit).
  const authError = await requirePermission(req, "system.maintenance");
  if (authError) return authError;

  try {
    // 1. ابحث عن كل روابط الفصول النشطة.
    const activeLinks = await db.courseChapter.findMany({
      where: { active: true, archived: false },
      select: { courseId: true, chapterId: true },
    });

    if (activeLinks.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "لا توجد فصول نشطة حالياً. لا حاجة للإصلاح.",
        fixedTotal: 0,
        perCourse: [],
      });
    }

    // 2. اقرأ فرص كل فصل نشط.
    const chapterIds = Array.from(new Set(activeLinks.map((l) => l.chapterId)));
    const chapters = await db.chapter.findMany({
      where: { id: { in: chapterIds } },
      select: { id: true, opportunities: true },
    });
    const chapterOppById = new Map(
      chapters.map((ch) => [ch.id, Number(ch.opportunities || 0)]),
    );

    const perCourse: Array<{
      courseId: string;
      chapterId: string;
      chapterOpportunities: number;
      fixedCount: number;
    }> = [];
    let fixedTotal = 0;

    // 3. لكل دورة فيها فصل نشط، ابحث عن الطلاب الذين فرصهم تتجاوز سقف الفصل
    //    واضبطهم على السقف. الفصل نفسه قد يحدد 0 فرص (مثل دورة الإعفاء)،
    //    وفي هذه الحالة لا نلمس الطلاب لأن 0 سقف فعلي لهم.
    //
    // Q97 FIX: Exclude archived students. Archived students' opportunity
    // balances are historical snapshots that should never be modified.
    // Previously, clamp-opportunities modified archived students too,
    // breaking the integrity of the archive (the archived balance no
    // longer matched what the student had when archived).
    for (const link of activeLinks) {
      const chapterOpp = chapterOppById.get(link.chapterId) ?? 0;

      // ابحث عن الطلاب النشطين فقط الذين فرصهم تتجاوز السقف المسموح به.
      // شرط opportunities > chapterOpp يلتقط فقط المتجاوزين فعلاً.
      // شرط status !== "مؤرشف" يحمي لقطات الأرشيف (Q97).
      const update = await db.student.updateMany({
        where: {
          courseId: link.courseId,
          opportunities: { gt: chapterOpp },
          status: { not: "مؤرشف" },
        },
        data: {
          opportunities: chapterOpp,
          baseOpportunities: chapterOpp,
        },
      });

      if (update.count > 0) {
        perCourse.push({
          courseId: link.courseId,
          chapterId: link.chapterId,
          chapterOpportunities: chapterOpp,
          fixedCount: update.count,
        });
        fixedTotal += update.count;
      }
    }

    return NextResponse.json({
      ok: true,
      message:
        fixedTotal > 0
          ? `تم ضبط ${fixedTotal} طالب كانت فرصهم تتجاوز سقف فصلهم النشط.`
          : "لا يوجد طلاب بفرص تتجاوز سقف فصلهم النشط. كل الفرص ضمن الحد المسموح.",
      fixedTotal,
      perCourse,
    });
  } catch (error) {
    console.error("[API] /api/students/clamp-opportunities error:", error);
    return NextResponse.json(
      { error: "تعذر إكمال ضبط فرص الطلاب. تحقق من السجلات ثم حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
