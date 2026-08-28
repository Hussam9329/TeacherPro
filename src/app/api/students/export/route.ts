export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { buildStudentRegistryWhere } from "@/lib/student-registry-filters-server";

const DEFAULT_EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_PAGE_SIZE = 500;

const studentExportSelect = {
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
  mainSite: true,
  subSite: true,
  code: true,
  status: true,
  dismissalReason: true,
  dismissalNotes: true,
  opportunities: true,
  baseOpportunities: true,
  accountingGraceDays: true,
  gracePeriodStartDate: true,
  gracePeriodEndedAt: true,
  createdAt: true,
  courseId: true,
  course: { select: { name: true } },
} satisfies Prisma.StudentSelect;

function parsePageSize(value: string | null): number {
  const numeric = Number(value || DEFAULT_EXPORT_PAGE_SIZE);
  if (!Number.isFinite(numeric)) return DEFAULT_EXPORT_PAGE_SIZE;
  return Math.min(MAX_EXPORT_PAGE_SIZE, Math.max(1, Math.trunc(numeric)));
}

function parseSnapshotAt(value: string | null): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now() + 60_000) {
    throw new Error("INVALID_EXPORT_SNAPSHOT");
  }
  return parsed;
}

function mergeWhere(
  ...parts: Array<Prisma.StudentWhereInput | null | undefined>
): Prisma.StudentWhereInput {
  const valid = parts.filter(Boolean) as Prisma.StudentWhereInput[];
  if (valid.length === 0) return {};
  if (valid.length === 1) return valid[0];
  return { AND: valid };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const filteredWhere = await buildStudentRegistryWhere(searchParams);
    const snapshotAt = parseSnapshotAt(searchParams.get("snapshotAt"));
    const cursor = String(searchParams.get("cursor") || "").trim();
    const pageSize = parsePageSize(searchParams.get("pageSize"));
    const snapshotWhere = mergeWhere(filteredWhere, {
      createdAt: { lte: snapshotAt },
    });
    const pageWhere = mergeWhere(
      snapshotWhere,
      cursor ? { id: { gt: cursor } } : null,
    );

    const [totalCount, pageRows] = await db.$transaction(
      [
        db.student.count({ where: snapshotWhere }),
        db.student.findMany({
          where: pageWhere,
          orderBy: { id: "asc" },
          take: pageSize + 1,
          select: studentExportSelect,
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );

    const hasMore = pageRows.length > pageSize;
    const rows = hasMore ? pageRows.slice(0, pageSize) : pageRows;
    const students = rows.map(({ course, ...student }) => ({
      ...student,
      courseName: course?.name || "",
    }));

    return NextResponse.json(
      {
        students,
        totalCount,
        hasMore,
        nextCursor: hasMore ? rows.at(-1)?.id || null : null,
        snapshotAt: snapshotAt.toISOString(),
        pageSize,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_EXPORT_SNAPSHOT") {
      return NextResponse.json(
        { error: "لقطة التصدير غير صالحة؛ أعد فتح نافذة التصدير." },
        { status: 400 },
      );
    }
    console.error("[API] /api/students/export error:", error);
    return NextResponse.json(
      { error: "تعذر تصدير بيانات الطلاب حالياً." },
      { status: 500 },
    );
  }
}
