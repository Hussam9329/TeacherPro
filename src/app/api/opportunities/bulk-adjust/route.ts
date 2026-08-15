export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withFollowupTables } from "@/lib/followup-schema";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { buildOpportunityFilters, composeStudentWhere, normalizeBoolean } from "@/lib/opportunity-filters-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { globalImpactConfirmationResponse, isConfirmedImpact, riskyBulkOpportunityTargetCount } from "@/lib/global-side-effects-safety";
import { attachStudentOpportunitySnapshotsWithClient } from "@/lib/student-opportunity-snapshot-server";
import { lockStudentsAcademicState } from "@/lib/academic-student-lock-server";


type BulkStudentRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  opportunities: number;
  baseOpportunities: number;
  courseId: string;
  dismissalReason: string;
  dismissalType: string;
};

type BulkAdjustConfirmation = {
  confirmationRequired: true;
  totalMatching: number;
  eligibleWithActiveChapter: number;
  noActiveChapter: number;
  activeChapterConflicts: number;
  zeroOpportunityLimit: number;
  invalidOpportunitySource: number;
  targetCount: number;
  skipped: number;
};

type BulkAdjustSuccess = {
  updatedStudents: number;
  savedOpportunityLogs: number;
  savedStudentNotes: number;
  totalMatching: number;
  eligibleWithActiveChapter: number;
  noActiveChapter: number;
  activeChapterConflicts: number;
  zeroOpportunityLimit: number;
  invalidOpportunitySource: number;
  targetCount: number;
  skipped: number;
  movementSummary: Array<{ studentId: string; requested: number; applied: number; before: number; after: number }>;
  academicRecalculation?: unknown;
};

function text(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}
function positiveInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error("عدد الفرص يجب أن يكون عدداً صحيحاً موجباً.");
  return numeric;
}

