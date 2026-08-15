export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeArabicText } from "@/lib/route-helpers";
import { sanitizePhoneInput } from "@/lib/format";
import { sanitizeTelegramInput } from "@/lib/student-utils";
import { normalizeListFilter } from "@/lib/all-filter";
import { STUDENT_STATUS_ARCHIVED } from "@/lib/student-scope";

function buildLocationWhere(location: string): Prisma.StudentWhereInput | null {
  const normalized = normalizeArabicText(location);
  if (!normalized) return null;

  if (normalized === normalizeArabicText("بغداد"))
    return { locationScope: "بغداد" };
  if (normalized === normalizeArabicText("خارج القطر"))
    return { locationScope: "خارج القطر" };

  return {
    OR: [
      { subSite: { equals: location, mode: "insensitive" } },
      { mainSite: { equals: location, mode: "insensitive" } },
      { subSite: { contains: location, mode: "insensitive" } },
      { mainSite: { contains: location, mode: "insensitive" } },
    ],
  };
}

function buildSearchWhere(rawQuery: string): Prisma.StudentWhereInput | null {
  const q = rawQuery.trim();
  if (!q) return null;
  const normalizedQuery = normalizeArabicText(q);
  const numericQuery = sanitizePhoneInput(q);
  const telegramQuery = sanitizeTelegramInput(q)
    .replace(/\s+/g, "")
    .toLowerCase();
  const or: Prisma.StudentWhereInput[] = [
    { name: { contains: q, mode: "insensitive" } },
    { nameKey: { contains: normalizedQuery, mode: "insensitive" } },
    { code: { startsWith: q, mode: "insensitive" } },
    { school: { contains: q, mode: "insensitive" } },
  ];

  if (telegramQuery) {
    or.push(
      { telegramKey: { startsWith: telegramQuery, mode: "insensitive" } },
      {
        telegram: { startsWith: sanitizeTelegramInput(q), mode: "insensitive" },
      },
    );
  }

  if (numericQuery) {
    or.push(
      { phone: { startsWith: numericQuery, mode: "insensitive" } },
      { phoneKey: { startsWith: numericQuery, mode: "insensitive" } },
      { parentPhone: { startsWith: numericQuery, mode: "insensitive" } },
    );
    if (numericQuery.length >= 7) {
      or.push(
        { phone: { contains: numericQuery, mode: "insensitive" } },
        { phoneKey: { contains: numericQuery, mode: "insensitive" } },
        { parentPhone: { contains: numericQuery, mode: "insensitive" } },
      );
    }
  }

  return { OR: or };
}

function buildStudentExportWhere(
  searchParams: URLSearchParams,
): Prisma.StudentWhereInput {
  const and: Prisma.StudentWhereInput[] = [];
  const q = String(searchParams.get("q") || "").trim();
  const courseId = normalizeListFilter(searchParams.get("courseId"));
  const status = normalizeListFilter(searchParams.get("status"));
  const courseProgram = normalizeListFilter(searchParams.get("courseProgram"));
  const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
  const studyType = normalizeListFilter(searchParams.get("studyType"));
  const location = normalizeListFilter(
    searchParams.get("location") || searchParams.get("locationScope"),
  );

  if (courseId) and.push({ courseId });
  if (status) and.push({ status });
  else and.push({ status: { not: STUDENT_STATUS_ARCHIVED } });
  if (courseProgram) and.push({ courseProgram });
  if (courseProgram === "كورسات" && courseTerm) and.push({ courseTerm });
  if (studyType) and.push({ studyType });

  const locationWhere = location ? buildLocationWhere(location) : null;
  if (locationWhere) and.push(locationWhere);

  const searchWhere = buildSearchWhere(q);
  if (searchWhere) and.unshift(searchWhere);

  return and.length > 0 ? { AND: and } : {};
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const where = buildStudentExportWhere(searchParams);
    const [totalCount, students] = await Promise.all([
      db.student.count({ where }),
      db.student.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { course: true },
      }),
    ]);

    return NextResponse.json({
      students,
      total: students.length,
      totalCount,
      capped: false,
    });
  } catch (error) {
    console.error("[API] /api/students/export error:", error);
    return NextResponse.json(
      { error: "تعذر تصدير بيانات الطلاب حالياً." },
      { status: 500 },
    );
  }
}
