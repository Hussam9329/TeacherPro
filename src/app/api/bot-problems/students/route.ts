export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { buildStudentRegistrySearchWhere } from "@/lib/student-registry-filters-server";
import { BOT_PROBLEMS_PERMISSION, type BotProblemStudent } from "@/lib/bot-problems";

/** Student search for «إضافة مشكلة»: every student in the system, any status. */
export async function GET(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, BOT_PROBLEMS_PERMISSION);
  if (principal instanceof NextResponse) return principal;
  try {
    const query = String(new URL(req.url).searchParams.get("q") || "").trim();
    if (query.length < 2) return NextResponse.json({ students: [] });
    const where = buildStudentRegistrySearchWhere(query);
    const rows = await withDatabaseSchema(() => db.student.findMany({
      where: where || {},
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        telegram: true,
        username: true,
        course: { select: { name: true } },
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      take: 20,
    }), "Student");
    const students: BotProblemStudent[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      status: row.status,
      courseName: row.course?.name || "",
      telegram: row.telegram || "",
      username: row.username || "",
    }));
    return NextResponse.json({ students }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر البحث عن الطالب.");
  }
}
