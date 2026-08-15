export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withFollowupTables } from "@/lib/followup-schema";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { lockStudentsAcademicState } from "@/lib/academic-student-lock-server";

const REVERSIBLE_MANUAL_ACTIONS = new Set(["إضافة", "خصم"]);

function isReversibleManualOpportunityLog(log: {
  action: string;
  reason: string | null;
  reversalOfLogId: string | null;
}): boolean {
  return (
    REVERSIBLE_MANUAL_ACTIONS.has(log.action) &&
    !log.reversalOfLogId &&
    !String(log.reason || "").trim().startsWith("فصل الطالب:")
  );
}

type OpportunityStudentAction = "add" | "deduct" | "reset" | "undo";

function normalizeAction(value: unknown): OpportunityStudentAction | null {
  return value === "add" || value === "deduct" || value === "reset" || value === "undo" ? value : null;
}

function positiveInteger(value: unknown, label: string): number {
  const numeric = Number(value ?? 1);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error(`${label} يجب أن يكون عدداً صحيحاً موجباً.`);
  return numeric;
}

function text(value: unknown, max = 2000): string {
  return String(value ?? "").trim().slice(0, max);
}

async function getSingleActiveChapterForCourse(tx: Prisma.TransactionClient, courseId: string) {
  const links = await tx.courseChapter.findMany({
    where: { courseId, active: true, archived: false },
    select: { chapter: { select: { id: true, name: true, opportunities: true } } },
    take: 3,
  });
  if (links.length !== 1 || !links[0].chapter) {
    throw new Error(links.length === 0
      ? "لا يمكن تعديل الفرص لأن دورة الطالب لا تحتوي على فصل نشط واحد."
      : "لا يمكن تعديل الفرص بسبب تعارض الفصول النشطة في دورة الطالب.");
  }
  const cap = Number(links[0].chapter.opportunities);
  if (!Number.isInteger(cap) || cap < 0) throw new Error("سقف فرص الفصل النشط غير صالح.");
  return { ...links[0].chapter, opportunities: cap };
}


type StudentActionResult = {
  student: Record<string, unknown> & {
    id: string;
    name: string;
    courseId: string;
    opportunities: number;
    baseOpportunities: number;
  };
  opportunityLog: {
    requestedAmount: number | null;
    appliedAmount: number | null;
    balanceBefore: number | null;
    balanceAfter: number | null;
    reversalOfLogId: string | null;
  };
  sourceLog: unknown;
  academicRecalculation: unknown;
};

