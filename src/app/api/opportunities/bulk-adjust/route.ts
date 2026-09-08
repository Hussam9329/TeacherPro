export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { normalizeBoolean } from "@/lib/opportunity-filters-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import {
  globalImpactConfirmationResponse,
  isConfirmedImpact,
  riskyBulkOpportunityTargetCount,
} from "@/lib/global-side-effects-safety";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { buildBulkOpportunityPreview } from "@/lib/bulk-opportunity-preview-server";
import { ZERO_BALANCE_VIOLATION_MARKER } from "@/lib/opportunity-balance";

function chunks<T>(items: T[], size = 250): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function normalizeText(value: unknown, max = 2000): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function normalizePositiveInt(value: unknown, fallback = 1): number {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.trunc(Math.abs(numeric)));
}

async function handleFilterBasedBulkAdjust(
  req: NextRequest,
  body: Record<string, unknown>,
) {
  const actionType = body.actionType === "deduct" ? "deduct" : "add";
  const amount = normalizePositiveInt(body.amount, 1);
  const action = actionType === "deduct" ? "خصم" : "إضافة";
  const reason = normalizeText(body.reason, 2000);
  if (!reason) return validationError("يرجى إدخال سبب العملية الجماعية");

  const excludeDismissed = normalizeBoolean(body.excludeDismissed, true);
  const excludeFullOpportunities = normalizeBoolean(
    body.excludeFullOpportunities,
    true,
  );
  const previewInput = {
    courseId: normalizeText(body.courseId, 120),
    status: normalizeText(body.status, 120),
    opportunityCount: normalizeText(body.opportunityCount, 40),
    q: normalizeText(body.q, 300),
    actionType,
    excludeDismissed,
    excludeFullOpportunities,
  } as const;
  const submittedPreviewToken = normalizeText(body.previewToken, 200);

  const result = await withDatabaseSchema(
    async () =>
      withSerializableTransaction(async (tx) => {
        const preview = await buildBulkOpportunityPreview(tx, previewInput);
        const {
          targetRows,
          totalMatching,
          eligibleWithActiveChapter,
          noActiveChapter,
          activeChapterConflicts,
          zeroOpportunityLimit,
          invalidOpportunitySource,
          targetCount,
          previewToken,
        } = preview;

        if (!targetRows.length) {
          return {
            updatedStudents: 0,
            savedOpportunityLogs: 0,
            savedStudentNotes: 0,
            totalMatching,
            eligibleWithActiveChapter,
            noActiveChapter,
            activeChapterConflicts,
            zeroOpportunityLimit,
            invalidOpportunitySource,
            skipped: Math.max(0, totalMatching),
            targetCount: 0,
            requiresConfirmation: false,
          };
        }

        if (!submittedPreviewToken || submittedPreviewToken !== previewToken) {
          return {
            previewConflict: true,
            totalMatching,
            eligibleWithActiveChapter,
            noActiveChapter,
            activeChapterConflicts,
            zeroOpportunityLimit,
            invalidOpportunitySource,
            targetCount,
            skipped: preview.skipped,
            previewToken,
          };
        }

        const confirmed = isConfirmedImpact(body.confirmImpact);
        if (riskyBulkOpportunityTargetCount(targetCount) && !confirmed) {
          return {
            confirmationRequired: true,
            totalMatching,
            eligibleWithActiveChapter,
            noActiveChapter,
            activeChapterConflicts,
            zeroOpportunityLimit,
            invalidOpportunitySource,
            targetCount,
            skipped: preview.skipped,
            previewToken,
          };
        }

        const now = new Date();
        const opportunityLogs: Array<{
          studentId: string;
          action: string;
          amount: number;
          requestedAmount: number;
          appliedAmount: number;
          balanceBefore: number;
          balanceAfter: number;
          ledgerVersion: number;
          reason: string;
          date: Date;
          chapterId: string | null;
          chapterNameSnapshot?: string | null;
        }> = [];
        const appliedStudentIds: string[] = [];
        for (const student of targetRows) {
          const activeChapter = student.activeChapter;
          if (!activeChapter) continue;
          if (student.status === "مفصول") continue;
          const before = Math.max(0, student.opportunities);
          const applied = actionType === "add"
            ? Math.min(amount, Math.max(0, activeChapter.opportunities - before))
            : Math.min(amount, before);
          appliedStudentIds.push(student.id);
          opportunityLogs.push({
            studentId: student.id,
            action,
            amount: applied,
            requestedAmount: amount,
            appliedAmount: applied,
            balanceBefore: before,
            balanceAfter: actionType === "add" ? before + applied : before - applied,
            ledgerVersion: 2,
            reason:
              actionType === "deduct" && student.opportunities === 0
                ? `${reason} ${ZERO_BALANCE_VIOLATION_MARKER}`
                : reason,
            date: now,
            chapterId: activeChapter.id,
            chapterNameSnapshot: activeChapter.name || null,
          });
        }

        for (const group of chunks(opportunityLogs)) {
          await tx.opportunityLog.createMany({ data: group });
        }
        const academicRecalculation = appliedStudentIds.length
          ? await recalculateStudentsAcademicState(appliedStudentIds, { tx })
          : null;
        const updatedStudents = academicRecalculation?.students.length || 0;

        return {
          updatedStudents,
          savedOpportunityLogs: opportunityLogs.length,
          savedStudentNotes: 0,
          reactivatedStudents: 0,
          migratedPendingGrades: 0,
          pendingGradeConflicts: 0,
          totalMatching,
          eligibleWithActiveChapter,
          noActiveChapter,
          activeChapterConflicts,
          zeroOpportunityLimit,
          invalidOpportunitySource,
          skipped: Math.max(0, totalMatching - appliedStudentIds.length),
          targetCount,
          previewToken,
          requiresConfirmation: riskyBulkOpportunityTargetCount(targetCount),
          academicRecalculation,
        };
      }),
    "BulkOpportunityAdjustByFilter",
  );

  if ("previewConflict" in result && result.previewConflict) {
    return NextResponse.json(
      {
        error:
          "تغيّر نطاق الطلاب أو أرصدتهم بعد المعاينة. تم إيقاف العملية قبل أي تعديل؛ راجع العدد ثم أكد من جديد.",
        requiresFreshPreview: true,
        details: {
          totalMatching: result.totalMatching,
          targetCount: result.targetCount,
          skipped: result.skipped,
        },
      },
      { status: 409 },
    );
  }

  if ("confirmationRequired" in result && result.confirmationRequired) {
    return globalImpactConfirmationResponse(
      `عملية الفرص الجماعية ستؤثر على ${result.targetCount} طالب. راجع المعاينة ثم أكد العملية من الواجهة.`,
      {
        actionType,
        amount,
        reason,
        totalMatching: result.totalMatching,
        eligibleWithActiveChapter: result.eligibleWithActiveChapter,
        noActiveChapter: result.noActiveChapter,
        activeChapterConflicts: result.activeChapterConflicts,
        zeroOpportunityLimit: result.zeroOpportunityLimit,
        invalidOpportunitySource: result.invalidOpportunitySource,
        targetCount: result.targetCount,
        skipped: result.skipped,
      },
    );
  }

  await writeRequestAuditLog(
    req,
    "إدارة الفرص",
    actionType === "deduct"
      ? "خصم فرص جماعي وإعادة احتساب"
      : "إضافة فرص جماعية وإعادة احتساب",
    {
      actionType,
      amount,
      reason,
      totalMatching: result.totalMatching,
      eligibleWithActiveChapter: result.eligibleWithActiveChapter,
      noActiveChapter: result.noActiveChapter,
      activeChapterConflicts: result.activeChapterConflicts,
      zeroOpportunityLimit: result.zeroOpportunityLimit,
      invalidOpportunitySource: result.invalidOpportunitySource,
      targetCount: result.targetCount,
      updatedStudents: result.updatedStudents,
      savedOpportunityLogs: result.savedOpportunityLogs,
      skipped: result.skipped,
      excludeDismissed,
      excludeFullOpportunities,
      confirmedImpact: isConfirmedImpact(body.confirmImpact),
    },
  );

  return NextResponse.json({ ...result, source: "database" });
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.manage");
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(
    req,
    API_RATE_LIMITS.bulkOpportunities,
  );
  if (rateLimitError) return rateLimitError;

  try {
    const body = await req.json();
    if (
      body &&
      typeof body === "object" &&
      (body as Record<string, unknown>).mode === "filter"
    ) {
      return handleFilterBasedBulkAdjust(req, body as Record<string, unknown>);
    }
    return NextResponse.json({ error: "أُوقف عقد المزامنة القديم؛ استخدم إجراء الفرص مع المعاينة.", code: "OPPORTUNITY_LEDGER_COMMAND_REQUIRED" },
      { status: 410, headers: { "x-teacherpro-retryable": "false" } });
  } catch (error) {
    if (
      (error as { code?: string } | null)?.code ===
      "RETIRED_BULK_STATUS_TRANSITION"
    ) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "مسار تغيير الحالة موقوف.",
          requiresRefresh: true,
          retiredReactivationAction: true,
        },
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store",
            "X-TeacherPro-Retryable": "0",
          },
        },
      );
    }
    // Validation errors (invalid status) should
    // return 400, not 500. routeErrorResponse treats unknown errors as 500.
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("قيمة الحالة") ||
      message.includes("غير صالحة")
    ) {
      return validationError(message, 400);
    }
    return routeErrorResponse(error, "تعذر حفظ تحديث الفرص الجماعي حالياً.");
  }
}
