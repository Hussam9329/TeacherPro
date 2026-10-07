import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { CALL_WINDOW_AWAY_MS, CALL_WINDOW_TTL_MS, pickCallBatch } from "@/lib/call-batch";

/**
 * The database side of «دفعات» in إدارة المكالمات (rules: call-batch.ts).
 * Plain SQL keeps every step one statement, and the unique
 * (studentId, examId) key decides any race: two windows reaching for the
 * same student at the same moment cannot both get them.
 */
type RawClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

export type CallWindowOwner = { id: string; name: string };

export type CallHolder = {
  studentId: string;
  windowId: string;
  userId: string;
  userName: string;
};

export type LiveCallWindow = {
  id: string;
  userId: string;
  userName: string;
  courseId: string;
  examId: string;
  openedAt: Date;
  lastSeenAt: Date;
  awayUntil: Date | null;
  held: number;
};

function cutoff(now: Date): Date {
  return new Date(now.getTime() - CALL_WINDOW_TTL_MS);
}

/**
 * Drops windows that are gone: silent past the timeout and not away (or
 * away past their grace). The students they held go with them.
 */
export async function releaseStaleCallWindows(client: RawClient, now = new Date()): Promise<void> {
  await client.$executeRaw`
    DELETE FROM "CallWindow"
    WHERE "lastSeenAt" < ${cutoff(now)} AND ("awayUntil" IS NULL OR "awayUntil" < ${now})`;
}

/**
 * Records that this window is open on this exam. A window that moved to
 * another exam or course lets go of what it held elsewhere. A window belongs
 * to the account that opened it: another account cannot take it over, and
 * gets false. `away`: the page went to the background, so its batch stays
 * held for CALL_WINDOW_AWAY_MS; any later beat from the page ends that.
 */
export async function touchCallWindow(
  client: RawClient,
  window: { id: string; owner: CallWindowOwner; courseId: string; examId: string },
  now = new Date(),
  options: { away?: boolean } = {},
): Promise<boolean> {
  const awayUntil = options.away ? new Date(now.getTime() + CALL_WINDOW_AWAY_MS) : null;
  const touched = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "CallWindow" ("id", "userId", "userName", "courseId", "examId", "openedAt", "lastSeenAt", "awayUntil")
    VALUES (${window.id}, ${window.owner.id}, ${window.owner.name}, ${window.courseId}, ${window.examId}, ${now}, ${now}, ${awayUntil})
    ON CONFLICT ("id") DO UPDATE SET
      "userName" = EXCLUDED."userName",
      "courseId" = EXCLUDED."courseId",
      "examId" = EXCLUDED."examId",
      "lastSeenAt" = EXCLUDED."lastSeenAt",
      "awayUntil" = EXCLUDED."awayUntil"
    WHERE "CallWindow"."userId" = EXCLUDED."userId"
    RETURNING "id"`;
  if (!touched.length) return false;
  await client.$executeRaw`
    DELETE FROM "CallReservation" WHERE "windowId" = ${window.id} AND "examId" <> ${window.examId}`;
  return true;
}

/** A window closed: everything it held goes back to everyone at once. */
export async function closeCallWindow(client: RawClient, windowId: string, ownerId: string): Promise<void> {
  await client.$executeRaw`DELETE FROM "CallWindow" WHERE "id" = ${windowId} AND "userId" = ${ownerId}`;
}

/** Lets go of this window's batch for one exam (its filters changed). */
export async function releaseCallBatch(client: RawClient, windowId: string, examId: string): Promise<void> {
  await client.$executeRaw`
    DELETE FROM "CallReservation" WHERE "windowId" = ${windowId} AND "examId" = ${examId}`;
}

/** Who holds which student of this exam, counting live windows only (beating, or away within their grace). */
export async function liveCallHolders(client: RawClient, examId: string, now = new Date()): Promise<CallHolder[]> {
  return client.$queryRaw<CallHolder[]>`
    SELECT r."studentId", r."windowId", w."userId", w."userName"
    FROM "CallReservation" r
    JOIN "CallWindow" w ON w."id" = r."windowId"
    WHERE r."examId" = ${examId}
      AND (w."lastSeenAt" >= ${cutoff(now)} OR w."awayUntil" >= ${now})`;
}

/** The students this window holds on this exam right now. */
export async function heldByCallWindow(
  client: RawClient,
  windowId: string,
  examId: string,
  now = new Date(),
): Promise<string[]> {
  return (await liveCallHolders(client, examId, now))
    .filter((holder) => holder.windowId === windowId)
    .map((holder) => holder.studentId);
}

/** How many other windows are open on this exam now («يشتغل ويّاك»). */
export async function countOtherLiveCallWindows(
  client: RawClient,
  examId: string,
  windowId: string,
  now = new Date(),
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS "count" FROM "CallWindow"
    WHERE "examId" = ${examId} AND "id" <> ${windowId}
      AND ("lastSeenAt" >= ${cutoff(now)} OR "awayUntil" >= ${now})`;
  return Number(rows[0]?.count || 0);
}

