export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { requirePermission } from "@/lib/server-auth";

/**
 * What «إرسال إشعار» can target: the active courses and the chapters linked
 * to each. Gated by the send permission alone, so an account that only
 * sends notifications still sees the lists.
 */
export async function GET(req: NextRequest) {
  const denied = await requirePermission(req, "notifications.send");
  if (denied) return denied;
  try {
    const courses = await db.course.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        chapters: { where: { archived: false }, select: { active: true, chapter: { select: { id: true, name: true } } } },
      },
    });
    return NextResponse.json({
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        chapters: course.chapters
          .map((link) => ({ id: link.chapter.id, name: link.chapter.name, active: link.active }))
          .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ar")),
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل الدورات والفصول حالياً.");
  }
}
