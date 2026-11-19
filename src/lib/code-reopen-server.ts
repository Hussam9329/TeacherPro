import type { Prisma } from "@prisma/client";

/**
 * «رجعوا وكودهم مغلق»: a student who is active again while the platform code
 * closed in a dismissal was never marked open. Returns before this day are
 * not listed: their codes were opened by hand, with no mark to clear.
 */
export const CODE_REOPEN_TRACKING_SINCE = new Date("2026-11-18T00:00:00+03:00");

/** What every way of returning a student writes on their file. */
const RETURN_NOTE_STARTS = ["تم تعهد الطالب", "استعادة الطالب", "رجع الطالب تلقائياً"];

export function awaitingCodeReopenWhere(): Prisma.StudentWhereInput {
  return {
    status: "نشط",
    closurePlatformEpoch: { not: null },
    OR: [
      { opportunityLogs: { some: { action: "إعادة تفعيل", date: { gte: CODE_REOPEN_TRACKING_SINCE } } } },
      {
        studentNotes: {
          some: {
            kind: "إجراء",
            date: { gte: CODE_REOPEN_TRACKING_SINCE },
            OR: RETURN_NOTE_STARTS.map((start) => ({ text: { startsWith: start } })),
          },
        },
      },
    ],
  };
}

export const AWAITING_CODE_REOPEN_SELECT = {
  id: true,
  name: true,
  code: true,
  phone: true,
  dismissedCheckEpoch: true,
  closurePlatformEpoch: true,
  course: { select: { name: true } },
} as const satisfies Prisma.StudentSelect;
