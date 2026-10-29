export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { studentsWithGracePeriodsForResponse } from "@/lib/grace-periods-server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { ARCHIVED_STUDENT_STATUS } from "@/lib/student-delete-impact";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { migrateDismissedPendingGradesAfterActivation } from "@/lib/grade-smart-note-reactivation-server";
import { STUDENT_STATUS_DISMISSED } from "@/lib/student-status-enums";
import { REACTIVATION_OPPORTUNITY_GRANT } from "@/lib/opportunity-balance";
import { restoreDismissedStudentManually, StudentActionError } from "@/lib/manual-student-restoration-server";
import { assertPledgeLimitNotReached } from "@/lib/pledge-limit-server";
import { PLEDGE_AUDIT_ACTION, PLEDGE_BALANCE_REASON } from "@/lib/pledge-limit";
import {
  chapterFromResolution,
  getActiveChapterForCourse,
  restoreArchivedStudentInTransaction,
} from "@/lib/student-archive-restore-server";
import {
  buildStudentMutationToken,
  withStudentMutationToken,
} from "@/lib/student-mutation-token";

type RegistryStatusAction = "dismiss" | "reactivate" | "restore";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function statusActionConflict(message: string, errorKind: string) {
  return Object.assign(new Error(message), {
    statusCode: 409 as const,
    errorKind,
  });
}

function assertExpectedStudentSnapshot(
  student: Record<string, unknown>,
  expectedStatus: string,
  expectedMutationToken: string,
) {
  if (expectedStatus && cleanText(student.status) !== expectedStatus) {
    throw statusActionConflict(
      `تغيرت حالة الطالب من «${expectedStatus}» إلى «${cleanText(student.status) || "غير محددة"}» بعد فتح الإجراء. حدّث السجل وراجع الحالة الجديدة.`,
      "stale-student-status",
    );
  }
  if (
    expectedMutationToken &&
    buildStudentMutationToken(student) !== expectedMutationToken
  ) {
    throw statusActionConflict(
      "تغيرت بيانات الطالب بعد فتح الإجراء. تم إيقاف التنفيذ قبل أي كتابة؛ حدّث السجل ثم أعد المحاولة.",
      "stale-student-snapshot",
    );
  }
}

function prismaErrorResponse(error: unknown) {
  const prismaError = error as { code?: string };
  if (prismaError.code === "P2025") {
    return NextResponse.json(
      { error: "تعذر العثور على الطالب المطلوب. حدّث الصفحة ثم حاول مرة أخرى." },
      { status: 404 },
    );
  }
  console.error("[API] /api/students/status-action error:", error);
  return NextResponse.json(
    { error: "تعذر تنفيذ إجراء حالة الطالب حالياً. حاول مرة أخرى." },
    { status: 500 },
  );
}

