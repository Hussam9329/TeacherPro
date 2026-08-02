export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeListFilter } from "@/lib/all-filter";
import { normalizeArabicText, routeErrorResponse } from "@/lib/route-helpers";
import {
  STUDENT_STATUS_ACTIVE,
  STUDENT_STATUS_ARCHIVED,
  STUDENT_STATUS_DISMISSED,
  visibleStudentWhere,
} from "@/lib/student-scope";

function combineStudentWhere(
  ...parts: Array<Prisma.StudentWhereInput | null | undefined>
): Prisma.StudentWhereInput {
  const valid = parts.filter(Boolean) as Prisma.StudentWhereInput[];
  if (valid.length === 0) return {};
  if (valid.length === 1) return valid[0];
  return { AND: valid };
}

function locationWhere(location: string): Prisma.StudentWhereInput | null {
  const normalized = normalizeArabicText(location);
  if (!normalized) return null;
  if (normalized === normalizeArabicText("بغداد")) {
    return { locationScope: "بغداد" };
  }
  if (normalized === normalizeArabicText("خارج القطر")) {
    return { locationScope: "خارج القطر" };
  }
  return {
    OR: [
      { subSite: { equals: location, mode: "insensitive" } },
      { mainSite: { equals: location, mode: "insensitive" } },
      { subSite: { contains: location, mode: "insensitive" } },
      { mainSite: { contains: location, mode: "insensitive" } },
    ],
  };
}

function searchWhere(query: string): Prisma.StudentWhereInput | null {
  const raw = query.trim();
  if (!raw) return null;
  const normalized = normalizeArabicText(raw);
  const compact = raw.replace(/\s+/g, "");
  const telegram = raw.startsWith("@") ? raw : `@${raw}`;
  const or: Prisma.StudentWhereInput[] = [
    { name: { contains: raw, mode: "insensitive" } },
    { nameKey: { contains: normalized, mode: "insensitive" } },
    { code: { startsWith: raw, mode: "insensitive" } },
    { telegram: { startsWith: telegram, mode: "insensitive" } },
  ];
  if (compact) {
    or.push(
      { phone: { startsWith: compact, mode: "insensitive" } },
      { parentPhone: { startsWith: compact, mode: "insensitive" } },
    );
  }
  if (compact.length >= 7) {
    or.push(
      { phone: { contains: compact, mode: "insensitive" } },
      { parentPhone: { contains: compact, mode: "insensitive" } },
    );
  }
  return { OR: or };
}

type ActiveCourseLink = {
  courseId: string;
  chapter: { opportunities: number };
};

function registryIssueWhere(
  issue: string,
  activeLinks: ActiveCourseLink[],
): Prisma.StudentWhereInput | null {
  if (issue === "missing-contact") {
    return {
      OR: [
        { phone: null },
        { phone: "" },
        { parentPhone: null },
        { parentPhone: "" },
      ],
    };
  }
  if (issue === "no-telegram") {
    return { OR: [{ telegram: null }, { telegram: "" }, { telegramKey: null }] };
  }
  if (issue === "zero-opportunities") {
    return { status: STUDENT_STATUS_ACTIVE, opportunities: 0 };
  }

  const grouped = new Map<string, ActiveCourseLink[]>();
  for (const link of activeLinks) {
    const rows = grouped.get(link.courseId) || [];
    rows.push(link);
    grouped.set(link.courseId, rows);
  }

  if (issue === "no-active-chapter") {
    const validCourseIds = Array.from(grouped.entries())
      .filter(([, links]) =>
        links.length === 1 && Number(links[0].chapter.opportunities || 0) > 0,
      )
      .map(([courseId]) => courseId);
    return validCourseIds.length
      ? { courseId: { notIn: validCourseIds } }
      : {};
  }
  if (issue === "active-chapter-conflict") {
    const ids = Array.from(grouped.entries())
      .filter(([, links]) => links.length > 1)
      .map(([courseId]) => courseId);
    return ids.length ? { courseId: { in: ids } } : { id: "__none__" };
  }
  if (issue === "opportunity-full" || issue === "opportunity-over-limit") {
    const or = Array.from(grouped.entries())
      .filter(
        ([, links]) =>
          links.length === 1 &&
          Number(links[0].chapter.opportunities || 0) > 0,
      )
      .map(([courseId, links]) => ({
        courseId,
        opportunities:
          issue === "opportunity-full"
            ? { gte: Math.max(0, Number(links[0].chapter.opportunities || 0)) }
            : { gt: Math.max(0, Number(links[0].chapter.opportunities || 0)) },
      }));
    return or.length ? { OR: or } : { id: "__none__" };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const activeCourseLinks = await db.courseChapter.findMany({
      where: { active: true, archived: false },
      select: {
        courseId: true,
        chapter: { select: { opportunities: true } },
      },
    });
    const activeCourseIds = Array.from(
      new Set(activeCourseLinks.map((link) => link.courseId)),
    );

    const visibleStudentsWhere = visibleStudentWhere();
    const status = normalizeListFilter(searchParams.get("status"));
    const gender = normalizeListFilter(searchParams.get("gender"));
    const filters: Prisma.StudentWhereInput[] = [
      status ? { status } : visibleStudentsWhere,
    ];
    const courseId = normalizeListFilter(searchParams.get("courseId"));
    const courseProgram = normalizeListFilter(
      searchParams.get("courseProgram"),
    );
    const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
    const studyType = normalizeListFilter(searchParams.get("studyType"));
    const location = normalizeListFilter(searchParams.get("location"));
    const query = String(searchParams.get("q") || "").trim();
    const issue = normalizeListFilter(searchParams.get("registryIssue"));

    if (gender) filters.push({ gender });
    if (courseId) filters.push({ courseId });
    if (courseProgram) filters.push({ courseProgram });
    if (courseProgram === "كورسات" && courseTerm) filters.push({ courseTerm });
    if (studyType) filters.push({ studyType });
    const selectedLocationWhere = locationWhere(location);
    if (selectedLocationWhere) filters.push(selectedLocationWhere);
    const selectedSearchWhere = searchWhere(query);
    if (selectedSearchWhere) filters.push(selectedSearchWhere);
    const selectedIssueWhere = registryIssueWhere(issue, activeCourseLinks);
    if (selectedIssueWhere) filters.push(selectedIssueWhere);

    const filteredWhere = combineStudentWhere(...filters);

    const [systemTotal, total, active, dismissed, archived, noActiveChapter] =
      await Promise.all([
        db.student.count({ where: visibleStudentsWhere }),
        db.student.count({ where: filteredWhere }),
        db.student.count({
          where: combineStudentWhere(filteredWhere, {
            status: STUDENT_STATUS_ACTIVE,
          }),
        }),
        db.student.count({
          where: combineStudentWhere(filteredWhere, {
            status: STUDENT_STATUS_DISMISSED,
          }),
        }),
        db.student.count({ where: { status: STUDENT_STATUS_ARCHIVED } }),
        db.student.count({
          where: combineStudentWhere(
            filteredWhere,
            activeCourseIds.length
              ? { courseId: { notIn: activeCourseIds } }
              : undefined,
          ),
        }),
      ]);

    return NextResponse.json({
      systemTotal,
      total,
      active,
      dismissed,
      archived,
      noActiveChapter,
      scope: "visible-except-archived" as const,
      source: "database" as const,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات الطلاب من بيانات النظام حالياً.",
    );
  }
}
