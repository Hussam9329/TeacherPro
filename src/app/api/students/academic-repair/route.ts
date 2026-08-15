export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { recalculateAllStudentsAcademicState } from "@/lib/academic-recalculate-server";

function readBatchSize(req: NextRequest): number {
  const raw = new URL(req.url).searchParams.get("batchSize");
  const numeric = Number(raw || 200);
  if (!Number.isFinite(numeric)) return 200;
  return Math.min(500, Math.max(25, Math.trunc(numeric)));
}

async function authorize(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.academicRepair");
  return principal;
}

export async function GET(req: NextRequest) {
  const principal = await authorize(req);
  if (principal instanceof NextResponse) return principal;
  try {
    const [totalStudents, activeStudents, dismissedStudents, archivedStudents, courses] = await Promise.all([
      db.student.count(),
      db.student.count({ where: { status: "نشط" } }),
      db.student.count({ where: { status: "مفصول" } }),
      db.student.count({ where: { status: "مؤرشف" } }),
      db.student.groupBy({ by: ["courseId"], where: { status: { not: "مؤرشف" } }, _count: { _all: true } }),
    ]);
    return NextResponse.json({
      preview: true,
      requiresManagerConfirmation: true,
      executableByCurrentUser: principal.isAdmin,
      totalStudents,
      affectedNonArchivedStudents: activeStudents + dismissedStudents,
      activeStudents,
      dismissedStudents,
      archivedStudentsExcluded: archivedStudents,
      courses: courses.map((row) => ({ courseId: row.courseId, students: row._count._all })),
      warning: "الإجراء يعيد بناء الرصيد والحالة الأكاديمية لكل طالب غير مؤرشف من السجلات الحالية. يجب مراجعته وتأكيده من مدير عام.",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر إعداد معاينة الإصلاح الأكاديمي.");
  }
}

export async function PATCH(req: NextRequest) {
  const principal = await authorize(req);
  if (principal instanceof NextResponse) return principal;
  if (!principal.isAdmin) {
    return NextResponse.json({ error: "تنفيذ الإصلاح الأكاديمي الشامل يحتاج تأكيد حساب المدير العام، حتى مع امتلاك صلاحية المعاينة." }, { status: 403 });
  }
  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.adminHeavy);
  if (rateLimitError) return rateLimitError;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.confirmImpact !== true || String(body.confirmText || "").trim() !== "إصلاح أكاديمي شامل") {
      return validationError("اعرض المعاينة أولاً، ثم أكد الأثر بكتابة «إصلاح أكاديمي شامل».");
    }
    const result = await recalculateAllStudentsAcademicState({ batchSize: readBatchSize(req) });
    await writeRequestAuditLog(req, "الطلاب", "إصلاح أكاديمي شامل وإعادة احتساب كل الطلاب", {
      ...result,
      confirmedByManagerId: principal.id,
      confirmedByManagerName: principal.name,
    });
    return NextResponse.json({
      ...result,
      message: result.recalculatedStudents > 0
        ? `تمت إعادة احتساب ${result.recalculatedStudents} طالب حسب القواعد الحالية.`
        : "لا توجد سجلات طلاب تحتاج إعادة احتساب.",
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تنفيذ الإصلاح الأكاديمي الشامل حالياً.");
  }
}

export const POST = PATCH;
