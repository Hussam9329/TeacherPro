export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { recalculateAllStudentsAcademicState } from "@/lib/academic-recalculate-server";

function readBatchSize(req: NextRequest): number {
  const raw = new URL(req.url).searchParams.get("batchSize");
  const numeric = Number(raw || 200);
  if (!Number.isFinite(numeric)) return 200;
  return Math.min(500, Math.max(25, Math.trunc(numeric)));
}

/**
 * PATCH /api/students/academic-repair
 *
 * علاج جماعي آمن وقابل للتكرار لكل الطلاب غير المؤرشفين:
 * - يطابق baseOpportunities مع فرص الفصل النشط الحالي لكل دورة.
 * - يعيد احتساب الفرص والحالة والفصل من سجلات الدرجات/الإجازات/التعهدات حسب القواعد الحالية.
 * - يحذف سجلات الخصم/الفصل التلقائية القديمة ويعيد إنشاء الصحيح منها فقط.
 *
 * لا يكرر الخصومات لأن سجلات النظام التلقائية تُستبدل من جديد في كل تشغيل.
 */
export async function PATCH(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(
    req,
    API_RATE_LIMITS.studentOpportunitySync,
  );
  if (rateLimitError) return rateLimitError;

  try {
    const result = await recalculateAllStudentsAcademicState({
      batchSize: readBatchSize(req),
    });

    await writeRequestAuditLog(
      req,
      "الطلاب",
      "إصلاح أكاديمي شامل وإعادة احتساب كل الطلاب",
      result,
    );

    return NextResponse.json({
      ...result,
      message:
        result.recalculatedStudents > 0
          ? `تمت إعادة احتساب ${result.recalculatedStudents} طالب حسب القواعد الحالية.`
          : "لا توجد سجلات طلاب تحتاج إعادة احتساب.",
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تنفيذ الإصلاح الأكاديمي الشامل حالياً.",
    );
  }
}

export const POST = PATCH;
