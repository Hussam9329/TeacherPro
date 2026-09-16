export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { withStudentMutationToken } from "@/lib/student-mutation-token";

// Read-only conflict recovery: never grants grace, recalculates, or retries a save.
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return validationError("تعذر تحديد الطالب المطلوب.");

  try {
    const sourceStudent = await db.student.findUnique({ where: { id } });
    if (!sourceStudent) {
      return validationError("تعذر العثور على الطالب المطلوب.", 404);
    }
    const [student] = await attachStudentOpportunitySnapshots([sourceStudent]);
    return NextResponse.json(
      {
        student: withStudentMutationToken(
          student as unknown as Record<string, unknown>,
          sourceStudent as unknown as Record<string, unknown>,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل أحدث بيانات الطالب. حاول مرة أخرى.");
  }
}
