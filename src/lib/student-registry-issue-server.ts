import type { Prisma } from "@prisma/client";
import { normalizeListFilter } from "@/lib/all-filter";
import { db } from "@/lib/db";

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
      OR: [{ telegram: null }, { telegram: "" }, { telegramKey: null }],
    };
  }

  if (registryIssue === "zero-opportunities") {
    return { status: "نشط", opportunities: 0 };
  }

  const activeLinks = await db.courseChapter.findMany({
    where: { active: true, archived: false },
    select: {
      courseId: true,
      chapter: { select: { opportunities: true } },
    },
  });
  const grouped = new Map<string, typeof activeLinks>();
  for (const link of activeLinks) {
    const list = grouped.get(link.courseId) || [];
    list.push(link);
    grouped.set(link.courseId, list);
  }

  if (registryIssue === "active-chapter-conflict") {
    const conflictCourseIds = Array.from(grouped.entries())
      .filter(([, links]) => links.length > 1)
      .map(([courseId]) => courseId);
    return conflictCourseIds.length
      ? { courseId: { in: conflictCourseIds } }
      : { id: "__none__" };
  }

  if (registryIssue === "no-active-chapter") {
    const allCourses = await db.course.findMany({ select: { id: true } });
    const noActiveCourseIds = allCourses
      .map((course) => course.id)
      .filter((courseId) => {
        const links = grouped.get(courseId) || [];
        const cap =
          links.length === 1 ? Number(links[0].chapter.opportunities || 0) : 0;
        return links.length !== 1 || cap <= 0;
      });
    return noActiveCourseIds.length
      ? { courseId: { in: noActiveCourseIds } }
      : { id: "__none__" };
  }

  if (
    registryIssue === "opportunity-full" ||
    registryIssue === "opportunity-over-limit"
  ) {
    const courseCaps = Array.from(grouped.entries())
      .map(([courseId, links]) => ({
        courseId,
        cap:
          links.length === 1
            ? Math.max(
                0,
                Math.trunc(Number(links[0].chapter.opportunities || 0)),
              )
            : 0,
      }))
      .filter((item) => item.cap > 0);
    const or = courseCaps.map(({ courseId, cap }) => ({
      courseId,
      opportunities:
        registryIssue === "opportunity-full" ? { gte: cap } : { gt: cap },
    }));
    return or.length ? { OR: or } : { id: "__none__" };
  }

  return null;
}