export async function POST(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "students.edit");
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  const body = await req.json().catch(() => ({}));
  const action = cleanText(body.action) as RegistryStatusAction;
  const studentId = cleanText(body.studentId || body.id);
  const expectedStatus = cleanText(body.expectedStatus);
  const expectedMutationToken = cleanText(body.expectedMutationToken);
  const reactivationMode = cleanText(body.reactivationMode);

  if (!studentId) {
    return NextResponse.json(
      { error: "تعذر تحديد الطالب المطلوب" },
      { status: 400 },
    );
  }
  if (action !== "dismiss" && action !== "reactivate" && action !== "restore") {
    return NextResponse.json(
      { error: "إجراء حالة الطالب غير معروف" },
      { status: 400 },
    );
  }
  if (reactivationMode && (action !== "reactivate" || !["manual", "pledge"].includes(reactivationMode))) {
    return NextResponse.json({ error: "نوع استعادة الطالب غير صحيح." }, { status: 400 });
  }

  try {
    if (action === "dismiss") {
      const reason = cleanText(body.reason);
      const notes = cleanText(body.notes);
      if (!reason) {
        return NextResponse.json(
          { error: "يرجى إدخال سبب الفصل" },
          { status: 400 },
        );
      }


      const result = await withSerializableTransaction(async (tx) => {
        const student = await tx.student.findUnique({ where: { id: studentId } });
        if (!student) throw Object.assign(new Error("student not found"), { code: "P2025" });
        assertExpectedStudentSnapshot(
          student as unknown as Record<string, unknown>,
          expectedStatus,
          expectedMutationToken,
        );
        if (student.status === ARCHIVED_STUDENT_STATUS) {
          throw statusActionConflict(
            "لا يمكن فصل طالب مؤرشف. استعده أولاً ثم نفّذ إجراء الفصل.",
            "archived-dismissal",
          );
        }

        // Q79 FIX: Prevent dismissing an already-dismissed student.
        // Previously, dismissing a dismissed student created duplicate
        // deduction logs (second with amount 0) and duplicate dismissal
        // notes. Dismissal has one state only; previous dismissal history never
        // changes the kind or severity of the next dismissal.
        if (student.status === STUDENT_STATUS_DISMISSED) {
          throw statusActionConflict(
            "الطالب مفصول مسبقاً. لا يمكن تكرار إجراء الفصل. استخدم إعادة التفعيل عند الحاجة.",
            "already-dismissed",
          );
        }

        const nextReason = reason;
        const deductedOpportunities = Math.max(0, Math.trunc(Number(student.opportunities || 0)));
        const activeChapterResolution = await getActiveChapterForCourse(
          tx,
          student.courseId,
        );
        const activeChapter = chapterFromResolution(activeChapterResolution);

        const updatedStudent = await tx.student.update({
          where: { id: studentId },
          data: {
            status: "مفصول",
            dismissalReason: nextReason,
            dismissalNotes: notes,
            opportunities: 0,
          },
        });

        const opportunityLog = deductedOpportunities > 0
          ? await tx.opportunityLog.create({
              data: {
                studentId,
                examId: null,
                action: "خصم",
                amount: deductedOpportunities,
                reason: `فصل الطالب: ${nextReason}`,
                chapterId: activeChapter?.id || null,
                chapterNameSnapshot: activeChapter?.name || null,
              },
            })
          : null;

        const studentNote = await tx.studentNote.create({
          data: {
            studentId,
            kind: "إجراء",
            text: `فصل الطالب: ${nextReason}${notes ? ` - ملاحظة: ${notes}` : ""}`,
            sourceType: "student-status-action",
            sourceId: studentId,
            dismissalReason: nextReason,
            dismissalDate: new Date(),
          },
        });

        await tx.auditLog.create({
          data: {
            module: "سجل الطلاب",
            action: "فصل الطالب",
            details: `${student.name} - ${student.code} - ${nextReason}`,
            userId: principal.id,
            userName: principal.name,
          },
        });

        return { student: updatedStudent, opportunityLogs: [opportunityLog].filter(Boolean), studentNotes: [studentNote] };
      });

      const [studentWithOpportunity] = await studentsWithGracePeriodsForResponse(
      await attachStudentOpportunitySnapshots([
        result.student,
      ]),
    );
      return NextResponse.json({
        ok: true,
        action,
        ...result,
        student: withStudentMutationToken(
          studentWithOpportunity as unknown as Record<string, unknown>,
          result.student as unknown as Record<string, unknown>,
        ),
        source: "database",
      });
    }

    if (action === "restore") {
      const result = await withSerializableTransaction(async (tx) => {
        const student = await tx.student.findUnique({ where: { id: studentId } });
        if (!student) throw Object.assign(new Error("student not found"), { code: "P2025" });
        assertExpectedStudentSnapshot(
          student as unknown as Record<string, unknown>,
          expectedStatus,
          expectedMutationToken,
        );
        const {
          updatedStudent,
          activeChapter,
          baseline,
          academicRecalculation,
        } = await restoreArchivedStudentInTransaction(tx, student);
        const studentNote = await tx.studentNote.create({
          data: {
            studentId,
            kind: "استعادة",
            text: `استعادة الطالب من الأرشيف وإعادة احتساب ملفه حسب الفصل النشط: ${activeChapter.name}`,
            sourceType: "student-archive-restore",
            sourceId: studentId,
          },
        });
        await tx.auditLog.create({
          data: {
            module: "سجل الطلاب",
            action: "استعادة طالب من الأرشيف",
            details: `${student.name} - ${student.code} - رصيد ${updatedStudent.opportunities}/${updatedStudent.baseOpportunities}`,
            userId: principal.id,
            userName: principal.name,
          },
        });
        return {
          student: updatedStudent,
          studentNotes: [studentNote],
          opportunityLogs: academicRecalculation.automaticOpportunityLogs,
          academicRecalculation,
          impact: {
            previousStatus: ARCHIVED_STUDENT_STATUS,
            nextStatus: updatedStudent.status,
            activeChapterId: activeChapter.id,
            activeChapterName: activeChapter.name,
            restoredOpportunityLimit: baseline,
            resultingOpportunities: updatedStudent.opportunities,
            resultingBaseOpportunities: updatedStudent.baseOpportunities,
          },
        };
      });

      const [studentWithOpportunity] = await studentsWithGracePeriodsForResponse(
      await attachStudentOpportunitySnapshots([
        result.student,
      ]),
    );
      return NextResponse.json({
        ok: true,
        action,
        ...result,
        student: withStudentMutationToken(
          studentWithOpportunity as unknown as Record<string, unknown>,
          result.student as unknown as Record<string, unknown>,
        ),
        source: "database",
      });
    }

    const result = await withSerializableTransaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw Object.assign(new Error("student not found"), { code: "P2025" });
      assertExpectedStudentSnapshot(
        student as unknown as Record<string, unknown>,
        expectedStatus,
        expectedMutationToken,
      );
      // Both ways of «إرجاع الطالب» close after two pledges in the chapter.
      if (student.status === STUDENT_STATUS_DISMISSED) {
        await assertPledgeLimitNotReached(tx, student);
      }
      if (reactivationMode === "manual") {
        return restoreDismissedStudentManually(tx, {
          studentId, amount: body.amount, reason: cleanText(body.reason),
          actor: { id: principal.id, name: principal.name },
        });
      }
      if (student.status === ARCHIVED_STUDENT_STATUS) {
        throw statusActionConflict(
          "الطالب مؤرشف. استخدم إجراء «استعادة من الأرشيف»؛ إعادة تفعيل المفصولين لا تستعيد المؤرشفين.",
          "archived-reactivation",
        );
      }
      if (student.status === "نشط") {
        throw statusActionConflict(
          "الطالب نشط حالياً ولا يحتاج إلى إعادة تفعيل. تم منع إنشاء سجل أو ملاحظة مكررة.",
          "already-active",
        );
      }
      if (student.status !== STUDENT_STATUS_DISMISSED) {
        throw statusActionConflict(
          `لا يمكن إعادة تفعيل الطالب لأن حالته الحالية «${student.status || "غير محددة"}» ليست حالة فصل معتمدة.`,
          "invalid-reactivation-status",
        );
      }

      const activeChapterResolution = await getActiveChapterForCourse(
        tx,
        student.courseId,
      );
      if (
        activeChapterResolution.kind !== "ready" ||
        activeChapterResolution.opportunities <
          REACTIVATION_OPPORTUNITY_GRANT
      ) {
        throw statusActionConflict(
          "لا يمكن إعادة تفعيل الطالب بفرصتين قبل تثبيت فصل نشط واحد سقفه فرصتان على الأقل.",
          "insufficient-reactivation-opportunity-limit",
        );
      }
      const activeChapter = chapterFromResolution(activeChapterResolution);
      const previousReason = student.dismissalReason || "بدون سبب مسجل";

      const updatedStudent = await tx.student.update({
        where: { id: studentId },
        data: {
          status: "نشط",
          dismissalReason: "",
          dismissalNotes: "",
          opportunities: REACTIVATION_OPPORTUNITY_GRANT,
        },
      });

      const pendingGradeMigration =
        await migrateDismissedPendingGradesAfterActivation(
          tx,
          studentId,
          { id: principal.id, name: principal.name },
        );

      const reactivationLog = await tx.opportunityLog.create({
        data: {
          studentId,
          examId: null,
          action: "إعادة تفعيل",
          ledgerVersion: 2,
          amount: 0,
          reason: "تثبيت إعادة التفعيل بعد تعهد الطالب: الطالب نشط برصيد فرصتين؛ الوصول إلى 0 لا يفصله، والمخالفة التالية وهو بدون فرص تؤدي إلى الفصل",
          chapterId: activeChapter?.id || null,
          chapterNameSnapshot: activeChapter?.name || null,
        },
      });

      const reactivationBalanceLog = await tx.opportunityLog.create({
        data: {
          studentId,
          examId: null,
          action: "رصيد إعادة التفعيل",
          ledgerVersion: 2,
          settledGradeIds: JSON.stringify((await tx.grade.findMany({ where: { studentId }, select: { id: true } })).map(grade => grade.id)),
          amount: REACTIVATION_OPPORTUNITY_GRANT,
          reason: PLEDGE_BALANCE_REASON,
          chapterId: activeChapter?.id || null,
          chapterNameSnapshot: activeChapter?.name || null,
        },
      });

      const studentNote = await tx.studentNote.create({
        data: {
          studentId,
          kind: "إجراء",
          text: `تم تعهد الطالب: إعادة تفعيله بفرصتين بعد فصل سابق: ${previousReason}`,
          sourceType: "student-status-action",
          sourceId: studentId,
        },
      });

      await tx.auditLog.create({
        data: {
          module: "سجل الطلاب",
          action: PLEDGE_AUDIT_ACTION,
          details: `${student.name} - ${student.code}`,
          userId: principal.id,
          userName: principal.name,
        },
      });

      return {
        student: updatedStudent,
        opportunityLogs: [reactivationLog, reactivationBalanceLog],
        studentNotes: [studentNote],
        pendingGradeMigration,
      };
    });

    const [studentWithOpportunity] = await studentsWithGracePeriodsForResponse(
      await attachStudentOpportunitySnapshots([
      result.student,
    ]),
    );
    return NextResponse.json({
      ok: true,
      action,
      ...result,
      student: withStudentMutationToken(
        studentWithOpportunity as unknown as Record<string, unknown>,
        result.student as unknown as Record<string, unknown>,
      ),
      source: "database",
    });
  } catch (error) {
    if (error instanceof StudentActionError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const err = error as {
      statusCode?: number;
      message?: string;
      errorKind?: string;
    };
    if (err.statusCode === 409) {
      return NextResponse.json(
        {
          error:
            cleanText(err.message) ||
            "تغيرت حالة الطالب أو الفصل المرتبط به. حدّث الصفحة ثم أعد المحاولة.",
          errorKind: err.errorKind || "status-conflict",
        },
        { status: 409 },
      );
    }
    return prismaErrorResponse(error);
  }
}
