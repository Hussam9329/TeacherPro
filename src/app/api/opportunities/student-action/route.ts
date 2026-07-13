export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withFollowupTables } from "@/lib/followup-schema";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

const MANUAL_ACTIONS = new Set(["إضافة", "خصم", "إعادة تعيين"]);

type OpportunityStudentAction = "add" | "deduct" | "reset" | "undo";

function normalizeAction(value: unknown): OpportunityStudentAction | null {
  if (value === "add" || value === "deduct" || value === "reset" || value === "undo") return value;
  return null;
}

function normalizePositiveAmount(value: unknown): number {
  const numeric = Number(value ?? 1);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.trunc(Math.abs(numeric)));
}

function normalizeReason(value: unknown, fallback = ""): string {
  return String(value ?? fallback).trim().slice(0, 2000);
}

async function getSingleActiveChapterForCourse(
  tx: Prisma.TransactionClient,
  courseId: string,
) {
  const activeLinks = await tx.courseChapter.findMany({
    where: { courseId, active: true, archived: false },
    select: {
      id: true,
      chapterId: true,
      chapter: { select: { id: true, name: true, opportunities: true } },
    },
    take: 3,
  });

  if (activeLinks.length === 0) {
    return {
      ok: false as const,
      message: "لا يمكن تعديل فرص هذا الطالب لأن دورته لا تحتوي على فصل نشط.",
      activeLink: null,
    };
  }

  if (activeLinks.length > 1) {
    return {
      ok: false as const,
      message:
        "لا يمكن تعديل الفرص لأن هذه الدورة تحتوي على أكثر من فصل نشط. أصلح الفصول أولاً حتى لا تتداخل الحسابات.",
      activeLink: null,
    };
  }

  const activeLink = activeLinks[0];
  const opportunities = Math.max(0, Math.trunc(Number(activeLink.chapter?.opportunities || 0)));
  if (!activeLink.chapter || opportunities <= 0) {
    return {
      ok: false as const,
      message:
        "الفصل النشط لهذه الدورة لا يحتوي على فرص صالحة. عدّل الفصل أو اختر فصلاً صحيحاً قبل إدارة الفرص.",
      activeLink: null,
    };
  }

  return { ok: true as const, message: "", activeLink };
}

