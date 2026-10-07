export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireAnyPermission, requirePermissionPrincipal } from "@/lib/server-auth";
import { CALLS_VIEW_PERMISSIONS } from "@/lib/permission-catalog";
import { db } from "@/lib/db";
import {
  requireText,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { CALL_STUDENT_NOTE_CATEGORY } from "@/lib/call-notes-filter";
import { isStudentExamCall } from "@/lib/call-identity";
import { CallNoteMutationError, editCallNote, readExpectedNoteRevision, upsertExamCallNote } from "@/lib/call-note-management-server";
import {
  archivedStudentLockedResponse,
  assertStudentsNotArchived,
  isArchivedStudentError,
} from "@/lib/archived-student-guard";
import { parseCallWindowId } from "@/lib/call-batch";
import { dropCallHold, holdCallCase, retryCallTransaction } from "@/lib/call-reservations-server";
import { writeAuditLog } from "@/lib/audit-log-server";

function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOrNow(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function readListPagination(req: NextRequest, fallbackPageSize = 100, maxPageSize = 500) {
  const searchParams = new URL(req.url).searchParams;
  const rawPageSize = searchParams.get("pageSize") ?? searchParams.get("limit");
  const rawPage = searchParams.get("page");
  const pageNumber = Number(rawPage ?? 1);
  const pageSizeNumber = Number(rawPageSize ?? fallbackPageSize);
  const page = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1;
  const pageSize = Number.isFinite(pageSizeNumber) && pageSizeNumber > 0
    ? Math.min(Math.floor(pageSizeNumber), maxPageSize)
    : fallbackPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function normalizeCallStatus(body: Record<string, unknown>): string {
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    return String(body.status ?? "").trim();
  }
  return Boolean(body.completed) ? "تم الاتصال" : "";
}

function normalizeCallPayload(body: Record<string, unknown>) {
  const status = normalizeCallStatus(body);
  return {
    studentId: String(body.studentId ?? ""),
    examId: String(body.examId ?? "").trim() || null,
    category: String(body.category ?? ""),
    target: String(body.target ?? ""),
    phone: String(body.phone ?? ""),
    status,
    completed: status === "تم الاتصال",
    completedAt: dateOrNull(body.completedAt),
    notes: String(body.notes ?? ""),
    createdAt: dateOrNow(body.createdAt),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, CALLS_VIEW_PERMISSIONS);
  if (authError) return authError;

  try {
    const { page, pageSize, skip } = readListPagination(req);
    const [totalCount, studentCalls] = await withDatabaseSchema(
      () => Promise.all([
        db.studentCall.count(),
        db.studentCall.findMany({ orderBy: { createdAt: "desc" }, skip, take: pageSize }),
      ]),
      "StudentCall",
    );
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return NextResponse.json({ studentCalls, totalCount, page, pageSize, totalPages, hasMore: page < totalPages });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل المكالمات حالياً.");
  }
}

export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "follow-up.calls.manage");
  if (principal instanceof NextResponse) return principal;

  try {
    const body = await req.json();
    const data = normalizeCallPayload(body);
    const windowId = parseCallWindowId(body?.windowId);
    const studentError = requireText(data.studentId, "الطالب");
    if (studentError) return validationError(studentError);
    const categoryError = requireText(data.category, "نوع المكالمة");
    if (categoryError) return validationError(categoryError);

    if (data.category === CALL_STUDENT_NOTE_CATEGORY) {
      const expectedRevision = readExpectedNoteRevision(body.expectedRevision);
      const result = await withDatabaseSchema(
        () => db.$transaction((tx) => upsertExamCallNote(tx, principal, {
          studentId: data.studentId, examId: data.examId, notes: data.notes, expectedRevision,
          expectedNoteId: body.expectedNoteId === undefined ? undefined : String(body.expectedNoteId || "").trim() || null,
        })), "StudentCall",
      );
      return NextResponse.json(result);
    }

    // Upsert by the logical call key, not by client-provided IDs.
    // This prevents duplicate call rows when the user changes status quickly or retries after a network failure.
    // Saving is an upsert by student + exam, so running it again after the
    // database broke a lock cycle is safe.
    const result = await withDatabaseSchema(
      () =>
        retryCallTransaction(() => db.$transaction(async (tx) => {
          await assertStudentsNotArchived(tx, [data.studentId]);
          const examCall = isStudentExamCall(data);

          // The DB unique key still includes category for backward compatibility.
          // Serialize exam-call writes on the stable parent row so two tabs cannot
          // create different category rows for the same student + exam concurrently.
          if (examCall) {
            await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${data.studentId} FOR UPDATE`;
          }

          const logicalWhere: Prisma.StudentCallWhereInput = examCall
            ? {
                studentId: data.studentId,
                examId: data.examId,
                category: { not: CALL_STUDENT_NOTE_CATEGORY },
              }
            : {
                studentId: data.studentId,
                examId: data.examId,
                category: data.category,
              };
          const existing = await tx.studentCall.findFirst({
            where: logicalWhere,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });

          if (!data.status && data.category !== CALL_STUDENT_NOTE_CATEGORY && !existing) {
            return { studentCall: null, deleted: false };
          }

          // Who made this contact action, and when (shown in the card, the
          // logs and the student's story).
          const actor = {
            actedAt: new Date(),
            actedById: principal.id,
            actedByName: principal.name || principal.username || "مستخدم",
          };
          const { createdAt: _createdAt, ...callData } = data;
          const updateData = { ...callData, ...(examCall ? actor : {}) };
          // Preserve a legacy category when reusing an old row. The category is
          // metadata now; studentId + examId is the authoritative call identity.
          updateData.category = existing?.category || data.category;
          const createData = {
            ...data,
            ...(examCall ? actor : {}),
            category: String(updateData.category || data.category),
          };
          let studentCall;
          if (existing) {
            studentCall = await tx.studentCall.update({
              where: { id: existing.id },
              data: updateData,
            });
          } else {
            try {
              studentCall = await tx.studentCall.create({ data: createData });
            } catch (createError) {
              if (!isUniqueConstraintError(createError)) throw createError;
              // A second tab/request created the same logical call between findFirst and create.
              // Re-read and update the winning row instead of returning an error to the user.
              const racedExisting = await tx.studentCall.findFirst({
                where: logicalWhere,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              });
              if (!racedExisting) throw createError;
              studentCall = await tx.studentCall.update({
                where: { id: racedExisting.id },
                data: updateData,
              });
            }
          }

          // Opportunistically collapse historical category-based duplicates when
          // this logical call is touched. No bulk data migration is needed here.
          await tx.studentCall.deleteMany({
            where: {
              ...logicalWhere,
              id: { not: studentCall.id },
            },
          });

          if (examCall && data.examId) {
            // «دفعات»: any action ends the hold on this student. Taking the
            // action back returns them to the window that asked, if nobody
            // else holds them meanwhile.
            if (data.status) await dropCallHold(tx, data.studentId, data.examId);
            else if (windowId) await holdCallCase(tx, { id: windowId, ownerId: principal.id }, data.studentId, data.examId);
            const previous = String(existing?.status || "");
            if (previous !== data.status) {
              await writeAuditLog(principal, "المكالمات", data.status ? "تحديث حالة مكالمة" : "مسح حالة مكالمة", {
                studentId: data.studentId,
                examId: data.examId,
                status: data.status || "بدون إجراء",
                previousStatus: previous || "بدون إجراء",
              }, { tx });
            }
          }

          return { studentCall, deleted: false };
        })),
      "StudentCall",
    );
    return NextResponse.json(result);
  } catch (error) {
    if (isArchivedStudentError(error)) return archivedStudentLockedResponse();
    if (error instanceof CallNoteMutationError) return NextResponse.json({ error: error.message, studentCall: error.studentCall }, { status: error.status });
    return routeErrorResponse(error, "تعذر حفظ المكالمة حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "follow-up.calls.manage");
  if (principal instanceof NextResponse) return principal;

  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return validationError("تعذر تحديد المكالمة المطلوبة");
    const data: Record<string, unknown> = {};
    if (updates.category !== undefined)
      data.category = String(updates.category ?? "");
    if (updates.target !== undefined)
      data.target = String(updates.target ?? "");
    if (updates.examId !== undefined)
      data.examId = String(updates.examId ?? "").trim() || null;
    if (updates.phone !== undefined) data.phone = String(updates.phone ?? "");
    if (updates.status !== undefined)
      data.status = String(updates.status ?? "").trim();
    if (updates.completed !== undefined || updates.status !== undefined)
      data.completed = data.status ? data.status === "تم الاتصال" : false;
    if (updates.completedAt !== undefined)
      data.completedAt = dateOrNull(updates.completedAt);
    if (updates.notes !== undefined) data.notes = String(updates.notes ?? "");
    const result = await withDatabaseSchema(
      () => db.$transaction(async (tx) => {
        const existing = await tx.studentCall.findUnique({ where: { id: String(id) } });
        if (!existing) throw new CallNoteMutationError("المكالمة غير موجودة.", 404);
        await assertStudentsNotArchived(tx, [existing.studentId]);
        if (existing.category === CALL_STUDENT_NOTE_CATEGORY) {
          // Legacy notes keep their existing scope. Only the dedicated endpoint
          // changes completion, and editing cannot convert a note into a call.
          if ((updates.examId !== undefined && data.examId !== existing.examId) ||
              (updates.category !== undefined && data.category !== existing.category)) {
            throw new CallNoteMutationError("لا يمكن تغيير الامتحان المرتبط بالملاحظة.", 400);
          }
          return editCallNote(tx, principal, {
            id: existing.id, notes: updates.notes === undefined ? existing.notes : String(updates.notes ?? ""),
            expectedRevision: readExpectedNoteRevision(updates.expectedRevision),
          });
        }
        if (data.category === CALL_STUDENT_NOTE_CATEGORY) {
          throw new CallNoteMutationError("احفظ الملاحظة من حقل ملاحظات الامتحان.", 400);
        }
        return { studentCall: await tx.studentCall.update({ where: { id: existing.id }, data }), deleted: false };
      }), "StudentCall",
    );
    return NextResponse.json(result);
  } catch (error) {
    if (isArchivedStudentError(error)) return archivedStudentLockedResponse();
    if (error instanceof CallNoteMutationError) return NextResponse.json({ error: error.message, studentCall: error.studentCall }, { status: error.status });
    return routeErrorResponse(error, "تعذر تحديث المكالمة حالياً.");
  }
}

export async function DELETE(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "follow-up.calls.manage");
  if (principal instanceof NextResponse) return principal;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return validationError("تعذر تحديد المكالمة المطلوبة");
    await withDatabaseSchema(() => db.$transaction(async (tx) => {
      const existing = await tx.studentCall.findUnique({ where: { id } });
      await assertStudentsNotArchived(tx, [existing?.studentId]);
      if (existing?.category === CALL_STUDENT_NOTE_CATEGORY) {
        const rawRevision = searchParams.get("expectedRevision");
        await editCallNote(tx, principal, {
          id, notes: "", expectedRevision: readExpectedNoteRevision(rawRevision === null ? undefined : Number(rawRevision)),
        });
      } else {
        await tx.studentCall.delete({ where: { id } });
      }
    }), "StudentCall");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isArchivedStudentError(error)) return archivedStudentLockedResponse();
    if (error instanceof CallNoteMutationError) return NextResponse.json({ error: error.message, studentCall: error.studentCall }, { status: error.status });
    return routeErrorResponse(error, "تعذر حذف المكالمة حالياً.");
  }
}
