/**
 * «التعهد»: a dismissed student returns active with two opportunities after
 * signing a pledge. A student may pledge at most twice in one chapter; after
 * that, «إرجاع الطالب» in «إدارة المفصولين» is closed for him until the next
 * chapter. Every other path (grade corrections, leaves, opportunity additions,
 * archive restore, transfer) is unchanged.
 *
 * A pledge is read from the ledger row that grants its two opportunities:
 * - «رصيد بعد تعهد»: pledges recorded before 2026-08-28.
 * - «رصيد إعادة التفعيل» written by the pledge return itself (no requested
 *   amount, the fixed pledge reason). A return with chosen opportunities sets
 *   requestedAmount and its own reason, so it is never counted.
 */
export const PLEDGE_LIMIT_PER_CHAPTER = 2;
export const PLEDGE_LIMIT_REACHED_REASON = "نفاد عدد التعهدات للفصل الواحد";

/** Reason the pledge return writes on its balance row. */
export const PLEDGE_BALANCE_REASON =
  "تم تعهد الطالب: إرجاعه إلى الحالة النشطة برصيد فرصتين بسبب التعهد";
/** The same return between 2026-08-28 and 2026-09-03, before it was renamed back to «تعهد». */
const PLEDGE_BALANCE_REASON_RENAMED = "إرجاع الطالب إلى الحالة النشطة برصيد فرصتين";
export const PLEDGE_BALANCE_REASONS = [PLEDGE_BALANCE_REASON, PLEDGE_BALANCE_REASON_RENAMED];
export const PLEDGE_BALANCE_ACTION = "رصيد إعادة التفعيل";
export const LEGACY_PLEDGE_BALANCE_ACTION = "رصيد بعد تعهد";

/** Audit rows written with a pledge return; they name who recorded it. */
export const PLEDGE_AUDIT_ACTION = "تم تعهد الطالب - إعادة تفعيل بفرصتين";
export const PLEDGE_AUDIT_ACTIONS = [PLEDGE_AUDIT_ACTION, "إعادة تفعيل الطالب برصيد فرصتين"];

export function isPledgeOpportunityLog(log: {
  action?: unknown;
  reason?: unknown;
  requestedAmount?: unknown;
}): boolean {
  const action = String(log.action ?? "").trim();
  if (action === LEGACY_PLEDGE_BALANCE_ACTION) return true;
  return action === PLEDGE_BALANCE_ACTION &&
    (log.requestedAmount === null || log.requestedAmount === undefined) &&
    PLEDGE_BALANCE_REASONS.includes(String(log.reason ?? "").trim());
}

export function isPledgeLimitReached(count: number): boolean {
  return count >= PLEDGE_LIMIT_PER_CHAPTER;
}

/** What a student card shows: his pledges in the active chapter of his course. */
export type StudentPledgeSummary = {
  chapterId: string | null;
  chapterName: string;
  count: number;
  limit: number;
  limitReached: boolean;
  /** ISO dates, oldest first. */
  dates: string[];
};

export function emptyPledgeSummary(chapter: { id: string; name: string } | null): StudentPledgeSummary {
  return {
    chapterId: chapter?.id ?? null,
    chapterName: chapter?.name ?? "",
    count: 0,
    limit: PLEDGE_LIMIT_PER_CHAPTER,
    limitReached: false,
    dates: [],
  };
}

export function pledgeLimitReachedMessage(input: { name: string; count: number; chapterName: string }): string {
  return `${PLEDGE_LIMIT_REACHED_REASON}: «${input.name}» وقّع ${input.count} تعهدات في «${input.chapterName}»، والحد ${PLEDGE_LIMIT_PER_CHAPTER}. لا يمكن إرجاعه من إدارة المفصولين حتى الفصل القادم.`;
}

/** One row of «قائمة التعهدات»: a student and a chapter he pledged in. */
export type PledgeListEntry = { date: string; recordedBy: string };

export type PledgeListRow = {
  key: string;
  studentId: string;
  name: string;
  code: string;
  courseId: string;
  status: string;
  chapterId: string | null;
  chapterName: string;
  isActiveChapter: boolean;
  count: number;
  limit: number;
  limitReached: boolean;
  pledges: PledgeListEntry[];
  lastDate: string;
};