const studentSelect = {
  id: true, name: true, school: true, gender: true, phone: true, parentPhone: true,
  telegram: true, courseProgram: true, courseTerm: true, studyType: true,
  locationScope: true, baghdadMode: true, courseId: true, mainSite: true,
  subSite: true, code: true, status: true, dismissalType: true,
  dismissalReason: true, dismissalNotes: true, createdAt: true,
  opportunities: true, baseOpportunities: true, accountingGraceDays: true,
} as const;

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.manage");
  if (authError) return authError;
  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.studentOpportunitySync);
  if (rateLimitError) return rateLimitError;

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const actionType = normalizeAction(body?.actionType);
    if (!actionType) return validationError("نوع إجراء الفرص غير صحيح.");
    const requestedStudentId = text(body?.studentId, 120);
    const logId = text(body?.logId, 120);
    const reason = text(body?.reason);
    if (actionType !== "undo" && !requestedStudentId) return validationError("تعذر تحديد الطالب المطلوب.");
    if ((actionType === "add" || actionType === "deduct") && !reason) return validationError("يرجى إدخال سبب حركة الفرص.");
    if (actionType === "undo" && !logId) return validationError("تعذر تحديد الحركة المطلوب التراجع عنها.");
    const requestedAmount = actionType === "reset" || actionType === "undo" ? 0 : positiveInteger(body?.amount, "عدد الفرص");

    const result = await withFollowupTables<StudentActionResult>(() => db.$transaction(async (tx) => {
      const sourceLog = actionType === "undo" ? await tx.opportunityLog.findUnique({
        where: { id: logId },
        select: { id: true, studentId: true, action: true, amount: true, appliedAmount: true, reason: true, reversalOfLogId: true },
      }) : null;
      if (actionType === "undo" && !sourceLog) throw new Error("حركة الفرص المطلوبة غير موجودة.");
      if (sourceLog && !isReversibleManualOpportunityLog(sourceLog)) {
        throw new Error(
          sourceLog.reversalOfLogId
            ? "لا يمكن التراجع عن حركة تراجع سابقة."
            : "يمكن التراجع فقط عن الإضافة أو الخصم اليدوي، ولا يمكن عكس حركة الفصل أو الحركة التلقائية.",
        );
      }
      if (sourceLog) {
        const previousUndo = await tx.opportunityLog.findUnique({ where: { reversalOfLogId: sourceLog.id }, select: { id: true } });
        if (previousUndo) throw new Error("تم التراجع عن هذه الحركة سابقاً ولا يمكن عكسها مرة ثانية.");
      }

      const studentId = sourceLog?.studentId || requestedStudentId;
      await lockStudentsAcademicState(tx, [studentId]);
      const student = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, name: true, code: true, status: true, courseId: true, opportunities: true } });
      if (!student) throw new Error("الطالب غير موجود أو تم حذفه.");
      if (student.status === "مؤرشف") throw new Error("لا يمكن تعديل فرص طالب مؤرشف.");
      const chapter = await getSingleActiveChapterForCourse(tx, student.courseId);
      const balanceBefore = Math.max(0, Number(student.opportunities || 0));

      const action = actionType === "add" || (actionType === "undo" && sourceLog?.action === "خصم")
        ? "إضافة" : actionType === "deduct" || (actionType === "undo" && sourceLog?.action === "إضافة")
          ? "خصم" : "إعادة تعيين";
      const desiredAmount = actionType === "reset"
        ? chapter.opportunities
        : actionType === "undo"
          ? Math.max(0, Number(sourceLog?.appliedAmount ?? sourceLog?.amount ?? 0))
          : requestedAmount;
      if (actionType === "undo" && desiredAmount <= 0) throw new Error("الحركة الأصلية لم تطبق أي فرق فعلي، لذلك لا يوجد شيء يمكن التراجع عنه.");

      const created = await tx.opportunityLog.create({
        data: {
          studentId, examId: null, action,
          amount: desiredAmount,
          requestedAmount: desiredAmount,
          appliedAmount: null,
          balanceBefore,
          balanceAfter: null,
          reversalOfLogId: sourceLog?.id || null,
          reason: actionType === "reset"
            ? reason || "إعادة تعيين الفرص من إدارة الفرص"
            : actionType === "undo"
              ? `تراجع موثق عن ${sourceLog?.action}: ${sourceLog?.reason || "بدون سبب"}`
              : reason,
          chapterId: chapter.id,
          chapterNameSnapshot: chapter.name,
        },
      });

      const academicRecalculation = await recalculateStudentsAcademicState([studentId], { tx });
      const updatedStudent = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: studentSelect });
      const balanceAfter = Math.max(0, Number(updatedStudent.opportunities || 0));
      const appliedAmount = Math.abs(balanceAfter - balanceBefore);
      const opportunityLog = await tx.opportunityLog.update({
        where: { id: created.id },
        data: {
          // Addition/deduction logs must describe the actual applied movement. Reset amount remains target balance for engine semantics.
          ...(action !== "إعادة تعيين" ? { amount: appliedAmount } : {}),
          appliedAmount,
          balanceAfter,
        },
      });
      return { student: updatedStudent, opportunityLog, sourceLog, academicRecalculation };
    }, { isolationLevel: "Serializable" }), "OpportunityStudentAction");

    const [student] = await attachStudentOpportunitySnapshots([result.student]);
    await writeRequestAuditLog(req, "إدارة الفرص", "تنفيذ حركة فرص ذرية", {
      actionType, studentId: student.id, studentName: student.name,
      requestedAmount: result.opportunityLog.requestedAmount,
      appliedAmount: result.opportunityLog.appliedAmount,
      balanceBefore: result.opportunityLog.balanceBefore,
      balanceAfter: result.opportunityLog.balanceAfter,
      reversalOfLogId: result.opportunityLog.reversalOfLogId,
    });
    return NextResponse.json({ ok: true, ...result, student, source: "database" as const });
  } catch (error) {
    return routeErrorResponse(error, error instanceof Error ? error.message : "تعذر تنفيذ إجراء الفرص.");
  }
}
