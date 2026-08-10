export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getAuthPrincipal,
  requireAnyPermission,
  requirePermission,
} from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import {
  GRADE_SMART_NOTE_CATEGORIES,
  GRADE_SMART_NOTE_STATUSES,
  gradeSmartNoteResolutionGradeId,
  isGradeSmartNoteCategory,
  isGradeSmartNoteStatus,
} from "@/lib/grade-smart-notes-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";

type SmartNoteWithResolution = Prisma.GradeSmartNoteGetPayload<{
  include: { resolutionGrade: { select: { id: true } } };
}>;

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function serializeSmartNote(note: SmartNoteWithResolution) {
  return {
    id: note.id,
    category: note.category,
    status: note.status,
    examId: note.examId,
    studentId: note.studentId,
    examNameSnapshot: note.examNameSnapshot,
    examDateSnapshot: iso(note.examDateSnapshot),
    studentNameSnapshot: note.studentNameSnapshot,
    studentCodeSnapshot: note.studentCodeSnapshot,
    score: note.score,
    reason: note.reason,
    attemptedById: note.attemptedById,
    attemptedByName: note.attemptedByName,
    attemptedAt: iso(note.attemptedAt),
    resolution: note.resolution,
    resolutionById: note.resolutionById,
    resolutionByName: note.resolutionByName,
    resolvedAt: iso(note.resolvedAt),
    resolutionGradeId: gradeSmartNoteResolutionGradeId(note),
    createdAt: iso(note.createdAt),
    updatedAt: iso(note.updatedAt),
  };
}

function countRecord(
  rows: readonly unknown[],
  key: "status" | "category",
): Record<string, number> {
  return Object.fromEntries(
    rows.map((item) => {
      const row = item as Record<string, unknown>;
      const count = row._count as { _all?: unknown } | undefined;
      return [String(row[key] || ""), Number(count?._all || 0)];
    }),
  );
}

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "grades.view",
    "grades.add",
  ]);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const examId = String(searchParams.get("examId") || "").trim();
    const studentId = String(searchParams.get("studentId") || "").trim();
    const category = String(searchParams.get("category") || "").trim();
    const status = String(searchParams.get("status") || "").trim();
    const page = positiveInt(searchParams.get("page"), 1, 100_000);
    const pageSize = positiveInt(searchParams.get("pageSize"), 50, 200);

    if (category && !isGradeSmartNoteCategory(category)) {
      return validationError("تصنيف الملاحظة الذكية غير صحيح.");
    }
    if (status && !isGradeSmartNoteStatus(status)) {
      return validationError("حالة الملاحظة الذكية غير صحيحة.");
    }

    const where: Prisma.GradeSmartNoteWhereInput = {
      ...(examId ? { examId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
    };
    const skip = (page - 1) * pageSize;
    const [totalCount, notes, statusRows, categoryRows] = await db.$transaction([
      db.gradeSmartNote.count({ where }),
      db.gradeSmartNote.findMany({
        where,
        orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
        include: { resolutionGrade: { select: { id: true } } },
      }),
      db.gradeSmartNote.groupBy({
        by: ["status"],
        where,
        orderBy: { status: "asc" },
        _count: { _all: true },
      }),
      db.gradeSmartNote.groupBy({
        by: ["category"],
        where,
        orderBy: { category: "asc" },
        _count: { _all: true },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return NextResponse.json({
      notes: notes.map(serializeSmartNote),
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
      statusCounts: countRecord(statusRows, "status"),
      categoryCounts: countRecord(categoryRows, "category"),
      categories: GRADE_SMART_NOTE_CATEGORIES,
      statuses: GRADE_SMART_NOTE_STATUSES,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل ملاحظات الدرجات الذكية حالياً.",
    );
  }
}

async function updateSmartNote(req: NextRequest) {
  const authError = await requirePermission(req, "grades.edit");
  if (authError) return authError;

  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json(
      { error: "يجب تسجيل الدخول أولاً." },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    const status = String(body.status || "").trim();
    const resolution = String(body.resolution || "").trim();
    const expectedUpdatedAt = String(body.expectedUpdatedAt || "").trim();
    if (!id) return validationError("تعذر تحديد الملاحظة الذكية.");
    if (!isGradeSmartNoteStatus(status)) {
      return validationError("حالة الملاحظة الذكية غير صحيحة.");
    }
    if (status !== "PENDING" && !resolution) {
      return validationError("يجب كتابة نتيجة معالجة الملاحظة.");
    }
    const expectedDate = new Date(expectedUpdatedAt);
    if (!expectedUpdatedAt || !Number.isFinite(expectedDate.getTime())) {
      return validationError(
        "نسخة الملاحظة غير صالحة. حدّث البيانات ثم حاول مجدداً.",
      );
    }

    const note = await db.$transaction(async (tx) => {
      const changed = await tx.gradeSmartNote.updateMany({
        where: { id, updatedAt: expectedDate },
        data: {
          status,
          resolution: status === "PENDING" ? null : resolution,
          resolutionById: status === "PENDING" ? null : principal.id,
          resolutionByName:
            status === "PENDING"
              ? null
              : principal.name || principal.username,
          resolvedAt: status === "PENDING" ? null : new Date(),
        },
      });
      if (changed.count !== 1) return null;
      return tx.gradeSmartNote.findUnique({
        where: { id },
        include: { resolutionGrade: { select: { id: true } } },
      });
    });

    if (!note) {
      return NextResponse.json(
        {
          error:
            "تغيرت الملاحظة بعد فتحها. حدّث البيانات وراجع النتيجة الجديدة.",
          requiresFreshNote: true,
        },
        { status: 409 },
      );
    }

    await writeRequestAuditLog(
      req,
      "الدرجات",
      "تحديث معالجة ملاحظة درجة ذكية",
      { noteId: note.id, category: note.category, status: note.status },
    );
    return NextResponse.json({ note: serializeSmartNote(note) });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحديث ملاحظة الدرجة الذكية حالياً.",
    );
  }
}

export async function PUT(req: NextRequest) {
  return updateSmartNote(req);
}

export async function PATCH(req: NextRequest) {
  return updateSmartNote(req);
}
