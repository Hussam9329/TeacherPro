export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import {
  requireText,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import { ensureExamSchema } from "@/lib/exam-schema";
import {
  AcademicGradeWritebackError,
  hasAcademicGradeWritebackPayload,
  readAcademicGradeWritebackScore,
  readAcademicGradeWritebackStatus,
  syncAcademicGradeWriteback,
} from "@/lib/academic-grade-writeback-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

function validateCorrectionSheetPayload(body: Record<string, unknown>) {
  const studentError = requireText(body.studentId, "الطالب");
  if (studentError) return studentError;
  const examError = requireText(body.examId, "الامتحان");
  if (examError) return examError;
  const correctorError = requireText(body.correctorId, "المصحح");
  if (correctorError) return correctorError;
  return null;
}

function normalizeDateOrNull(value: unknown): Date | null {
  if (value === undefined) return null;
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function correctionSheetCreateData(body: Record<string, unknown>) {
  return {
    status: String(body.status || "قيد التصحيح"),
    startedAt: body.startedAt ? new Date(String(body.startedAt)) : undefined,
    finishedAt: body.finishedAt ? new Date(String(body.finishedAt)) : undefined,
    correctionErrors: Number(body.correctionErrors || 0),
    sumErrors: Number(body.sumErrors || 0),
    studentId: String(body.studentId),
    examId: String(body.examId),
    correctorId: String(body.correctorId),
  };
}

function correctionSheetUpdateData(body: Record<string, unknown>) {
  const data: Record<string, string | number | Date | null> = {};
  if (body.status !== undefined)
    data.status = String(body.status || "قيد التصحيح");
  if (body.startedAt !== undefined)
    data.startedAt = normalizeDateOrNull(body.startedAt);
  if (body.finishedAt !== undefined)
    data.finishedAt = normalizeDateOrNull(body.finishedAt);
  if (body.correctionErrors !== undefined)
    data.correctionErrors = Number(body.correctionErrors);
  if (body.sumErrors !== undefined) data.sumErrors = Number(body.sumErrors);
  if (body.correctorId !== undefined)
    data.correctorId = String(body.correctorId);
  return data;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "correction.view");
  if (authError) return authError;

  try {
    await ensureExamSchema();
    const { parsePagination } = await import("@/lib/pagination");
    const { page, limit, skip } = parsePagination(req);
    const [correctionSheets, totalCount] = await Promise.all([
      db.correctionSheet.findMany({
        orderBy: { startedAt: "desc" },
        include: { student: true, exam: true, corrector: true },
        skip,
        take: limit,
      }),
      db.correctionSheet.count(),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    return NextResponse.json({
      correctionSheets,
      total: totalCount,
      totalCount,
      page,
      limit,
      pageSize: limit,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل أوراق التصحيح حالياً.");
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "correction.manage");
  if (authError) return authError;

  try {
    const body = await req.json();
    const validationMessage = validateCorrectionSheetPayload(body);
    if (validationMessage) return validationError(validationMessage);
    const existing = await db.correctionSheet.findUnique({
      where: {
        studentId_examId: {
          studentId: String(body.studentId),
          examId: String(body.examId),
        },
      },
    });
    if (existing)
      return validationError(
        "توجد ورقة تصحيح مسجلة لهذا الطالب في نفس الامتحان",
        409,
      );
    // Q100 FIX: SERIALIZABLE isolation with retry on conflict.
    const result = await withSerializableTransaction(async (tx) => {
      const correctionSheet = await tx.correctionSheet.create({
        data: correctionSheetCreateData(body),
      });
      const gradeWriteback = hasAcademicGradeWritebackPayload(body)
        ? await syncAcademicGradeWriteback({
            tx,
            studentId: correctionSheet.studentId,
            examId: correctionSheet.examId,
            status: readAcademicGradeWritebackStatus(body, "درجة"),
            score: readAcademicGradeWritebackScore(body),
            notes:
              String(body.gradeNotes ?? body.grade_notes ?? "").trim() ||
              "تم اعتماد الدرجة من التصحيح الإلكتروني.",
            academicAccountingChecked:
              body.academicAccountingChecked ??
              body.academic_accounting_checked,
            sourceLabel: "التصحيح الإلكتروني",
            allowBlankGrade: false,
            blockOnLeave: true,
          })
        : null;
      return {
        correctionSheet,
        grade: gradeWriteback?.grade || null,
        academicRecalculation: gradeWriteback?.academicRecalculation || null,
      };
    });
    await writeRequestAuditLog(req, "التصحيح الإلكتروني", "إضافة ورقة تصحيح وربط الدرجة", {
      correctionSheetId: result.correctionSheet.id,
      studentId: result.correctionSheet.studentId,
      examId: result.correctionSheet.examId,
      gradeId: result.grade?.id,
      wroteGrade: Boolean(result.grade),
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AcademicGradeWritebackError) {
      return validationError(error.message, error.status);
    }
    const err = error as { code?: string };
    if (err?.code === "P2002") {
      return validationError(
        "توجد ورقة تصحيح مسجلة لهذا الطالب في نفس الامتحان",
        409,
      );
    }
    return routeErrorResponse(error, "تعذر حفظ ورقة التصحيح حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "correction.manage");
  if (authError) return authError;

  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return validationError("تعذر تحديد ورقة التصحيح المطلوبة");
    const current = await db.correctionSheet.findUnique({
      where: { id: String(id) },
      select: { id: true, studentId: true, examId: true },
    });
    if (!current)
      return validationError("ورقة التصحيح غير موجودة أو تم حذفها.", 404);

    // Q100 FIX: SERIALIZABLE isolation with retry on conflict.
    const result = await withSerializableTransaction(async (tx) => {
      const correctionSheet = await tx.correctionSheet.update({
        where: { id: String(id) },
        data: correctionSheetUpdateData(body),
      });
      const gradeWriteback = hasAcademicGradeWritebackPayload(body)
        ? await syncAcademicGradeWriteback({
            tx,
            studentId: current.studentId,
            examId: current.examId,
            status: readAcademicGradeWritebackStatus(body, "درجة"),
            score: readAcademicGradeWritebackScore(body),
            notes:
              String(body.gradeNotes ?? body.grade_notes ?? "").trim() ||
              "تم اعتماد الدرجة من التصحيح الإلكتروني.",
            academicAccountingChecked:
              body.academicAccountingChecked ??
              body.academic_accounting_checked,
            sourceLabel: "التصحيح الإلكتروني",
            allowBlankGrade: false,
            blockOnLeave: true,
          })
        : null;
      return {
        correctionSheet,
        grade: gradeWriteback?.grade || null,
        academicRecalculation: gradeWriteback?.academicRecalculation || null,
      };
    });
    await writeRequestAuditLog(req, "التصحيح الإلكتروني", "تحديث ورقة تصحيح وربط الدرجة", {
      correctionSheetId: result.correctionSheet.id,
      studentId: result.correctionSheet.studentId,
      examId: result.correctionSheet.examId,
      gradeId: result.grade?.id,
      wroteGrade: Boolean(result.grade),
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AcademicGradeWritebackError) {
      return validationError(error.message, error.status);
    }
    return routeErrorResponse(error, "تعذر تحديث ورقة التصحيح حالياً.");
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, "correction.manage");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return validationError("تعذر تحديد ورقة التصحيح المطلوبة");

    // Q90 FIX: Allow caller to choose whether to also delete the Grade
    // produced by this correction sheet. Previously, deleting a sheet
    // left the Grade orphaned — the student kept a score they never
    // actually earned, and any opportunity deduction caused by that
    // score remained in effect.
    //
    // Default: deleteGrade=true (safe default — most callers want to
    // undo the entire effect of the correction sheet). Pass
    // deleteGrade=false to keep the grade (e.g. when the sheet was
    // duplicated but the grade itself is correct).
    const deleteGradeRaw = searchParams.get("deleteGrade");
    const deleteGrade = deleteGradeRaw === null ? true : deleteGradeRaw !== "false";

    // Fetch the sheet first (before deleting) so we know the
    // studentId/examId to look up the Grade.
    const sheet = await db.correctionSheet.findUnique({
      where: { id },
      select: { id: true, studentId: true, examId: true, status: true },
    });
    if (!sheet) {
      return validationError("ورقة التصحيح غير موجودة أو تم حذفها مسبقاً.", 404);
    }

    // Use a transaction so sheet deletion + grade deletion + recalc
    // are atomic. If any step fails, nothing is committed.
    // Q100 FIX: SERIALIZABLE isolation with retry on conflict.
    const result = await withSerializableTransaction(async (tx) => {
      // 1. Delete the correction sheet
      await tx.correctionSheet.delete({ where: { id: sheet.id } });

      let gradeDeleted = false;
      let recalculatedStudents = 0;

      // 2. Optionally delete the associated Grade
      if (deleteGrade) {
        const deletedGrade = await tx.grade.deleteMany({
          where: { studentId: sheet.studentId, examId: sheet.examId },
        });
        gradeDeleted = deletedGrade.count > 0;
      }

      // 3. Re-run academic recalculation for the affected student so
      //    opportunity balances and dismissal status reflect the
      //    (possibly removed) grade. This is safe even if no grade
      //    was deleted — it just re-derives state from current data.
      if (gradeDeleted) {
        const recalc = await recalculateStudentsAcademicState(
          [sheet.studentId],
          { tx },
        );
        recalculatedStudents = recalc.students.length;
      }

      return { gradeDeleted, recalculatedStudents };
    });

    await writeRequestAuditLog(req, "التصحيح الإلكتروني", "حذف ورقة تصحيح", {
      correctionSheetId: sheet.id,
      studentId: sheet.studentId,
      examId: sheet.examId,
      status: sheet.status,
      deleteGrade,
      gradeDeleted: result.gradeDeleted,
      recalculatedStudents: result.recalculatedStudents,
    });

    return NextResponse.json({
      ok: true,
      deleteGrade,
      gradeDeleted: result.gradeDeleted,
      recalculatedStudents: result.recalculatedStudents,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف ورقة التصحيح حالياً.");
  }
}