async function handleFilterBasedBulkAdjust(req: NextRequest, body: Record<string, unknown>) {
  const actionType = body.actionType === "deduct" ? "deduct" : "add";
  const action = actionType === "deduct" ? "خصم" : "إضافة";
  const amount = positiveInteger(body.amount ?? 1);
  const reason = text(body.reason);
  if (!reason) return validationError("يرجى إدخال سبب العملية الجماعية.");

  const excludeDismissed = normalizeBoolean(body.excludeDismissed, true);
  const excludeFullOpportunities = normalizeBoolean(body.excludeFullOpportunities, true);
  const reactivateDismissedOnAdd = normalizeBoolean(body.reactivateDismissedOnAdd, false);
  const filters = buildOpportunityFilters({
    courseId: text(body.courseId, 120), status: text(body.status, 120),
    opportunityCount: text(body.opportunityCount, 40), q: text(body.q, 300),
  });

  const result = await withFollowupTables<BulkAdjustConfirmation | BulkAdjustSuccess>(() => db.$transaction(async (tx) => {
    const rows = (await tx.student.findMany({
      where: composeStudentWhere(filters),
      select: { id: true, name: true, code: true, status: true, opportunities: true, baseOpportunities: true, courseId: true, dismissalReason: true, dismissalType: true },
    })) as BulkStudentRow[];
    const totalMatching = rows.length;
    const snapshots = await attachStudentOpportunitySnapshotsWithClient(tx, rows);
    const eligible = snapshots.filter((row) => row.status !== "مؤرشف" && row.opportunityHealth === "ready");
    const noActiveChapter = snapshots.filter((row) => row.opportunityHealth === "missing-active-chapter").length;
    const activeChapterConflicts = snapshots.filter((row) => row.opportunityHealth === "active-chapter-conflict").length;
    const zeroOpportunityLimit = snapshots.filter((row) => row.opportunityHealth === "zero-limit").length;
    const invalidOpportunitySource = noActiveChapter + activeChapterConflicts + zeroOpportunityLimit;

    const targets = eligible.filter((student) => {
      if (student.status === "مفصول") {
        if (excludeDismissed) return false;
        if (actionType !== "add" || !reactivateDismissedOnAdd) return false;
      }
      if (actionType === "deduct" && excludeFullOpportunities && student.isOpportunityFull) return false;
      return true;
    });
    const targetCount = targets.length;
    if (riskyBulkOpportunityTargetCount(targetCount) && !isConfirmedImpact(body.confirmImpact)) {
      return { confirmationRequired: true as const, totalMatching, eligibleWithActiveChapter: eligible.length, noActiveChapter, activeChapterConflicts, zeroOpportunityLimit, invalidOpportunitySource, targetCount, skipped: totalMatching - targetCount };
    }
    if (!targetCount) return { updatedStudents: 0, savedOpportunityLogs: 0, savedStudentNotes: 0, totalMatching, eligibleWithActiveChapter: eligible.length, noActiveChapter, activeChapterConflicts, zeroOpportunityLimit, invalidOpportunitySource, targetCount: 0, skipped: totalMatching, movementSummary: [] };

    const ids = targets.map((student) => student.id);
    await lockStudentsAcademicState(tx, ids);
    const dismissed = targets.filter((student) => student.status === "مفصول");
    const now = new Date();
    let savedStudentNotes = 0;
    let savedOpportunityLogs = 0;

    // Use the exact standard reactivation sequence before applying the requested addition.
    for (const student of dismissed) {
      const chapter = student.activeChapter!;
      await tx.student.update({ where: { id: student.id }, data: { status: "نشط", dismissalType: "", dismissalReason: "", dismissalNotes: "", opportunities: 1 } });
      await tx.opportunityLog.createMany({ data: [
        { id: `bulk_reactivate_${randomUUID()}`, studentId: student.id, action: "إعادة تفعيل", amount: 0, requestedAmount: 0, appliedAmount: 0, balanceBefore: student.opportunities, balanceAfter: student.opportunities, reason: "إعادة تفعيل جماعية موثقة قبل إضافة الفرص", chapterId: chapter.id, chapterNameSnapshot: chapter.name, date: now },
        { id: `bulk_final_${randomUUID()}`, studentId: student.id, action: "فرصة أخيرة بعد تعهد", amount: 1, requestedAmount: 1, appliedAmount: 1, balanceBefore: 0, balanceAfter: 1, reason: "منح الفرصة الأخيرة المعتمدة بعد إعادة التفعيل الجماعية", chapterId: chapter.id, chapterNameSnapshot: chapter.name, date: now },
      ] });
      savedOpportunityLogs += 2;
      await tx.studentNote.create({ data: { studentId: student.id, kind: "إجراء", text: `إعادة تفعيل جماعية ومنح فرصة أخيرة قبل إضافة ${amount} فرصة. الفصل السابق: ${student.dismissalReason || student.dismissalType || "غير محدد"}`, date: now, sourceType: "bulk-opportunity-reactivation", sourceId: student.id } });
      savedStudentNotes += 1;
    }
    if (dismissed.length) await recalculateStudentsAcademicState(dismissed.map((student) => student.id), { tx });

    const beforeRows = (await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true, opportunities: true } })) as Array<{ id: string; opportunities: number }>;
    const beforeById = new Map<string, number>(beforeRows.map((row) => [row.id, row.opportunities]));
    const manualLogIds: string[] = [];
    for (const student of targets) {
      const chapter = student.activeChapter!;
      const id = `bulk_manual_${randomUUID()}`;
      manualLogIds.push(id);
      await tx.opportunityLog.create({ data: {
        id, studentId: student.id, action, amount, requestedAmount: amount, appliedAmount: null,
        balanceBefore: beforeById.get(student.id) ?? 0, balanceAfter: null,
        reason, date: now, chapterId: chapter.id, chapterNameSnapshot: chapter.name,
      } });
      savedOpportunityLogs += 1;
    }

    const academicRecalculation = await recalculateStudentsAcademicState(ids, { tx });
    const afterRows = (await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true, opportunities: true } })) as Array<{ id: string; opportunities: number }>;
    const afterById = new Map<string, number>(afterRows.map((row) => [row.id, row.opportunities]));
    const movementSummary: Array<{ studentId: string; requested: number; applied: number; before: number; after: number }> = [];
    for (let index = 0; index < targets.length; index += 1) {
      const student = targets[index];
      const before = beforeById.get(student.id) ?? 0;
      const after = afterById.get(student.id) ?? before;
      const applied = Math.abs(after - before);
      await tx.opportunityLog.update({ where: { id: manualLogIds[index] }, data: { amount: applied, appliedAmount: applied, balanceAfter: after } });
      movementSummary.push({ studentId: student.id, requested: amount, applied, before, after });
    }

    return {
      updatedStudents: academicRecalculation.students.length,
      savedOpportunityLogs, savedStudentNotes, totalMatching,
      eligibleWithActiveChapter: eligible.length, noActiveChapter, activeChapterConflicts,
      zeroOpportunityLimit, invalidOpportunitySource, targetCount,
      skipped: Math.max(0, totalMatching - targetCount), movementSummary, academicRecalculation,
    };
  }, { isolationLevel: "Serializable" }), "BulkOpportunityAdjustByFilter");

  if ((result as BulkAdjustConfirmation).confirmationRequired) {
    const confirmation = result as BulkAdjustConfirmation;
    return globalImpactConfirmationResponse(`عملية الفرص الجماعية ستؤثر على ${confirmation.targetCount} طالب. راجع المعاينة ثم أكد العملية.`, confirmation);
  }
  const success = result as BulkAdjustSuccess;
  await writeRequestAuditLog(req, "إدارة الفرص", "تنفيذ حركة فرص جماعية ذرية", {
    actionType, amount, reason, targetCount: success.targetCount,
    updatedStudents: success.updatedStudents, savedOpportunityLogs: success.savedOpportunityLogs,
    savedStudentNotes: success.savedStudentNotes, movementSummary: success.movementSummary,
    reactivateDismissedOnAdd,
  });
  return NextResponse.json({ ...success, source: "database" });
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.manage");
  if (authError) return authError;
  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.bulkOpportunities);
  if (rateLimitError) return rateLimitError;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.mode !== "filter") {
      return NextResponse.json({ error: "تم إيقاف الوضع الجماعي المباشر لأنه يسمح للعميل بإرسال حالة الطالب وسجلاته. استخدم mode=filter ليشتق الخادم كل التغييرات من قاعدة البيانات." }, { status: 410 });
    }
    return handleFilterBasedBulkAdjust(req, body);
  } catch (error) {
    return routeErrorResponse(error, error instanceof Error ? error.message : "تعذر تنفيذ العملية الجماعية.");
  }
}
