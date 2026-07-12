export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { ARCHIVED_STUDENT_STATUS } from "@/lib/student-delete-impact";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { lockStudentsAcademicState } from "@/lib/academic-student-lock-server";

type RegistryStatusAction = "dismiss" | "reactivate" | "restore";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
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
) {
  const links = await tx.courseChapter.findMany({
    where: { courseId, active: true, archived: false },
    select: {
      chapter: { select: { id: true, name: true, opportunities: true } },
    },
  });
  if (links.length !== 1) return null;
  return links[0].chapter;
}

export async function POST(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "students.edit");
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  const body = await req.json().catch(() => ({}));
  const action = cleanText(body.action) as RegistryStatusAction;
  const studentId = cleanText(body.studentId || body.id);

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
      const requestedType = cleanText(body.dismissalType || body.type) || "فصل مؤقت";
      if (!new Set(["فصل مؤقت", "فصل نهائي"]).has(requestedType)) {
        return NextResponse.json({ error: "نوع الفصل غير معروف." }, { status: 400 });
      }
      const reason = cleanText(body.reason);
      const notes = cleanText(body.notes);
      if (!reason) {
        return NextResponse.json(
          { error: "يرجى إدخال سبب الفصل" },
          { status: 400 },
        );
      }

      const result = await withSerializableTransaction(async (tx) => {
        await lockStudentsAcademicState(tx, [studentId]);
        const student = await tx.student.findUnique({ where: { id: studentId } });
        if (!student) throw Object.assign(new Error("student not found"), { code: "P2025" });
        if (student.status === "مفصول") {
          throw Object.assign(new Error("student already dismissed"), { statusCode: 409, errorKind: "already-dismissed" });
        }
        if (student.status === ARCHIVED_STUDENT_STATUS) {
          throw Object.assign(new Error("archived student cannot be dismissed"), { statusCode: 409 });
        }

        const hasFinalChance = Boolean(
          await tx.opportunityLog.findFirst({
            where: { studentId, action: "فرصة أخيرة بعد تعهد" },
            select: { id: true },
          }),
        );
        const nextType = hasFinalChance && requestedType === "فصل مؤقت" ? "فصل نهائي" : requestedType;
        const nextReason =
          hasFinalChance && requestedType === "فصل مؤقت"
            ? `عدم الالتزام بالتعهد السابق - ${reason}`
            : reason;
        const deductedOpportunities = Math.max(0, Math.trunc(Number(student.opportunities || 0)));
        const activeChapter = await getActiveChapterForCourse(tx, student.courseId);

        const updatedStudent = await tx.student.update({
          where: { id: studentId },
          data: {
            status: "مفصول",
            dismissalType: nextType,
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
                requestedAmount: deductedOpportunities,
                appliedAmount: deductedOpportunities,
                balanceBefore: deductedOpportunities,
                balanceAfter: 0,
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
            text: `فصل الطالب (${nextType}): ${nextReason}${notes ? ` - ملاحظة: ${notes}` : ""}`,
            sourceType: "student-status-action",
            sourceId: studentId,
            dismissalType: nextType,
            dismissalReason: nextReason,
            dismissalDate: new Date(),
          },
        });

        await tx.auditLog.create({
          data: {
            module: "سجل الطلاب",
            action: `فصل الطالب (${nextType})`,
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
        student: studentWithOpportunity,
        source: "database",
      });
    }

    if (action === "restore") {
      const result = await withSerializableTransaction(async (tx) => {
        await lockStudentsAcademicState(tx, [studentId]);
        const student = await tx.student.findUnique({ where: { id: studentId } });
        if (!student) throw Object.assign(new Error("student not found"), { code: "P2025" });
        if (student.status !== ARCHIVED_STUDENT_STATUS) {
          throw Object.assign(new Error("student is not archived"), { statusCode: 409 });
        }

        const activeChapter = await getActiveChapterForCourse(tx, student.courseId);
        const baseline = Math.max(0, Math.trunc(Number(activeChapter?.opportunities || 0)));
        await tx.student.update({
          where: { id: studentId },
          data: {
            status: "نشط",
            dismissalType: "",
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
            text: activeChapter
              ? `استعادة الطالب من الأرشيف وإعادة احتساب ملفه حسب الفصل النشط: ${activeChapter.name}`
              : "استعادة الطالب من الأرشيف بدون فصل نشط؛ بدأ برصيد 0 لحين تفعيل فصل",
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
          warning: activeChapter
            ? null
            : "لا يوجد فصل نشط للدورة؛ تمت الاستعادة برصيد 0.",
        };
      });

      const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
        result.student,
      ]);
      return NextResponse.json({
        ok: true,
        action,
        ...result,
        student: studentWithOpportunity,
        source: "database",
      });
    }

    const result = await withSerializableTransaction(async (tx) => {
      await lockStudentsAcademicState(tx, [studentId]);
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw Object.assign(new Error("student not found"), { code: "P2025" });
      if (student.status === ARCHIVED_STUDENT_STATUS) {
        throw Object.assign(new Error("archived student must be restored explicitly"), { statusCode: 409, errorKind: "archived-reactivation" });
      }
      if (student.status !== "مفصول") {
        throw Object.assign(new Error("student is not dismissed"), { statusCode: 409, errorKind: "not-dismissed" });
      }

      const shouldGrantFinalChance = true;
      const activeChapter = await getActiveChapterForCourse(tx, student.courseId);
      const previousReason = student.dismissalReason || student.dismissalType || "بدون سبب مسجل";

      const updatedStudent = await tx.student.update({
        where: { id: studentId },
        data: {
          status: "نشط",
          dismissalType: "",
          dismissalReason: "",
          dismissalNotes: "",
          ...(shouldGrantFinalChance ? { opportunities: 1 } : {}),
        },
      });

      const reactivationLog = await tx.opportunityLog.create({
        data: {
          studentId,
          examId: null,
          action: "إعادة تفعيل",
          amount: 0,
          requestedAmount: 0,
          appliedAmount: 0,
          balanceBefore: Math.max(0, Math.trunc(Number(student.opportunities || 0))),
          balanceAfter: Math.max(0, Math.trunc(Number(student.opportunities || 0))),
          reason: "تثبيت إعادة التفعيل: لا يعاد فصل الطالب بسبب سجلات قديمة، وأي إجراء جديد بعد الفرصة يصبح نهائياً",
          chapterId: activeChapter?.id || null,
          chapterNameSnapshot: activeChapter?.name || null,
        },
      });

      const finalChanceLog = shouldGrantFinalChance
        ? await tx.opportunityLog.create({
            data: {
              studentId,
              examId: null,
              action: "فرصة أخيرة بعد تعهد",
              amount: 1,
              requestedAmount: 1,
              appliedAmount: 1,
              balanceBefore: 0,
              balanceAfter: 1,
              reason: "إرجاع الطالب بعد إعادة التفعيل بفرصة واحدة فقط",
              chapterId: activeChapter?.id || null,
              chapterNameSnapshot: activeChapter?.name || null,
            },
          })
        : null;

      const studentNote = await tx.studentNote.create({
        data: {
          studentId,
          kind: "إجراء",
          text: shouldGrantFinalChance
            ? `إعادة تفعيل الطالب ومنحه فرصة واحدة بعد الفصل السابق: ${previousReason}`
            : student.status === ARCHIVED_STUDENT_STATUS
              ? "استعادة الطالب من الأرشيف"
              : "إعادة تفعيل الطالب",
          sourceType: "student-status-action",
          sourceId: studentId,
        },
      });

      await tx.auditLog.create({
        data: {
          module: "سجل الطلاب",
          action: shouldGrantFinalChance ? "إعادة تفعيل بفرصة واحدة" : "إعادة تفعيل طالب",
          details: `${student.name} - ${student.code}`,
          userId: principal.id,
          userName: principal.name,
        },
      });

      return {
        student: updatedStudent,
        opportunityLogs: [reactivationLog, finalChanceLog].filter(Boolean),
        studentNotes: [studentNote],
      };
    });

    const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
      result.student,
    ]);
    return NextResponse.json({
      ok: true,
      action,
      ...result,
      student: studentWithOpportunity,
      source: "database",
    });
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    if (err.statusCode === 409) {
      const errorKind = (error as { errorKind?: string }).errorKind;
      return NextResponse.json(
        {
          error:
            errorKind === "already-dismissed"
              ? "الطالب مفصول أصلاً. لا يمكن إنشاء حركة فصل وملاحظة مكررتين."
              : errorKind === "archived-reactivation"
              ? "الطالب مؤرشف. استخدم إجراء «استعادة من الأرشيف»؛ إعادة تفعيل المفصولين لا تستعيد المؤرشفين."
              : action === "restore"
                ? "إجراء الاستعادة مخصص للطلاب المؤرشفين فقط."
                : "لا يمكن فصل طالب مؤرشف. استعده أولاً ثم نفّذ الإجراء المطلوب.",
        },
        { status: 409 },
      );
    }
    return prismaErrorResponse(error);
  }
}
