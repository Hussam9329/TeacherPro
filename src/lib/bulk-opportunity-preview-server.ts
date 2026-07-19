import type { Prisma } from "@prisma/client";
import {
  buildOpportunityFilters,
  composeStudentWhere,
} from "@/lib/opportunity-filters-server";
import { attachStudentOpportunitySnapshotsWithClient } from "@/lib/student-opportunity-snapshot-server";
import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";

export type BulkOpportunityPreviewInput = {
  courseId: string;
  status: string;
  opportunityCount: string;
  q: string;
  actionType: "add" | "deduct";
  excludeDismissed: boolean;
  excludeFullOpportunities: boolean;
  reactivateDismissedOnAdd: boolean;
};

export async function buildBulkOpportunityPreview(
  client: Prisma.TransactionClient,
  input: BulkOpportunityPreviewInput,
) {
  const filters = buildOpportunityFilters(input);
  const candidateRows = await client.student.findMany({
    where: composeStudentWhere(filters),
    select: {
      id: true,
      status: true,
      opportunities: true,
      baseOpportunities: true,
      courseId: true,
    },
  });
  const snapshots =
    await attachStudentOpportunitySnapshotsWithClient(client, candidateRows);
  const eligibleRows = snapshots.filter(
    (student) => student.opportunityHealth === "ready",
  );
  const targetRows = eligibleRows.filter((student) => {
    if (input.excludeDismissed && student.status === "مفصول") return false;
    if (
      input.actionType === "add" &&
      student.status === "مفصول" &&
      !input.reactivateDismissedOnAdd
    ) {
      return false;
    }
    if (
      input.actionType === "deduct" &&
      input.excludeFullOpportunities &&
      student.isOpportunityFull
    ) {
      return false;
    }
    return true;
  });

  const noActiveChapter = snapshots.filter(
    (student) => student.opportunityHealth === "missing-active-chapter",
  ).length;
  const activeChapterConflicts = snapshots.filter(
    (student) => student.opportunityHealth === "active-chapter-conflict",
  ).length;
  const zeroOpportunityLimit = snapshots.filter(
    (student) => student.opportunityHealth === "zero-limit",
  ).length;
  const excludedDismissed = input.excludeDismissed
    ? eligibleRows.filter((student) => student.status === "مفصول").length
    : input.actionType === "add" && !input.reactivateDismissedOnAdd
      ? eligibleRows.filter((student) => student.status === "مفصول").length
      : 0;
  const excludedFullOpportunities =
    input.actionType === "deduct" && input.excludeFullOpportunities
      ? eligibleRows.filter((student) => student.isOpportunityFull).length
      : 0;

  const previewToken = buildMutationPreviewToken("bulk-opportunity-adjust", {
    input,
    students: snapshots
      .map((student) => ({
        id: student.id,
        status: student.status,
        courseId: student.courseId,
        opportunities: student.opportunities,
        baseOpportunities: student.baseOpportunities,
        opportunityHealth: student.opportunityHealth,
        opportunityLimit: student.opportunityLimit,
        activeChapterConflictCount: student.activeChapterConflictCount,
        activeChapter: student.activeChapter,
        isOpportunityFull: student.isOpportunityFull,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });

  return {
    candidateRows,
    snapshots,
    eligibleRows,
    targetRows,
    totalMatching: candidateRows.length,
    eligibleWithActiveChapter: eligibleRows.length,
    noActiveChapter,
    activeChapterConflicts,
    zeroOpportunityLimit,
    invalidOpportunitySource:
      noActiveChapter + activeChapterConflicts + zeroOpportunityLimit,
    excludedDismissed,
    excludedFullOpportunities,
    skipped: Math.max(0, candidateRows.length - targetRows.length),
    targetCount: targetRows.length,
    previewToken,
  };
}
