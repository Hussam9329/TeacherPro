import type { Prisma } from "@prisma/client";
import { normalizeListFilter } from "@/lib/all-filter";
import { db } from "@/lib/db";

export type StudentRegistryActiveCourseLink = {
  courseId: string;
  chapter: { opportunities: number };
};

function normalizedOpportunityLimit(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function groupActiveLinksByCourse(
  activeLinks: readonly StudentRegistryActiveCourseLink[],
): Map<string, StudentRegistryActiveCourseLink[]> {
  const grouped = new Map<string, StudentRegistryActiveCourseLink[]>();
  for (const link of activeLinks) {
    const list = grouped.get(link.courseId) || [];
    list.push(link);
    grouped.set(link.courseId, list);
  }
  return grouped;
}

export function studentRegistryNoActiveChapterWhere(): Prisma.StudentWhereInput {
  return {
    course: {
      chapters: {
        none: { active: true, archived: false },
      },
    },
  };
}

export async function loadStudentRegistryActiveCourseLinks(): Promise<
  StudentRegistryActiveCourseLink[]
> {
  return db.courseChapter.findMany({
    where: { active: true, archived: false },
    select: {
      courseId: true,
      chapter: { select: { opportunities: true } },
    },
  });
}

export function buildStudentRegistryIssueWhereFromLinks(
  registryIssue: string,
  activeLinks: readonly StudentRegistryActiveCourseLink[],
): Prisma.StudentWhereInput | null {
  if (registryIssue === "no-active-chapter") {
    return studentRegistryNoActiveChapterWhere();
  }

  const grouped = groupActiveLinksByCourse(activeLinks);

  if (registryIssue === "active-chapter-conflict") {
    const conflictCourseIds = Array.from(grouped.entries())
      .filter(([, links]) => links.length > 1)
      .map(([courseId]) => courseId);
    return conflictCourseIds.length
      ? { courseId: { in: conflictCourseIds } }
      : { id: "__none__" };
  }

  if (registryIssue === "zero-opportunity-limit") {
    const zeroLimitCourseIds = Array.from(grouped.entries())
      .filter(
        ([, links]) =>
          links.length === 1 &&
          normalizedOpportunityLimit(links[0].chapter.opportunities) === 0,
      )
      .map(([courseId]) => courseId);
    return zeroLimitCourseIds.length
      ? { courseId: { in: zeroLimitCourseIds } }
      : { id: "__none__" };
  }

  if (
    registryIssue === "opportunity-full" ||
    registryIssue === "opportunity-over-limit"
  ) {
    const or = Array.from(grouped.entries())
      .filter(([, links]) => links.length === 1)
      .map(([courseId, links]) => ({
        courseId,
        cap: normalizedOpportunityLimit(links[0].chapter.opportunities),
      }))
      .filter(({ cap }) => cap > 0)
      .map(({ courseId, cap }) => ({
        courseId,
        opportunities:
          registryIssue === "opportunity-full" ? cap : { gt: cap },
      }));
    return or.length ? { OR: or } : { id: "__none__" };
  }

  return null;
}

/**
 * Builds the database predicate used by every student-registry read.
 *
 * Keeping this in one server-only helper prevents the paginated list and the
 * full export from silently disagreeing about chapter/opportunity health.
 */
export async function buildStudentRegistryIssueWhere(
  searchParams: URLSearchParams,
): Promise<Prisma.StudentWhereInput | null> {
  const registryIssue = normalizeListFilter(searchParams.get("registryIssue"));
  if (!registryIssue) return null;

  if (registryIssue === "missing-contact") {
    return {
      OR: [
        { phone: null },
        { phone: "" },
        { parentPhone: null },
        { parentPhone: "" },
      ],
    };
  }

  if (registryIssue === "no-telegram") {
    return {
      OR: [{ telegram: null }, { telegram: "" }],
    };
  }

  if (registryIssue === "zero-opportunities") {
    return { status: "نشط", opportunities: 0 };
  }

  if (registryIssue === "no-active-chapter") {
    return studentRegistryNoActiveChapterWhere();
  }

  const activeLinks = await loadStudentRegistryActiveCourseLinks();
  return buildStudentRegistryIssueWhereFromLinks(registryIssue, activeLinks);
}
