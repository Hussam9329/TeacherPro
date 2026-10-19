/**
 * The exam-window push: when `Exam.telegramOpenAt` arrives, every active
 * student of the exam's courses gets one notification. The one-minute cron
 * calls this; the log row's unique `examId` makes a second run (or two
 * overlapping runs) a no-op, and a short look-back covers a late cron tick.
 */
import { buildExamWindowMessage } from "./push-text.ts";
import { isUniqueViolation, resolveAudience, sendAndLog } from "./push-server.ts";
import type { PushSenders } from "./push-send.ts";

export const EXAM_WINDOW_LOOKBACK_MS = 15 * 60 * 1000;

type ExamRow = {
  id: string;
  name: string;
  courseIds: string | null;
  telegramOpenAt: Date | null;
  telegramCloseAt: Date | null;
  examCourses: Array<{ courseId: string; course: { name: string } }>;
};

type ExamClient = {
  exam: {
    findMany(args: {
      where: { active: true; telegramOpenAt: { lte: Date; gte: Date }; telegramCloseAt: { gt: Date } };
      select: { id: true; name: true; courseIds: true; telegramOpenAt: true; telegramCloseAt: true; examCourses: { select: { courseId: true; course: { select: { name: true } } } } };
      orderBy: { telegramOpenAt: "asc" };
    }): Promise<ExamRow[]>;
  };
  course: { findMany(args: { where: { id: { in: string[] } }; select: { id: true; name: true } }): Promise<Array<{ id: string; name: string }>> };
} & Parameters<typeof resolveAudience>[0] & Parameters<typeof sendAndLog>[0];

export type ExamWindowPushResult = {
  scanned: number;
  notified: Array<{ examId: string; name: string; students: number; devices: number; sent: number; failed: number }>;
  /** Exams another run had already claimed. */
  skipped: string[];
};

/** Course ids of an exam: the ExamCourse rows, else the legacy JSON column. */
export function examCourseIds(exam: Pick<ExamRow, "courseIds" | "examCourses">): string[] {
  const fromRows = exam.examCourses.map((row) => row.courseId);
  if (fromRows.length) return Array.from(new Set(fromRows));
  try {
    const parsed = JSON.parse(exam.courseIds ?? "[]") as unknown;
    return Array.isArray(parsed) ? Array.from(new Set(parsed.filter((id): id is string => typeof id === "string" && id.trim() !== ""))) : [];
  } catch {
    return [];
  }
}

export async function pushDueExamWindows(input: {
  client: ExamClient;
  senders: PushSenders;
  now?: Date;
  lookbackMs?: number;
}): Promise<ExamWindowPushResult> {
  const now = input.now ?? new Date();
  const lookback = input.lookbackMs ?? EXAM_WINDOW_LOOKBACK_MS;
  const exams = await input.client.exam.findMany({
    where: { active: true, telegramOpenAt: { lte: now, gte: new Date(now.getTime() - lookback) }, telegramCloseAt: { gt: now } },
    select: { id: true, name: true, courseIds: true, telegramOpenAt: true, telegramCloseAt: true, examCourses: { select: { courseId: true, course: { select: { name: true } } } } },
    orderBy: { telegramOpenAt: "asc" },
  });
  const result: ExamWindowPushResult = { scanned: exams.length, notified: [], skipped: [] };
  for (const exam of exams) {
    if (!exam.telegramOpenAt || !exam.telegramCloseAt) continue;
    const courseIds = examCourseIds(exam);
    let courseNames = exam.examCourses.map((row) => row.course.name);
    if (!courseNames.length && courseIds.length) {
      courseNames = (await input.client.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } })).map((c) => c.name);
    }
    const audience = courseIds.length
      ? await resolveAudience(input.client, courseIds)
      : { students: 0, reachable: 0, devices: [] };
    const message = buildExamWindowMessage({ id: exam.id, name: exam.name, telegramOpenAt: exam.telegramOpenAt, telegramCloseAt: exam.telegramCloseAt });
    try {
      const outcome = await sendAndLog(
        input.client,
        {
          kind: "exam-window",
          target: "exam",
          examId: exam.id,
          courseId: courseIds.length === 1 ? courseIds[0] : null,
          courseName: courseNames.join("، "),
          title: message.title,
          body: message.body,
          userName: "TeacherPro Server",
        },
        audience,
        input.senders,
      );
      result.notified.push({ examId: exam.id, name: exam.name, students: audience.reachable, devices: audience.devices.length, sent: outcome.sent, failed: outcome.failed });
    } catch (error) {
      if (isUniqueViolation(error)) { result.skipped.push(exam.id); continue; }
      throw error;
    }
  }
  return result;
}
