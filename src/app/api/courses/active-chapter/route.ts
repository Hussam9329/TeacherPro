export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";

/**
 * GET /api/courses/active-chapter?courseId=...
 *
 * يرجع الفصل النشط الوحيد غير المؤرشف للدورة المطلوبة من قاعدة البيانات
 * مباشرةً، بدل أن تعتمد الواجهة على كاش Zustand المحلي الذي قد يكون
 * قديماً أو غير محمّل بعد.
 *
 * الاستخدام: نافذة تعديل الطالب / نافذة النقل / أي مكان يقرر فيه هل
 * الدورة المستهدفة تملك فصلاً نشطاً قبل التنفيذ.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  const courseId = new URL(req.url).searchParams.get("courseId") || "";
  if (!courseId) {
    return NextResponse.json(
      { error: "courseId مطلوب" },
      { status: 400 },
    );
  }

  try {
    const activeLinks = await db.courseChapter.findMany({
      where: { courseId, active: true, archived: false },
      select: {
        chapterId: true,
        chapter: { select: { id: true, name: true, opportunities: true } },
      },
    });

    if (activeLinks.length === 0) {
      return NextResponse.json({
        courseId,
        hasActiveChapter: false,
        conflict: false,
        activeChapter: null,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }

    if (activeLinks.length > 1) {
      return NextResponse.json({
        courseId,
        hasActiveChapter: false,
        conflict: true,
        activeChapter: null,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }

    const link = activeLinks[0];
    const opportunities = Math.max(
      0,
      Math.trunc(Number(link.chapter?.opportunities || 0)),
    );

    return NextResponse.json({
      courseId,
      hasActiveChapter: true,
      conflict: false,
      activeChapter: {
        id: link.chapter.id,
        name: link.chapter.name,
        opportunities,
        chapterId: link.chapterId,
      },
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر قراءة الفصل النشط للدورة حالياً.",
    );
  }
}
