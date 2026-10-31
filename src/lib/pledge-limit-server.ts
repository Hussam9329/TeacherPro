import type { Prisma, PrismaClient } from "@prisma/client";
import {
  LEGACY_PLEDGE_BALANCE_ACTION,
  PLEDGE_AUDIT_ACTIONS,
  PLEDGE_BALANCE_ACTION,
  PLEDGE_BALANCE_REASONS,
  PLEDGE_LIMIT_PER_CHAPTER,
  emptyPledgeSummary,
  isPledgeLimitReached,
  pledgeLimitReachedMessage,
  pledgesRemaining,
  type PledgeListRow,
  type StudentPledgeSummary,
} from "./pledge-limit";
import { StudentActionError } from "./manual-student-restoration-server";

type Reader = PrismaClient | Prisma.TransactionClient;

/** The ledger rows that are pledges; see isPledgeOpportunityLog. */
export const PLEDGE_LOG_WHERE: Prisma.OpportunityLogWhereInput = {
  OR: [
    { action: LEGACY_PLEDGE_BALANCE_ACTION },
    { action: PLEDGE_BALANCE_ACTION, requestedAmount: null, reason: { in: PLEDGE_BALANCE_REASONS } },
  ],
};

async function countChapterPledges(reader: Reader, studentId: string, chapterId: string) {
  return reader.opportunityLog.count({ where: { AND: [PLEDGE_LOG_WHERE, { studentId, chapterId }] } });
}

/**
 * Refuses «إرجاع الطالب» once the student pledged PLEDGE_LIMIT_PER_CHAPTER
 * times in the active chapter of his course. Runs inside the caller's
 * SERIALIZABLE transaction, so two returns at once cannot both pass.
 * Without an active chapter the caller already refuses the return.
 */
export async function assertPledgeLimitNotReached(
  tx: Prisma.TransactionClient,
  student: { id: string; name: string; courseId: string },
) {
  const [link] = await tx.courseChapter.findMany({
    where: { courseId: student.courseId, active: true, archived: false },
    select: { chapter: { select: { id: true, name: true } } },
    take: 1,
  });
  if (!link) return;
  const chapter = link.chapter;
  const count = await countChapterPledges(tx, student.id, chapter.id);
  if (isPledgeLimitReached(count)) {
    throw new StudentActionError(pledgeLimitReachedMessage({ name: student.name, count, chapterName: chapter.name }));
  }
}

/** Adds `pledges` (his pledges in his course's active chapter) to each student. */
export async function attachStudentPledgeSummaries<
  T extends { id: string; activeChapter?: { id: string; name: string } | null },
