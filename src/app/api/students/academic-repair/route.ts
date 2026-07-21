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
import { ensureProtectedGradeMarkers } from "@/lib/protected-grade-markers-server";
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
    const searchParams = new URL(req.url).searchParams;
    const scope = searchParams.get("scope");
    if (scope === "dismissed") {
      const batchSize = readBatchSize(req);
      const requestedLimit = Number(searchParams.get("limit") || 50);
      const limit = Math.min(50, Math.max(1, Math.trunc(requestedLimit || 25)));
      const afterId = String(searchParams.get("afterId") || "").trim();
      const fetchedRows = await db.student.findMany({
        where: {
          status: "مفصول",
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
      const hasMore = fetchedRows.length > limit;
      const rows = fetchedRows.slice(0, limit);
      let restoredStudents = 0;
      let stillDismissed = 0;
      let temporaryDismissals = 0;
      let finalDismissals = 0;
      let convertedGrades = 0;
      let convertedBeforeRegistration = 0;
      let deletedCalls = 0;

      for (let index = 0; index < rows.length; index += batchSize) {
        const studentIds = rows.slice(index, index + batchSize).map((row) => row.id);
        await ensureProtectedGradeMarkers(db, { studentIds });
        const repair = await repairProtectedAbsencesForStudents(db, studentIds);
        const recalculation = await recalculateStudentsAcademicState(studentIds);
        const batch = { repair, recalculation };
        convertedGrades += batch.repair.convertedGrades;
        convertedBeforeRegistration += batch.repair.convertedBeforeRegistration;
        deletedCalls += batch.repair.deletedCalls;
        for (const student of batch.recalculation.students) {
          if (student.status !== "مفصول") {
            restoredStudents += 1;
          } else {
            stillDismissed += 1;
            if (student.dismissalType === "فصل نهائي") finalDismissals += 1;
            else temporaryDismissals += 1;
          }
        }
      }

      const result = {
        ok: true,
        reviewedDismissedStudents: rows.length,
        nextCursor: rows.at(-1)?.id || afterId || null,
        hasMore,
        restoredStudents,
        stillDismissed,
        temporaryDismissals,
        finalDismissals,
        convertedGrades,
        convertedBeforeRegistration,
        deletedCalls,
      };
      await writeRequestAuditLog(
        req,
        "الطلاب",
        "تدقيق المفصولين وتصحيح الفصل والفرص تلقائياً",
        result,
      );
      return NextResponse.json({
        ...result,
        message: `تم تدقيق ${rows.length} مفصولاً: استُعيد ${restoredStudents} طالباً وثبت استحقاق فصل ${stillDismissed} طالباً.`,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }

    if (scope === "grace" || scope === "protected") {
      const batchSize = readBatchSize(req);
      const rows = await db.student.findMany({
        where: { status: { not: "مؤرشف" } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      let createdBeforeRegistration = 0;
      let createdGrace = 0;
      let convertedGrades = 0;
      let convertedBeforeRegistration = 0;
      let deletedGrades = 0;
      let deletedCalls = 0;
      const affectedStudentIds = new Set<string>();

      for (let index = 0; index < rows.length; index += batchSize) {
        const studentIds = rows.slice(index, index + batchSize).map((row) => row.id);
        const batch = await withSerializableTransaction(async (tx) => {
          const markers = await ensureProtectedGradeMarkers(tx, { studentIds });
          const repair = await repairProtectedAbsencesForStudents(tx, studentIds);
          const recalculation = await recalculateStudentsAcademicState(studentIds, { tx });
          return { markers, repair, recalculation };
        });
        createdBeforeRegistration += batch.markers.createdBeforeRegistration;
        createdGrace += batch.markers.createdGrace;
        convertedGrades += batch.repair.convertedGrades;
        convertedBeforeRegistration += batch.repair.convertedBeforeRegistration;
        deletedGrades += batch.repair.deletedGrades;
        deletedCalls += batch.repair.deletedCalls;
        for (const studentId of batch.recalculation?.studentIds || []) {
          affectedStudentIds.add(studentId);
        }
      }

      const result = {
        ok: true,
        createdBeforeRegistration,
        createdGrace,
        convertedGrades,
        convertedBeforeRegistration,
        deletedGrades,
        deletedCalls,
        recalculatedStudents: affectedStudentIds.size,
      };
      await writeRequestAuditLog(
        req,
        "الدرجات",
        "تنظيف جماعي للحالات المحمية وإعادة الأثر الأكاديمي",
        result,
      );
      return NextResponse.json({
        ...result,
        message: `تم إنشاء ${createdGrace} حالة ضمن فترة السماح و${createdBeforeRegistration} حالة قبل التسجيل، وتصحيح ${convertedGrades + convertedBeforeRegistration} سجل سابق، ثم إعادة الفرص والفصل التلقائي إلى النتيجة الصحيحة.`,
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
    let convertedBeforeRegistration = 0;
    let deletedCalls = 0;
    for (let index = 0; index < rows.length; index += batchSize) {
      const studentIds = rows.slice(index, index + batchSize).map((row) => row.studentId);
      const repair = await withSerializableTransaction((tx) =>
        repairProtectedAbsencesForStudents(tx, studentIds),
      );
      convertedGrades += repair.convertedGrades;
      convertedBeforeRegistration += repair.convertedBeforeRegistration;
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
      { ...result, convertedGrades, convertedBeforeRegistration, deletedGrades, deletedCalls },
    );

    return NextResponse.json({
      ...result,
      convertedGrades,
      convertedBeforeRegistration,
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
