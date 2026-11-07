export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireAnyPermissionPrincipal } from "@/lib/server-auth";
import {
  STUDENT_PROFILE_ACCESS_PERMISSIONS,
  studentProfileSectionAccess,
} from "@/lib/student-profile-server";
import {
  loadStudentReportDetails,
  STUDENT_REPORT_DETAILS_MAX_IDS,
} from "@/lib/student-report-details-server";

/**
 * تفاصيل تقرير HTML لعدة طلاب بطلب واحد: نفس ما يعيده ملف الطالب لكل واحد
 * منهم من حقول التقرير، بنفس الصلاحيات، بلا مكالمات أو ملاحظات أو سجل تدقيق.
 * ?ids=a,b,c — حتى STUDENT_REPORT_DETAILS_MAX_IDS طالب.
 */
export async function GET(req: NextRequest) {
  const principalOrError = await requireAnyPermissionPrincipal(
    req,
    [...STUDENT_PROFILE_ACCESS_PERMISSIONS],
  );
  if (principalOrError instanceof NextResponse) return principalOrError;
  const access = studentProfileSectionAccess(principalOrError);

  try {
    const { searchParams } = new URL(req.url);
    const ids = Array.from(
      new Set(
        String(searchParams.get("ids") || "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    );
    if (ids.length === 0) return validationError("ids مطلوب");
    if (ids.length > STUDENT_REPORT_DETAILS_MAX_IDS) {
      return validationError(`الحد الأعلى ${STUDENT_REPORT_DETAILS_MAX_IDS} طالب بالطلب الواحد`);
    }

    const students = await db.$transaction(
      (tx) => loadStudentReportDetails(tx, ids, access),
      { isolationLevel: "RepeatableRead", timeout: 25_000, maxWait: 10_000 },
    );

    return NextResponse.json(
      {
        students,
        missing: ids.filter((id) => !(id in students)),
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل تفاصيل تقرير الطلاب من بيانات النظام.");
  }
}
