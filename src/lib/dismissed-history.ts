type DismissalLogLike = {
  action?: unknown;
  reason?: unknown;
};

type DismissalNoteLike = {
  kind?: unknown;
  text?: unknown;
  dismissalType?: unknown;
};

export const DISMISSED_TELEGRAM_DRAFT_MAX_LENGTH = 1800;

type TelegramDraftParts = {
  header: string;
  timeline: string;
  footer: string;
  maxLength?: number;
};

export type DismissedHistoryAccess = {
  grades: boolean;
  opportunities: boolean;
  correction: boolean;
  archives: boolean;
  calls: boolean;
  leaves: boolean;
  studentNotes: boolean;
  allStudentNotes: boolean;
};

type DismissedHistoryAccessInput = {
  isAdmin: boolean;
  permissions: string[];
  baseAccess: Pick<
    DismissedHistoryAccess,
    "grades" | "opportunities" | "correction" | "archives"
  >;
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildDismissedHistoryAccess({
  isAdmin,
  permissions,
  baseAccess,
}: DismissedHistoryAccessInput): DismissedHistoryAccess {
  const granted = new Set(permissions);
  const hasAny = (...tokens: string[]) =>
    isAdmin || tokens.some((token) => granted.has(token));
  const broadFollowUp = hasAny("follow-up.view", "follow-up.manage");
  const calls =
    broadFollowUp ||
    hasAny(
      "follow-up.calls.view",
      "follow-up.calls.manage",
      "page.follow-up-calls.view",
    );
  const leaves =
    broadFollowUp ||
    hasAny(
      "follow-up.leaves.view",
      "follow-up.leaves.manage",
      "page.follow-up-leaves.view",
    );
  const pledgeNotes = hasAny(
    "follow-up.pledges.view",
    "follow-up.pledges.manage",
    "page.follow-up-pledges.view",
  );

  return {
    ...baseAccess,
    calls,
    leaves,
    studentNotes: broadFollowUp || pledgeNotes,
    allStudentNotes: broadFollowUp,
  };
}

/**
 * Matches only the authoritative opportunity-log shapes used when a student
 * is dismissed. Reactivation logs deliberately mention "فصل الطالب" in their
 * reason, so a broad substring match would produce a false dismissal event.
 */
export function isDismissalOpportunityLog(log: DismissalLogLike): boolean {
  const action = cleanText(log.action);
  const reason = cleanText(log.reason);
  return (
    action === "فصل تلقائي" ||
    (action === "خصم" && reason.startsWith("فصل الطالب"))
  );
}

/**
 * Pledge notes also carry dismissal metadata, but they are not dismissal
 * events. Only an action note whose text records the dismissal is accepted.
 */
export function isDismissalActionNote(note: DismissalNoteLike): boolean {
  if (cleanText(note.kind) !== "إجراء") return false;
  const noteText = cleanText(note.text);
  return (
    /^(?:فصل الطالب|تم فصل الطالب)(?:\s|$|\(|:)/u.test(noteText) ||
    Boolean(cleanText(note.dismissalType) && noteText.startsWith("فصل"))
  );
}

export function buildBoundedTelegramDraft({
  header,
  timeline,
  footer,
  maxLength = DISMISSED_TELEGRAM_DRAFT_MAX_LENGTH,
}: TelegramDraftParts): string {
  const fullMessage = [header, timeline, footer].filter(Boolean).join("\n\n");
  if (fullMessage.length <= maxLength) return fullMessage;

  const notice =
    "تم اختصار الرسالة بسبب حد تيليجرام. السجل الكامل متاح عبر تصدير HTML.";
  const prefix = `${header}\n\n`;
  const suffix = `\n\n${notice}\n\n${footer}`;
  const availableTimelineLength = Math.max(
    0,
    maxLength - prefix.length - suffix.length - 1,
  );
  const clippedTimeline = timeline
    .slice(0, availableTimelineLength)
    .trimEnd();
  return `${prefix}${clippedTimeline}…${suffix}`;
}

export function escapeDismissedHistoryHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function safeDismissedHistoryFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
