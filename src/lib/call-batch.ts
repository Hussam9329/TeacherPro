/**
 * «دفعات» in إدارة المكالمات: each open calls window holds a small batch of
 * students that nobody else gets, so two people never call the same student.
 *
 * - A window takes a batch only when asked, and only from students nobody holds.
 * - Any contact action («تم الاتصال», «لم يرد», «الرقم خاطئ») ends the hold.
 * - A window that stops beating (crashed, offline) is dropped after
 *   CALL_WINDOW_TTL_MS and its untouched students go back to everyone.
 * - A window that went to the background (the caller is on a call from the
 *   same phone, the screen locked) says so, and keeps its batch for
 *   CALL_WINDOW_AWAY_MS. Closing the page gives the batch back at once.
 * - A window only shows students it still holds: when a beat finds one gone,
 *   the list reloads.
 * - A student is only called by whoever holds them: outside «دفعتي» (other
 *   chips, search) the numbers show after «خذه للاتصال» holds the student,
 *   and never while someone else holds them.
 * - «لم يرد» comes back to the shared list after CALL_NO_ANSWER_RETRY_MS.
 *
 * Pure rules only; the database side is call-reservations-server.ts.
 */
export const CALL_BATCH_SIZE = 10;
export const CALL_WINDOW_TTL_MS = 2 * 60 * 1000;
export const CALL_WINDOW_HEARTBEAT_MS = 30 * 1000;
export const CALL_WINDOW_AWAY_MS = 15 * 60 * 1000;
/**
 * The calls page's protocol. A page from before batches (or before a rule
 * change) keeps running old code until reloaded; the server refuses its list
 * so it cannot show students that are in someone else's batch.
 */
export const CALL_CLIENT_PROTOCOL = 2;
export const CALL_NO_ANSWER_RETRY_MS = 60 * 60 * 1000;

/** A window id is made by the browser; anything else is refused. */
export function parseCallWindowId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

export function callWindowAlive(
  lastSeenAt: Date | string,
  now = new Date(),
  awayUntil: Date | string | null = null,
): boolean {
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isFinite(seen) && now.getTime() - seen <= CALL_WINDOW_TTL_MS) return true;
  const away = awayUntil ? new Date(awayUntil).getTime() : NaN;
  return Number.isFinite(away) && away >= now.getTime();
}

type ContactCallLike = {
  status?: string | null;
  completed?: boolean | null;
  actedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

/** Whether a student still needs a call: no action yet, or «لم يرد» an hour ago or more. */
export function callCaseOpenForBatch(call: ContactCallLike | null | undefined, now = new Date()): boolean {
  if (!call) return true;
  const status = String(call.status || "").trim();
  if (!status) return !call.completed;
  if (status !== "لم يرد") return false;
  const at = new Date(call.actedAt || call.createdAt || 0).getTime();
  return !Number.isFinite(at) || now.getTime() - at >= CALL_NO_ANSWER_RETRY_MS;
}

/** The next students for a batch, in list order, skipping anyone already held. */
export function pickCallBatch(
  orderedStudentIds: readonly string[],
  held: ReadonlySet<string>,
  size = CALL_BATCH_SIZE,
): string[] {
  const picked: string[] = [];
  for (const id of orderedStudentIds) {
    if (picked.length >= size) break;
    if (!held.has(id) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}
