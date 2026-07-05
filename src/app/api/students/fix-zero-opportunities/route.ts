export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";

/**
 * PATCH /api/students/fix-zero-opportunities
 *
 * Backfill endpoint that repairs students who were created with `opportunities=0`
 * and `baseOpportunities=0` even though their course had an active chapter at
 * the time of creation. This bug occurred because the client-side form was
 * sending `opportunities: 0` explicitly when `courseChapters` was not yet
 * loaded in the local store, and the server was respecting that explicit
 * zero without looking up the active chapter.
 *
 * Signature of a buggy record: opportunities === 0 AND baseOpportunities === 0
 * (a student whose course has an active chapter should never have
 * baseOpportunities === 0 — that's a contradiction).
 *
 * Admin-only. Returns the number of students fixed per course.
 */
export async function PATCH(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  try {
    // 1. ابحث عن كل روابط الفصول النشطة (course + active chapter)
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

    // 2. لكل دورة فيها فصل نشط، ابحث عن الطلاب الذين فرصهم 0/0 وأصلحهم
    for (const link of activeLinks) {
      const baseOpp = chapterOppById.get(link.chapterId) ?? 0;
      if (baseOpp <= 0) continue; // الفصل نفسه يحدد 0 فرصة — لا شيء لنصلحه

      const update = await db.student.updateMany({
        where: {
          courseId: link.courseId,
          opportunities: 0,
          baseOpportunities: 0,
        },
        data: {
          opportunities: baseOpp,
          baseOpportunities: baseOpp,
        },
      });

      if (update.count > 0) {
        perCourse.push({
          courseId: link.courseId,
          chapterId: link.chapterId,
          chapterOpportunities: baseOpp,
          fixedCount: update.count,
        });
        fixedTotal += update.count;
      }
    }

    return NextResponse.json({
      ok: true,
      message:
        fixedTotal > 0
          ? `تم إصلاح ${fixedTotal} طالب بفرص 0/0 عبر ${perCourse.length} دورة.`
          : "لا يوجد طلاب يحتاجون إصلاحاً. جميع الطلاب في الدورات ذات الفصول النشطة لديهم فرص صحيحة.",
      fixedTotal,
      perCourse,
    });
  } catch (error) {
    console.error("[API] /api/students/fix-zero-opportunities error:", error);
    return NextResponse.json(
      { error: "تعذر إكمال إصلاح فرص الطلاب. تحقق من السجلات ثم حاول مرة أخرى." },
      { status: 500 },
    );
  }
}