/** Ends the hold on a student (any contact action, or the case is gone). */
export async function dropCallHold(client: RawClient, studentId: string, examId: string): Promise<void> {
  await client.$executeRaw`
    DELETE FROM "CallReservation" WHERE "studentId" = ${studentId} AND "examId" = ${examId}`;
}

/** Holds one student for the account's own live window unless someone else already does. */
export async function holdCallCase(
  client: RawClient,
  window: { id: string; ownerId: string },
  studentId: string,
  examId: string,
  now = new Date(),
): Promise<boolean> {
  const inserted = await client.$executeRaw`
    INSERT INTO "CallReservation" ("id", "studentId", "examId", "windowId", "reservedAt")
    SELECT ${randomUUID()}, ${studentId}, ${examId}, w."id", ${now}
    FROM "CallWindow" w
    WHERE w."id" = ${window.id} AND w."userId" = ${window.ownerId}
      AND (w."lastSeenAt" >= ${cutoff(now)} OR w."awayUntil" >= ${now})
    ON CONFLICT ("studentId", "examId") DO NOTHING`;
  return inserted > 0;
}

/**
 * Fills this window's batch from the open students, in list order, skipping
 * anyone held. Returns the students the window holds afterwards.
 */
export async function claimCallBatch(
  client: RawClient,
  args: { windowId: string; ownerId: string; examId: string; openStudentIds: readonly string[]; size: number },
  now = new Date(),
): Promise<Set<string>> {
  const mine = async () => new Set(await heldByCallWindow(client, args.windowId, args.examId, now));
  let held = await mine();
  // A student someone else took a moment ago is skipped and the next tried.
  for (let attempt = 0; attempt < 3 && held.size < args.size; attempt += 1) {
    const taken = new Set((await liveCallHolders(client, args.examId, now)).map((holder) => holder.studentId));
    const wanted = pickCallBatch(args.openStudentIds, taken, args.size - held.size);
    if (!wanted.length) break;
    for (const studentId of wanted) {
      await holdCallCase(client, { id: args.windowId, ownerId: args.ownerId }, studentId, args.examId, now);
    }
    held = await mine();
  }
  return held;
}

/** Every open window with how many students it still holds (the admin's view). */
export async function liveCallWindows(client: RawClient, now = new Date()): Promise<LiveCallWindow[]> {
  const rows = await client.$queryRaw<Array<Omit<LiveCallWindow, "held"> & { held: bigint | number }>>`
    SELECT w."id", w."userId", w."userName", w."courseId", w."examId", w."openedAt", w."lastSeenAt", w."awayUntil",
      COUNT(r."id") AS "held"
    FROM "CallWindow" w
    LEFT JOIN "CallReservation" r ON r."windowId" = w."id"
    WHERE w."lastSeenAt" >= ${cutoff(now)} OR w."awayUntil" >= ${now}
    GROUP BY w."id"
    ORDER BY w."userName", w."openedAt"`;
  return rows.map((row) => ({ ...row, held: Number(row.held) }));
}
