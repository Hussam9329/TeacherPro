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

function readListPagination(req: NextRequest, fallbackPageSize = 100, maxPageSize = 200) {
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
    // Never trust client-provided IDs on create. The server owns primary keys.
    const studentCall = await withFollowupTables(
      () => db.studentCall.create({ data }),
      "StudentCall",
    );
    return NextResponse.json({ studentCall }, { status: 201 });
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
