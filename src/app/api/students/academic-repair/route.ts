export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import {
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

const EXPLICIT_ACADEMIC_REPAIR_SCOPES = new Set([
  "effect-exams",
  "protected",
  "protected-status-only",
  "restore-excess-dismissed",
  "dismissed",
  "grace",
]);

/**
 * PATCH /api/students/academic-repair
 *
 * لا يوجد إصلاح شامل افتراضي بعد الآن. يجب أن يحمل أي استعمال إداري نطاقاً
 * صريحاً من القائمة المحدودة أدناه؛ الطلب القديم بلا scope يُرفض قبل أي
 * قراءة أو كتابة لبيانات الطلاب حتى لا تستطيع حزمة متصفح قديمة إعادة الضرر.
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

  const searchParams = new URL(req.url).searchParams;
  const scope = String(searchParams.get("scope") || "").trim();
  if (!EXPLICIT_ACADEMIC_REPAIR_SCOPES.has(scope)) {
    return NextResponse.json(
      {
        error:
          "تم إيقاف الإصلاح الأكاديمي الشامل القديم. استخدم إجراءً محدداً بمعاينة وتأكيد من الواجهة.",
        retiredMaintenanceEndpoint: true,
      },
      { status: 410 },
    );
  }

  try {
    if (scope === "effect-exams") {
      const examIds = Array.from(
        new Set(
          String(searchParams.get("examIds") || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ).slice(0, 10);
      if (!examIds.length) {
        return NextResponse.json(
          { error: "يجب تحديد الامتحانات المطلوب تطبيق أثرها." },
          { status: 400 },
        );
      }
      const absentGrades = await db.grade.findMany({
        where: { examId: { in: examIds }, status: "غائب" },
        select: { studentId: true },
      });
      const studentIds = Array.from(
        new Set(absentGrades.map((grade) => grade.studentId)),
      );
      let recalculatedStudents = 0;
      for (let index = 0; index < studentIds.length; index += 100) {
        const recalculation = await recalculateStudentsAcademicState(
          studentIds.slice(index, index + 100),
        );
        recalculatedStudents += recalculation.studentIds.length;
      }
      const result = {
        ok: true,
        examIds,
        absentGrades: absentGrades.length,
        targetedStudents: studentIds.length,
        recalculatedStudents,
      };
      await writeRequestAuditLog(
        req,
        "الدرجات",
        "تطبيق أثر غياب الامتحانات المحددة على طلابها فقط",
        result,
      );
      return NextResponse.json({
        ...result,
        message: `تم تطبيق أثر ${absentGrades.length} حالة غياب على ${recalculatedStudents} طالباً مستهدفاً فقط.`,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }
    if (scope === "protected") {
      return NextResponse.json(
        {
          error: "أُغلقت التسوية التاريخية بعد تنفيذها مرة واحدة، ولا يمكن تطبيقها على امتحانات لاحقة.",
          oneTimeSettlementClosed: true,
        },
        { status: 410 },
      );
    }
    if (scope === "protected-status-only") {
      const batchSize = readBatchSize(req);
      const effectExamIds = Array.from(
        new Set(
          String(searchParams.get("effectExamIds") || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      );
      const rows = await db.student.findMany({
        where: { status: { not: "مؤرشف" } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      let convertedGrades = 0;
      let convertedBeforeRegistration = 0;

      for (let index = 0; index < rows.length; index += batchSize) {
        const studentIds = rows.slice(index, index + batchSize).map((row) => row.id);
        const repair = await withSerializableTransaction((tx) =>
          repairProtectedAbsencesForStudents(tx, studentIds, {
            deleteCalls: false,
            onlyAbsences: true,
          }),
        );
        convertedGrades += repair.convertedGrades;
        convertedBeforeRegistration += repair.convertedBeforeRegistration;
      }

      let enabledEffectGrades = 0;
      if (effectExamIds.length) {
        const grades = await db.grade.findMany({
          where: { examId: { in: effectExamIds }, status: "غائب" },
          select: { id: true, notes: true },
        });
        for (const grade of grades) {
          const currentNotes = String(grade.notes || "").trim();
          if (currentNotes.startsWith("أثر أكاديمي فعّال بعد التسوية:")) continue;
          await db.grade.update({
            where: { id: grade.id },
            data: {
              notes: `أثر أكاديمي فعّال بعد التسوية: ${currentNotes || "غياب امتحان حالي"}`,
            },
          });
          enabledEffectGrades += 1;
        }
      }

      const result = {
        ok: true,
        convertedGrades,
        convertedBeforeRegistration,
        enabledEffectGrades,
        recalculatedStudents: 0,
        deletedGrades: 0,
        deletedCalls: 0,
      };
      await writeRequestAuditLog(
        req,
        "الدرجات",
        "تصحيح حالات السماح وقبل التسجيل دون إعادة احتساب",
        result,
      );
      return NextResponse.json({
        ...result,
        message: `تم تحويل ${convertedGrades} غياباً إلى ضمن فترة السماح و${convertedBeforeRegistration} إلى قبل تسجيل الطالب دون إعادة احتساب.`,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }
    if (scope === "restore-excess-dismissed") {
      return NextResponse.json(
        {
          error:
            "تم إيقاف مسار استعادة المفصولين التاريخي. استرجاع أي طالب مفصول يتم حصراً من صفحة إدارة المفصولين.",
          retiredDismissedReactivationPath: true,
        },
        { status: 410 },
      );
    }

    if (scope === "dismissed") {
      const batchSize = readBatchSize(req);
      const requestedLimit = Number(searchParams.get("limit") || 50);
      const limit = Math.min(
        100,
        Math.max(1, Math.trunc(requestedLimit || 50)),
      );
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
      let preservedDismissedStudents = 0;
      let convertedGrades = 0;
      let convertedBeforeRegistration = 0;
      let deletedCalls = 0;

      for (let index = 0; index < rows.length; index += batchSize) {
        const studentIds = rows
          .slice(index, index + batchSize)
          .map((row) => row.id);
        const batch = await withSerializableTransaction(async (tx) => {
          await ensureProtectedGradeMarkers(tx, { studentIds });
          const repair = await repairProtectedAbsencesForStudents(
            tx,
            studentIds,
          );
          const recalculation = await recalculateStudentsAcademicState(
            studentIds,
            { tx },
          );
          const implicitReactivation = recalculation.students.find(
            (student) => student.status !== "مفصول",
          );
          if (implicitReactivation) {
            throw new Error(
              `حارس مركزية الاسترجاع أوقف تغيير حالة الطالب ${implicitReactivation.id}. أُلغيت دفعة الصيانة بالكامل.`,
            );
          }
          return { repair, recalculation };
        });
        preservedDismissedStudents += batch.recalculation.students.length;
        convertedGrades += batch.repair.convertedGrades;
        convertedBeforeRegistration +=
          batch.repair.convertedBeforeRegistration;
        deletedCalls += batch.repair.deletedCalls;
      }

      const result = {
        ok: true,
        reviewedDismissedStudents: rows.length,
        nextCursor: rows.at(-1)?.id || afterId || null,
        hasMore,
        preservedDismissedStudents,
        convertedGrades,
        convertedBeforeRegistration,
        deletedCalls,
        reactivatedStudents: 0,
      };
      await writeRequestAuditLog(
        req,
        "الطلاب",
        "إصلاح الحماية الأكاديمية للمفصولين دون تغيير حالتهم",
        result,
      );
      return NextResponse.json({
        ...result,
        message: `تم تدقيق حماية ${rows.length} طالب مفصول مع إبقائهم مفصولين. استرجاعهم متاح حصراً من إدارة المفصولين.`,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }

    if (scope === "grace") {
      const batchSize = readBatchSize(req);
      const excludeExamIds = String(searchParams.get("excludeExamIds") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const rows = await db.student.findMany({
        where: { status: { not: "مؤرشف" } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      let createdBeforeRegistration = 0;
      let createdGrace = 0;
      let createdAbsent = 0;
      let createdExcused = 0;
      let convertedGrades = 0;
      let convertedBeforeRegistration = 0;
      let deletedGrades = 0;
      let deletedCalls = 0;
      const affectedStudentIds = new Set<string>();

      for (let index = 0; index < rows.length; index += batchSize) {
        const studentIds = rows.slice(index, index + batchSize).map((row) => row.id);
        const batch = await withSerializableTransaction(async (tx) => {
          const markers = await ensureProtectedGradeMarkers(tx, {
            studentIds,
            includeAbsent: false,
            excludeExamIds,
            historicalNoEffect: true,
          });
          const repair = await repairProtectedAbsencesForStudents(tx, studentIds);
          const recalculation = await recalculateStudentsAcademicState(studentIds, { tx });
          return { markers, repair, recalculation };
        });
        createdBeforeRegistration += batch.markers.createdBeforeRegistration;
        createdGrace += batch.markers.createdGrace;
        createdAbsent += batch.markers.createdAbsent;
        createdExcused += batch.markers.createdExcused;
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
        createdAbsent,
        createdExcused,
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
        message: `تم إنشاء ${createdAbsent} غياباً تاريخياً بلا أثر، و${createdExcused} حالة مجاز، و${createdGrace} حالة ضمن فترة السماح، و${createdBeforeRegistration} حالة قبل التسجيل، ثم تصحيح السجلات الأكاديمية.`,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      {
        error: "نطاق الإصلاح الأكاديمي غير مدعوم.",
        retiredMaintenanceEndpoint: true,
      },
      { status: 410 },
    );
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تنفيذ الإصلاح الأكاديمي الشامل حالياً.",
    );
  }
}

export const POST = PATCH;
