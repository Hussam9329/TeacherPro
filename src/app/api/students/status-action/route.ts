export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { ARCHIVED_STUDENT_STATUS } from "@/lib/student-delete-impact";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { migrateDismissedPendingGradesAfterActivation } from "@/lib/grade-smart-note-reactivation-server";
import { STUDENT_STATUS_DISMISSED } from "@/lib/student-status-enums";
import { REACTIVATION_OPPORTUNITY_GRANT } from "@/lib/opportunity-balance";
import {
  buildStudentMutationToken,
  withStudentMutationToken,
} from "@/lib/student-mutation-token";

type RegistryStatusAction = "dismiss" | "reactivate" | "restore";

type ActiveChapterSnapshot = {
  id: string;
  name: string;
  opportunities: number;
};

type ActiveChapterResolution =
  | { kind: "missing"; activeCount: 0 }
  | { kind: "conflict"; activeCount: number }
  | {
      kind: "zero-limit";
      activeCount: 1;
      chapter: ActiveChapterSnapshot;
      opportunities: 0;
    }
  | {
      kind: "ready";
      activeCount: 1;
      chapter: ActiveChapterSnapshot;
      opportunities: number;
    };

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

async function getActiveChapterForCourse(
  tx: Prisma.TransactionClient,
  courseId: string,
): Promise<ActiveChapterResolution> {
  const links = await tx.courseChapter.findMany({
    where: { courseId, active: true, archived: false },
    select: {
      chapter: { select: { id: true, name: true, opportunities: true } },
    },
  });

  if (links.length === 0) {
    return { kind: "missing", activeCount: 0 };
  }
  if (links.length > 1) {
    return { kind: "conflict", activeCount: links.length };
  }

  const chapter = links[0].chapter;
  const opportunities = Math.max(
    0,
    Math.trunc(Number(chapter.opportunities || 0)),
  );
  if (opportunities <= 0) {
    return {
      kind: "zero-limit",
      activeCount: 1,
      chapter,
      opportunities: 0,
    };
  }
  return {
    kind: "ready",
    activeCount: 1,
    chapter,
    opportunities,
  };
}

function chapterFromResolution(
  resolution: ActiveChapterResolution,
): ActiveChapterSnapshot | null {
  return resolution.kind === "ready" || resolution.kind === "zero-limit"
    ? resolution.chapter
    : null;
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

      const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
        result.student,
      ]);
      return NextResponse.json({
        ok: true,
        action,
        ...result,
        student: withStudentMutationToken(
          studentWithOpportunity as unknown as Record<string, unknown>,
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
        if (student.status !== ARCHIVED_STUDENT_STATUS) {
          throw statusActionConflict(
            "إجراء الاستعادة مخصص للطلاب المؤرشفين فقط. حدّث سجل الطالب ثم أعد المحاولة.",
            "not-archived",
          );
        }

        // The chapter state is authoritative only when read inside this same
        // serializable transaction. Never restore at a guessed zero balance:
        // the administrator must first resolve a missing, conflicting, or
        // zero-limit active chapter.
        const activeChapterResolution = await getActiveChapterForCourse(
          tx,
          student.courseId,
        );
        if (activeChapterResolution.kind === "missing") {
          throw statusActionConflict(
            "لا يمكن استعادة الطالب لأن دورته لا تحتوي على فصل نشط. فعّل فصلاً واحداً بفرص صالحة ثم أعد المحاولة.",
            "missing-active-chapter",
          );
        }
        if (activeChapterResolution.kind === "conflict") {
          throw statusActionConflict(
            `لا يمكن استعادة الطالب لأن دورته تحتوي على ${activeChapterResolution.activeCount} فصول نشطة متعارضة. أصلح التعارض واجعل فصلاً واحداً فقط نشطاً ثم أعد المحاولة.`,
            "conflicting-active-chapters",
          );
        }
        if (activeChapterResolution.kind === "zero-limit") {
          throw statusActionConflict(
            `لا يمكن استعادة الطالب لأن الفصل النشط «${activeChapterResolution.chapter.name}» سقف فرصه 0. عدّل فرص الفصل إلى قيمة صالحة ثم أعد المحاولة.`,
            "zero-opportunity-limit",
          );
        }

        const activeChapter = activeChapterResolution.chapter;
        const baseline = activeChapterResolution.opportunities;
        await tx.student.update({
          where: { id: studentId },
          data: {
            status: "نشط",
            dismissalReason: "",
            dismissalNotes: "",
            opportunities: baseline,
            baseOpportunities: baseline,
          },
        });

        const academicRecalculation = await recalculateStudentsAcademicState(
          [studentId],
          { tx },
        );
        const updatedStudent = await tx.student.findUniqueOrThrow({
          where: { id: studentId },
        });
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

      const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
        result.student,
      ]);
      return NextResponse.json({
        ok: true,
        action,
        ...result,
        student: withStudentMutationToken(
          studentWithOpportunity as unknown as Record<string, unknown>,
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
          amount: 0,
          reason: "تثبيت إعادة التفعيل: الطالب نشط برصيد فرصتين؛ الوصول إلى 0 لا يفصله، والمخالفة التالية وهو بدون فرص تؤدي إلى الفصل",
          chapterId: activeChapter?.id || null,
          chapterNameSnapshot: activeChapter?.name || null,
        },
      });

      const reactivationBalanceLog = await tx.opportunityLog.create({
        data: {
          studentId,
          examId: null,
          action: "رصيد إعادة التفعيل",
          amount: REACTIVATION_OPPORTUNITY_GRANT,
          reason: "إرجاع الطالب إلى الحالة النشطة برصيد فرصتين",
          chapterId: activeChapter?.id || null,
          chapterNameSnapshot: activeChapter?.name || null,
        },
      });

      const studentNote = await tx.studentNote.create({
        data: {
          studentId,
          kind: "إجراء",
          text: `إعادة تفعيل الطالب ومنحه فرصتين بعد فصل سابق: ${previousReason}`,
          sourceType: "student-status-action",
          sourceId: studentId,
        },
      });

      await tx.auditLog.create({
        data: {
          module: "سجل الطلاب",
          action: "إعادة تفعيل الطالب برصيد فرصتين",
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

    const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
      result.student,
    ]);
    return NextResponse.json({
      ok: true,
      action,
      ...result,
      student: withStudentMutationToken(
        studentWithOpportunity as unknown as Record<string, unknown>,
      ),
      source: "database",
    });
  } catch (error) {
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
