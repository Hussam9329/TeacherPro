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

    const result = await withFollowupTables(
      async () =>
        db.$transaction(async (tx) => {
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

          const resolvedStudentId = actionType === "undo" ? String(sourceLog!.studentId) : studentId;
          const student = await tx.student.findUnique({
            where: { id: resolvedStudentId },
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              courseId: true,
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
          const logAmount = actionType === "reset"
            ? Math.max(
                0,
                Math.trunc(
                  Number(student.baseOpportunities || activeChapterResult.activeLink.chapter.opportunities || 0),
                ),
              )
            : actionType === "undo"
              ? Math.max(1, Math.trunc(Number(sourceLog?.amount || 1)))
              : amount;
          const finalReason = actionType === "reset"
            ? reason || "إعادة تعيين الفرص من إدارة الفرص"
            : actionType === "undo"
              ? `تراجع موثق عن ${sourceLog?.action}: ${sourceLog?.reason || "بدون سبب"}`.slice(0, 2000)
              : reason;

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
        studentId: result.student?.id,
        studentName: result.student?.name,
        studentCode: result.student?.code,
        amount,
        reason,
        logId,
        createdLogId: result.opportunityLog.id,
        recalculatedStudents: result.academicRecalculation?.students?.length || 0,
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : "تعذر تنفيذ إجراء الفرص من النظام حالياً.";
    return routeErrorResponse(error, message);
  }
}