>(reader: Reader, students: T[]): Promise<Array<T & { pledges: StudentPledgeSummary }>> {
  const chapterIds = [...new Set(students.map((s) => s.activeChapter?.id).filter((id): id is string => Boolean(id)))];
  const logs = chapterIds.length
    ? await reader.opportunityLog.findMany({
        where: { AND: [PLEDGE_LOG_WHERE, { studentId: { in: students.map((s) => s.id) }, chapterId: { in: chapterIds } }] },
        select: { studentId: true, chapterId: true, date: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      })
    : [];
  return students.map((student) => {
    const chapter = student.activeChapter ?? null;
    const summary = emptyPledgeSummary(chapter);
    if (chapter) {
      summary.dates = logs
        .filter((log) => log.studentId === student.id && log.chapterId === chapter.id)
        .map((log) => log.date.toISOString());
      summary.count = summary.dates.length;
      summary.limitReached = isPledgeLimitReached(summary.count);
    }
    return { ...student, pledges: summary };
  });
}

export type PledgeListQuery = {
  courseIds: string[];
  chapterScope: "active" | "all";
  count: "" | "1" | "2" | "limit";
  status: "" | "active" | "dismissed" | "archived";
  q: string;
  sort: "count" | "last" | "name";
};

const STATUS_BY_FILTER: Record<string, string> = { active: "نشط", dismissed: "مفصول", archived: "مؤرشف" };
const AUDIT_MATCH_WINDOW_MS = 5000;

/**
 * Who recorded each pledge. The audit row has no student id; it is written in
 * the same transaction as the ledger row, with «name - code» as details. It is
 * matched by the code and the nearest time within AUDIT_MATCH_WINDOW_MS.
 * Pledges older than these audit rows have no recorder («—»).
 */
async function pledgeRecorders(reader: Reader, logs: Array<{ id: string; date: Date; code: string }>) {
  const recorders = new Map<string, string>();
  if (logs.length === 0) return recorders;
  const times = logs.map((log) => log.date.getTime());
  const audits = await reader.auditLog.findMany({
    where: {
      action: { in: PLEDGE_AUDIT_ACTIONS },
      time: { gte: new Date(Math.min(...times) - AUDIT_MATCH_WINDOW_MS), lte: new Date(Math.max(...times) + AUDIT_MATCH_WINDOW_MS) },
    },
    select: { id: true, details: true, time: true, userName: true },
  });
  const used = new Set<string>();
  for (const log of logs) {
    const suffix = ` - ${log.code}`;
    const match = audits
      .filter((audit) => !used.has(audit.id) && String(audit.details || "").endsWith(suffix) &&
        Math.abs(audit.time.getTime() - log.date.getTime()) <= AUDIT_MATCH_WINDOW_MS)
      .sort((a, b) => Math.abs(a.time.getTime() - log.date.getTime()) - Math.abs(b.time.getTime() - log.date.getTime()))[0];
    if (match) {
      used.add(match.id);
      recorders.set(log.id, match.userName || "");
    }
  }
  return recorders;
}

/** «قائمة التعهدات»: one row per student and chapter he pledged in. */
export async function loadPledgeList(reader: Reader, query: PledgeListQuery): Promise<PledgeListRow[]> {
  const q = query.q.trim();
  const logs = await reader.opportunityLog.findMany({
    where: {
      AND: [
        PLEDGE_LOG_WHERE,
        {
          student: {
            ...(query.courseIds.length ? { courseId: { in: query.courseIds } } : {}),
            ...(query.status ? { status: STATUS_BY_FILTER[query.status] } : {}),
            ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
          },
        },
      ],
    },
    select: {
      id: true,
      date: true,
      chapterId: true,
      chapterNameSnapshot: true,
      chapter: { select: { name: true } },
      student: { select: { id: true, name: true, code: true, courseId: true, status: true } },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const courseIds = [...new Set(logs.map((log) => log.student.courseId))];
  const activeLinks = courseIds.length
    ? await reader.courseChapter.findMany({
        where: { courseId: { in: courseIds }, active: true, archived: false },
        select: { courseId: true, chapterId: true },
      })
    : [];
  // The database allows one active chapter per course.
  const activeChapterByCourse = new Map(activeLinks.map((link) => [link.courseId, link.chapterId]));

  const recorders = await pledgeRecorders(reader, logs.map((log) => ({ id: log.id, date: log.date, code: log.student.code })));
  const rows = new Map<string, PledgeListRow>();
  for (const log of logs) {
    const isActiveChapter = Boolean(log.chapterId) &&
      activeChapterByCourse.get(log.student.courseId) === log.chapterId;
    if (query.chapterScope === "active" && !isActiveChapter) continue;
    const key = `${log.student.id}:${log.chapterId ?? "none"}`;
    const row = rows.get(key) ?? {
      key,
      studentId: log.student.id,
      name: log.student.name,
      code: log.student.code,
      courseId: log.student.courseId,
      status: log.student.status,
      chapterId: log.chapterId,
      chapterName: log.chapter?.name || log.chapterNameSnapshot || "فصل غير محدد",
      isActiveChapter,
      count: 0,
      limit: PLEDGE_LIMIT_PER_CHAPTER,
      limitReached: false,
      remaining: PLEDGE_LIMIT_PER_CHAPTER,
      pledges: [],
      lastDate: "",
    };
    row.pledges.push({ date: log.date.toISOString(), recordedBy: recorders.get(log.id) || "" });
    row.count = row.pledges.length;
    row.limitReached = isPledgeLimitReached(row.count);
    row.remaining = pledgesRemaining(row.count);
    row.lastDate = log.date.toISOString();
    rows.set(key, row);
  }

  const countMatches = (row: PledgeListRow) =>
    query.count === "1" ? row.count === 1 :
    query.count === "2" ? row.count === 2 :
    query.count === "limit" ? row.limitReached : true;
  const byName = (a: PledgeListRow, b: PledgeListRow) => a.name.localeCompare(b.name, "ar");
  const byLast = (a: PledgeListRow, b: PledgeListRow) => b.lastDate.localeCompare(a.lastDate);
  return [...rows.values()].filter(countMatches).sort((a, b) =>
    query.sort === "name" ? byName(a, b) || byLast(a, b) :
    query.sort === "last" ? byLast(a, b) || byName(a, b) :
    b.count - a.count || byLast(a, b) || byName(a, b));
}