function selectStudentForResponse() {
  return {
    id: true,
    name: true,
    school: true,
    gender: true,
    phone: true,
    parentPhone: true,
    telegram: true,
    courseProgram: true,
    courseTerm: true,
    studyType: true,
    locationScope: true,
    baghdadMode: true,
    courseId: true,
    mainSite: true,
    subSite: true,
    code: true,
    status: true,
    dismissalType: true,
    dismissalReason: true,
    dismissalNotes: true,
    createdAt: true,
    opportunities: true,
    baseOpportunities: true,
    accountingGraceDays: true,
  } as const;
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.manage");
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(
    req,
    API_RATE_LIMITS.studentOpportunitySync,
  );
  if (rateLimitError) return rateLimitError;

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const actionType = normalizeAction(body?.actionType);
    if (!actionType) return validationError("نوع إجراء الفرص غير صحيح.");

    const studentId = normalizeReason(body?.studentId, "");
    const logId = normalizeReason(body?.logId, "");
    const amount = normalizePositiveAmount(body?.amount);
    const reason = normalizeReason(body?.reason, "");

    if (actionType !== "undo" && !studentId) {
      return validationError("تعذر تحديد الطالب المطلوب.");
    }
    if ((actionType === "add" || actionType === "deduct") && !reason) {
      return validationError("يرجى إدخال سبب حركة الفرص.");
    }
    if (actionType === "undo" && !logId) {
      return validationError("تعذر تحديد حركة الفرص المطلوب التراجع عنها.");
    }

    // Q100 FIX: SERIALIZABLE isolation with retry on conflict.
    const result = await withFollowupTables(
      async () =>
        withSerializableTransaction(async (tx) => {
          const sourceLog = actionType === "undo"
            ? await tx.opportunityLog.findUnique({
                where: { id: logId },
                select: {
                  id: true,
                  studentId: true,
                  action: true,
                  amount: true,
                  reason: true,
                  chapterId: true,
                  chapterNameSnapshot: true,
                },
              })
            : null;

          if (actionType === "undo" && !sourceLog) {
            throw new Error("حركة الفرص المطلوبة غير موجودة أو تم حذفها.");
          }
          if (sourceLog && !MANUAL_ACTIONS.has(String(sourceLog.action || ""))) {
            throw new Error("يمكن التراجع فقط عن الحركات اليدوية من إدارة الفرص.");
          }
          if (sourceLog?.action === "إعادة تعيين") {
            throw new Error("إعادة التعيين لا تُعكس بحركة واحدة آمنة. استخدم إضافة أو خصم موثق بدل التراجع.");
          }

          // Q75 FIX: Prevent double-undo. Before creating an undo log,
          // search for any existing OpportunityLog for the same student
          // whose reason contains the marker `[undo-ref:${sourceLog.id}]`.
          // If found, the source log has already been reversed — refuse.
          //
          // We embed the source log ID in the undo log's reason text so we
          // can detect prior undos without requiring a schema migration
          // (no new column needed). The marker is stable and searchable.
          if (actionType === "undo" && sourceLog) {
            const undoMarker = `[undo-ref:${sourceLog.id}]`;
            const priorUndo = await tx.opportunityLog.findFirst({
              where: {
                studentId: sourceLog.studentId,
                reason: { contains: undoMarker },
              },
              select: { id: true, date: true, reason: true },
            });
            if (priorUndo) {
              throw new Error(
                "تم التراجع عن هذه الحركة مسبقاً. لا يمكن التراجع عن الحركة نفسها أكثر من مرة.",
              );
            }
          }

          const resolvedStudentId = actionType === "undo" ? String(sourceLog!.studentId) : studentId;
          const student = await tx.student.findUnique({
            where: { id: resolvedStudentId },
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              courseId: true,
              opportunities: true,
              baseOpportunities: true,
            },
          });
          if (!student) throw new Error("الطالب غير موجود أو تم حذفه.");
          if (student.status === "مؤرشف") {
            throw new Error("لا يمكن تعديل فرص طالب مؤرشف.");
          }

          const activeChapterResult = await getSingleActiveChapterForCourse(tx, student.courseId);
          if (!activeChapterResult.ok || !activeChapterResult.activeLink) {
            throw new Error(activeChapterResult.message);
          }

          const now = new Date();
          const action = actionType === "add" || (actionType === "undo" && sourceLog?.action === "خصم")
            ? "إضافة"
            : actionType === "deduct" || (actionType === "undo" && sourceLog?.action === "إضافة")
              ? "خصم"
              : "إعادة تعيين";

          // Q72+Q73+Q74 FIX: Log the ACTUAL applied amount, not the requested.
          // Previously, the log recorded the user's requested amount even if
          // clamping reduced it (e.g. add 5 to a student capped at 1 logged
          // "5" but the balance only went up by 1). This made the audit trail
          // contradict the actual balance.
          //
          // Compute the actual applied amount:
          //   - add: capped at (baseOpportunities - opportunities) — can't exceed ceiling
          //   - deduct: capped at opportunities — can't go below 0
          //   - reset: the new ceiling (no clamping needed, but we record
          //     before/after/delta in the reason for auditability)
          //   - undo: same as add/deduct based on the source action
          const currentOpportunities = Math.max(0, Math.trunc(Number(student.opportunities || 0)));
          const ceiling = Math.max(0, Math.trunc(Number(student.baseOpportunities || 0)));
          const chapterCeiling = Math.max(
            0,
            Math.trunc(Number(activeChapterResult.activeLink.chapter.opportunities || 0)),
          );

          let logAmount: number;
          let actualAppliedAmount: number;
          const balanceBefore: number = currentOpportunities;
          let balanceAfter: number;

          if (actionType === "reset") {
            logAmount = chapterCeiling;
            actualAppliedAmount = chapterCeiling - currentOpportunities; // delta (can be negative if current > ceiling)
            balanceAfter = chapterCeiling;
          } else if (actionType === "undo") {
            const undoAmount = Math.max(1, Math.trunc(Number(sourceLog?.amount || 1)));
            logAmount = undoAmount;
            if (action === "إضافة") {
              // Undo of a deduct = add back, capped at ceiling
              actualAppliedAmount = Math.min(undoAmount, Math.max(0, ceiling - currentOpportunities));
              balanceAfter = Math.min(ceiling, currentOpportunities + actualAppliedAmount);
            } else {
              // Undo of an add = deduct, capped at current
              actualAppliedAmount = Math.min(undoAmount, currentOpportunities);
              balanceAfter = Math.max(0, currentOpportunities - actualAppliedAmount);
            }
          } else if (actionType === "add") {
            logAmount = Math.max(0, Math.trunc(Number(amount || 0)));
            actualAppliedAmount = Math.min(logAmount, Math.max(0, ceiling - currentOpportunities));
            balanceAfter = Math.min(ceiling, currentOpportunities + actualAppliedAmount);
          } else {
            // deduct
            logAmount = Math.max(0, Math.trunc(Number(amount || 0)));
            actualAppliedAmount = Math.min(logAmount, currentOpportunities);
            balanceAfter = Math.max(0, currentOpportunities - actualAppliedAmount);
          }

          // Q74 FIX: For reset, embed before/after/delta in the reason text
          // so the audit trail shows the actual change (not just the target).
          // For add/deduct, embed the actual applied amount when it differs
          // from the requested amount (i.e. clamping occurred).
          // Q75 FIX: For undo, embed [undo-ref:${sourceLog.id}] marker so we
          // can detect prior undos and prevent double-undo.
          const finalReason = actionType === "reset"
            ? (reason || "إعادة تعيين الفرص من إدارة الفرص") +
              ` [قبل: ${balanceBefore} → بعد: ${balanceAfter}، فرق: ${actualAppliedAmount >= 0 ? "+" : ""}${actualAppliedAmount}]`
            : actionType === "undo"
              ? `تراجع موثق عن ${sourceLog?.action}: ${sourceLog?.reason || "بدون سبب"} [undo-ref:${sourceLog?.id}]`.slice(0, 2000)
              : (logAmount !== actualAppliedAmount
                ? `${reason || ""} [مطلوب: ${logAmount}، مطبّق: ${actualAppliedAmount}، قبل: ${balanceBefore} → بعد: ${balanceAfter}]`
                : reason);

          const createdLog = await tx.opportunityLog.create({
            data: {
              studentId: resolvedStudentId,
              examId: null,
              action,
              amount: logAmount,
              reason: finalReason,
              date: now,
              chapterId: activeChapterResult.activeLink.chapter.id,
              chapterNameSnapshot: activeChapterResult.activeLink.chapter.name,
            },
          });

          const academicRecalculation = await recalculateStudentsAcademicState(
            [resolvedStudentId],
            { tx },
          );
          const updatedStudent = await tx.student.findUnique({
            where: { id: resolvedStudentId },
            select: selectStudentForResponse(),
          });

          return {
            ok: true,
            student: updatedStudent,
            opportunityLog: createdLog,
            sourceLog,
            academicRecalculation,
            source: "database" as const,
          };
        }),
      "OpportunityStudentAction",
    );

    const [studentWithOpportunity] = result.student
      ? await attachStudentOpportunitySnapshots([result.student])
      : [null];
    const responseResult = {
      ...result,
      student: studentWithOpportunity,
    };

    await writeRequestAuditLog(
      req,
      "إدارة الفرص",
      actionType === "undo"
        ? "تراجع موثق عن حركة فرص وإعادة احتساب"
        : actionType === "reset"
          ? "إعادة تعيين فرص طالب وإعادة احتساب"
          : actionType === "deduct"
            ? "خصم فرصة يدوياً وإعادة احتساب"
            : "إضافة فرصة يدوياً وإعادة احتساب",
      {
        actionType,
        studentId: responseResult.student?.id,
        studentName: responseResult.student?.name,
        studentCode: responseResult.student?.code,
        amount,
        reason,
        logId,
        createdLogId: result.opportunityLog.id,
        recalculatedStudents: result.academicRecalculation?.students?.length || 0,
      },
    );

    return NextResponse.json(responseResult);
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : "تعذر تنفيذ إجراء الفرص من النظام حالياً.";
    return routeErrorResponse(error, message);
  }
}
