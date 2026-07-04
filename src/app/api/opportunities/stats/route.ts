export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { sanitizePhoneInput } from "@/lib/format";
import { sanitizeTelegramInput } from "@/lib/student-utils";
import { normalizeArabicText, routeErrorResponse } from "@/lib/route-helpers";
import { normalizeListFilter } from "@/lib/all-filter";

function composeWhere(parts: Prisma.StudentWhereInput[]): Prisma.StudentWhereInput {
  return parts.length > 0 ? { AND: parts } : {};
}

function buildSearchWhere(rawQuery: string): Prisma.StudentWhereInput | null {
  const query = rawQuery.trim();
  if (!query) return null;
  const normalized = normalizeArabicText(query);
  const numeric = sanitizePhoneInput(query);
  const telegram = sanitizeTelegramInput(query).replace(/\s+/g, "").toLowerCase();
  const or: Prisma.StudentWhereInput[] = [
    { name: { contains: query, mode: "insensitive" } },
    { code: { startsWith: query, mode: "insensitive" } },
    { school: { contains: query, mode: "insensitive" } },
    { subSite: { contains: query, mode: "insensitive" } },
    { status: { contains: query, mode: "insensitive" } },
    { dismissalType: { contains: query, mode: "insensitive" } },
    { dismissalReason: { contains: query, mode: "insensitive" } },
    { dismissalNotes: { contains: query, mode: "insensitive" } },
  ];
  if (normalized) or.push({ nameKey: { contains: normalized, mode: "insensitive" } });
  if (telegram) {
    or.push(
      { telegramKey: { startsWith: telegram, mode: "insensitive" } },
      { telegram: { startsWith: sanitizeTelegramInput(query), mode: "insensitive" } },
    );
  }
  if (numeric) {
    or.push(
      { phone: { startsWith: numeric, mode: "insensitive" } },
      { phoneKey: { startsWith: numeric, mode: "insensitive" } },
      { parentPhone: { startsWith: numeric, mode: "insensitive" } },
    );
    if (numeric.length >= 7) {
      or.push(
        { phone: { contains: numeric, mode: "insensitive" } },
        { phoneKey: { contains: numeric, mode: "insensitive" } },
        { parentPhone: { contains: numeric, mode: "insensitive" } },
      );
    }
  }
  return { OR: or };
}

function buildOpportunityFilters(searchParams: URLSearchParams): Prisma.StudentWhereInput[] {
  const and: Prisma.StudentWhereInput[] = [];
  const courseId = normalizeListFilter(searchParams.get("courseId"));
  const status = normalizeListFilter(searchParams.get("status"));
  const opportunityCount = normalizeListFilter(searchParams.get("opportunityCount"));
  const query = String(searchParams.get("q") || "").trim();

  if (courseId) and.push({ courseId });

  if (status === "active") and.push({ status: "نشط" });
  else if (status === "dismissed") and.push({ status: "مفصول" });
  else if (status === "has-opportunities") and.push({ status: "نشط", opportunities: { gt: 0 } });
  else if (status === "no-opportunities") and.push({ status: "نشط", opportunities: 0 });
  else if (status === "temporary-dismissal") and.push({ status: "مفصول", dismissalType: "فصل مؤقت" });
  else if (status === "final-dismissal") and.push({ status: "مفصول", dismissalType: "فصل نهائي" });

  if (opportunityCount !== "") {
    const numericCount = Number(opportunityCount);
    if (Number.isFinite(numericCount)) and.push({ opportunities: Math.trunc(numericCount) });
  }

  const searchWhere = buildSearchWhere(query);
  if (searchWhere) and.push(searchWhere);

  return and;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const filters = buildOpportunityFilters(searchParams);
    const baseWhere = composeWhere(filters);

    const [total, hasOpportunities, noOpportunities, dismissed, active] = await Promise.all([
      db.student.count({ where: baseWhere }),
      db.student.count({ where: composeWhere([...filters, { status: "نشط", opportunities: { gt: 0 } }]) }),
      db.student.count({ where: composeWhere([...filters, { status: "نشط", opportunities: 0 }]) }),
      db.student.count({ where: composeWhere([...filters, { status: "مفصول" }]) }),
      db.student.count({ where: composeWhere([...filters, { status: "نشط" }]) }),
    ]);

    return NextResponse.json({
      total,
      hasOpportunities,
      noOpportunities,
      dismissed,
      active,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل إحصائيات الفرص من قاعدة البيانات حالياً.");
  }
}
