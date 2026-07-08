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
import { withFollowupTables } from "@/lib/followup-schema";

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

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const { page, pageSize, skip } = readListPagination(req);
    const [totalCount, studentCalls] = await withFollowupTables(
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
  const authError = await requirePermission(req, "follow-up.manage");
  if (authError) return authError;

  try {
    const body = await req.json();
    const data = normalizeCallPayload(body);
    const studentError = requireText(data.studentId, "الطالب");
    if (studentError) return validationError(studentError);
    const categoryError = requireText(data.category, "نوع المكالمة");
    if (categoryError) return validationError(categoryError);

    // Upsert by the logical call key, not by client-provided IDs.
    // This prevents duplicate call rows when the user changes status quickly or retries after a network failure.
    const result = await withFollowupTables(
      () =>
        db.$transaction(async (tx) => {
          const existing = await tx.studentCall.findFirst({
            where: {
              studentId: data.studentId,
              examId: data.examId,
              category: data.category,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });

          if (data.category === "call-student-note" && !data.notes.trim()) {
            if (existing) {
              await tx.studentCall.delete({ where: { id: existing.id } });
              await tx.studentCall.deleteMany({
                where: {
                  studentId: data.studentId,
                  examId: data.examId,
                  category: data.category,
                  id: { not: existing.id },
                },
              });
            }
            return { studentCall: null, deleted: true };
          }

          if (!data.status && data.category !== "call-student-note" && !existing) {
            return { studentCall: null, deleted: false };
          }

          const { createdAt: _createdAt, ...updateData } = data;
          const studentCall = existing
            ? await tx.studentCall.update({ where: { id: existing.id }, data: updateData })
            : await tx.studentCall.create({ data });

          // Best-effort cleanup of older duplicates for the same logical call.
          await tx.studentCall.deleteMany({
            where: {
              studentId: data.studentId,
              examId: data.examId,
              category: data.category,
              id: { not: studentCall.id },
            },
          });

          return { studentCall, deleted: false };
        }),
      "StudentCall",
    );
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ المكالمة حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.manage");
  if (authError) return authError;

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
    const studentCall = await withFollowupTables(
      () => db.studentCall.update({ where: { id: String(id) }, data }),
      "StudentCall",
    );
    return NextResponse.json({ studentCall });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحديث المكالمة حالياً.");
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.manage");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return validationError("تعذر تحديد المكالمة المطلوبة");
    await withFollowupTables(
      () => db.studentCall.delete({ where: { id } }),
      "StudentCall",
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف المكالمة حالياً.");
  }
}
