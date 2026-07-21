export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import {
  recalculateAllStudentsAcademicState,
  recalculateStudentsAcademicState,
} from "@/lib/academic-recalculate-server";
import { db } from "@/lib/db";
import { repairProtectedAbsencesForStudents } from "@/lib/grace-period-repair-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

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
  // Q96 FIX: Use dedicated system.maintenance permission instead of
  // students.edit. Previously, any user with students.edit (a per-student
  // edit permission) could trigger a system-wide recalculation of ALL
  // students — violating least-privilege. Now requires explicit
  // system.maintenance permission (admin role has it by default).
  const authError = await requirePermission(req, "system.maintenance");
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(
    req,
    API_RATE_LIMITS.studentOpportunitySync,
  );
  if (rateLimitError) return rateLimitError;

  try {
    const scope = new URL(req.url).searchParams.get("scope");
    if (scope === "grace") {
      const batchSize = readBatchSize(req);
      const rows = await db.grade.findMany({
        where: { status: "غائب" },
        distinct: ["studentId"],
        select: { studentId: true },
      });
      let convertedGrades = 0;
      let deletedGrades = 0;
      let deletedCalls = 0;
      const affectedStudentIds = new Set<string>();

      for (let index = 0; index < rows.length; index += batchSize) {
        const studentIds = rows.slice(index, index + batchSize).map((row) => row.studentId);
        const batch = await withSerializableTransaction(async (tx) => {
          const repair = await repairProtectedAbsencesForStudents(tx, studentIds);
          const recalculation = repair.studentIds.length
            ? await recalculateStudentsAcademicState(repair.studentIds, { tx })
            : null;
          return { repair, recalculation };
        });
        convertedGrades += batch.repair.convertedGrades;
        deletedGrades += batch.repair.deletedGrades;
        deletedCalls += batch.repair.deletedCalls;
        for (const studentId of batch.recalculation?.studentIds || []) {
          affectedStudentIds.add(studentId);
        }
      }

      const result = {
        ok: true,
        convertedGrades,
        deletedGrades,
        deletedCalls,
        recalculatedStudents: affectedStudentIds.size,
      };
      await writeRequestAuditLog(
        req,
        "الدرجات",
        "تصحيح غيابات فترة السماح التاريخية",
        result,
      );
      return NextResponse.json({
        ...result,
        message: `تم تحويل ${convertedGrades} غياب محمي إلى ضمن فترة السماح.`,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }

    // Historical protected absences must be converted/removed before recalculation.
    // Recalculation alone ignores their penalty, but leaves the invalid grade
    // visible and able to reappear in related screens.
    const batchSize = readBatchSize(req);
    const rows = await db.grade.findMany({
      where: { status: "غائب" },
      distinct: ["studentId"],
      select: { studentId: true },
    });
    let deletedGrades = 0;
    let convertedGrades = 0;
    let deletedCalls = 0;
    for (let index = 0; index < rows.length; index += batchSize) {
      const studentIds = rows.slice(index, index + batchSize).map((row) => row.studentId);
      const repair = await withSerializableTransaction((tx) =>
        repairProtectedAbsencesForStudents(tx, studentIds),
      );
      convertedGrades += repair.convertedGrades;
      deletedGrades += repair.deletedGrades;
      deletedCalls += repair.deletedCalls;
    }

    const result = await recalculateAllStudentsAcademicState({
      batchSize,
    });

    await writeRequestAuditLog(
      req,
      "الطلاب",
      "إصلاح أكاديمي شامل وإعادة احتساب كل الطلاب",
      { ...result, convertedGrades, deletedGrades, deletedCalls },
    );

    return NextResponse.json({
      ...result,
      convertedGrades,
      deletedGrades,
      deletedCalls,
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
