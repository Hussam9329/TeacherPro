import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type OpportunityLimitSource =
  | "active-chapter"
  | "no-active-chapter"
  | "active-chapter-conflict";

export type OpportunityHealth =
  | "ready"
  | "zero-limit"
  | "missing-active-chapter"
  | "active-chapter-conflict";

export interface OpportunitySnapshotSourceStudent {
  courseId: string;
  opportunities: number;
  baseOpportunities: number;
}

export interface OpportunityActiveLinkSnapshot {
  courseId: string;
  chapter: {
    id: string;
    name: string;
    opportunities: number;
  };
}

export interface StudentOpportunitySnapshot {
  opportunities: number;
  baseOpportunities: number;
  opportunityLimit: number | null;
  opportunitySource: "student-record";
  opportunityLimitSource: OpportunityLimitSource;
  opportunityHealth: OpportunityHealth;
  hasActiveChapter: boolean;
  activeChapterConflictCount: number;
  activeChapter: {
    id: string;
    name: string;
    opportunities: number;
  } | null;
  isOpportunityFull: boolean;
  isOpportunityOverLimit: boolean;
}

function opportunityNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

/**
 * Builds the authoritative opportunity snapshot without any database reads.
 *
 * Current balance always comes from Student.opportunities. The limit always
 * comes from the single active, non-archived chapter for the student's course.
 * Stored baseOpportunities is returned for audit/backward compatibility only;
 * it is never used as the authoritative limit when the active chapter is
 * missing or conflicting.
 */
export function attachStudentOpportunitySnapshotsFromLinks<
  T extends OpportunitySnapshotSourceStudent,
>(
  students: readonly T[],
  activeLinks: readonly OpportunityActiveLinkSnapshot[],
): Array<T & StudentOpportunitySnapshot> {
  const activeLinksByCourseId = new Map<
    string,
    OpportunityActiveLinkSnapshot[]
  >();

  for (const link of activeLinks) {
    const list = activeLinksByCourseId.get(link.courseId) || [];
    list.push(link);
    activeLinksByCourseId.set(link.courseId, list);
  }

  return students.map((student) => {
    const links = activeLinksByCourseId.get(student.courseId) || [];
    const uniqueLink = links.length === 1 ? links[0] : null;
    const activeChapter = uniqueLink
      ? {
          id: uniqueLink.chapter.id,
          name: uniqueLink.chapter.name,
          opportunities: opportunityNumber(uniqueLink.chapter.opportunities),
        }
      : null;
    const current = opportunityNumber(student.opportunities);
    const storedBase = opportunityNumber(student.baseOpportunities);
    const opportunityLimit = activeChapter?.opportunities ?? null;
    const hasActiveChapter = Boolean(
      activeChapter && opportunityLimit !== null && opportunityLimit > 0,
    );
    const opportunityLimitSource: OpportunityLimitSource =
      links.length > 1
        ? "active-chapter-conflict"
        : activeChapter
          ? "active-chapter"
          : "no-active-chapter";
    const opportunityHealth: OpportunityHealth =
      links.length > 1
        ? "active-chapter-conflict"
        : !activeChapter
          ? "missing-active-chapter"
          : opportunityLimit === 0
            ? "zero-limit"
            : "ready";

    return {
      ...student,
      opportunities: current,
      baseOpportunities: storedBase,
      opportunityLimit,
      opportunitySource: "student-record" as const,
      opportunityLimitSource,
      opportunityHealth,
      hasActiveChapter,
      activeChapterConflictCount: links.length,
      activeChapter,
      isOpportunityFull:
        opportunityLimit !== null && opportunityLimit > 0
          ? current >= opportunityLimit
          : false,
      isOpportunityOverLimit:
        opportunityLimit !== null ? current > opportunityLimit : false,
    };
  });
}

/**
 * Loads all active chapter links in one batched query for the supplied
 * students. Accepting a transaction client keeps previews and writes on the
 * exact same source snapshot while avoiding N+1 reads.
 */
export async function attachStudentOpportunitySnapshotsWithClient<
  T extends OpportunitySnapshotSourceStudent,
>(
  client: Pick<Prisma.TransactionClient, "courseChapter">,
  students: readonly T[],
): Promise<Array<T & StudentOpportunitySnapshot>> {
  if (students.length === 0) return [];

  const courseIds = Array.from(
    new Set(students.map((student) => student.courseId).filter(Boolean)),
  );
  if (courseIds.length === 0) {
    return attachStudentOpportunitySnapshotsFromLinks(students, []);
  }

  const activeLinks = await client.courseChapter.findMany({
    where: {
      courseId: { in: courseIds },
      active: true,
      archived: false,
    },
    select: {
      courseId: true,
      chapter: {
        select: { id: true, name: true, opportunities: true },
      },
    },
  });

  return attachStudentOpportunitySnapshotsFromLinks(students, activeLinks);
}

/**
 * Default database-backed variant used by routes that are not already inside
 * a transaction.
 */
export async function attachStudentOpportunitySnapshots<
  T extends OpportunitySnapshotSourceStudent,
>(students: readonly T[]): Promise<Array<T & StudentOpportunitySnapshot>> {
  return attachStudentOpportunitySnapshotsWithClient(db, students);
}
