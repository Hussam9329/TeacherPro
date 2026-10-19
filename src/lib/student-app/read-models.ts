/**
 * Read models for the student mobile app. Everything here is SELECT-only and
 * mirrors the Telegram bot's rules for which exams and grades a student sees.
 */
import type { Prisma } from "@prisma/client";
import { gradeBeforeCutoff, loadDismissalCutoff, type DismissalCutoffClient } from "./dismissal-cutoff.ts";

export const CONTACT_LINKS = {
  chancesUrl: "https://t.me/hf_chances",
  objectionsUrl: "https://t.me/hf_obj",
  botStartUrl: "https://t.me/hfexam_bot",
} as const;

export const PENDING_GRADE_TEXT = "بانتظار التصحيح";

export function isDismissedStatus(status: string | null | undefined): boolean {
  return String(status ?? "").trim() === "مفصول";
}

/** TeleBot `exam_matches_course`: null matches every course; bad JSON matches none. */
export function examMatchesCourse(exam: { courseIds: string | null }, courseId: string): boolean {
  if (!courseId) return false;
  if (exam.courseIds == null) return true;
  try {
    const ids = JSON.parse(exam.courseIds) as unknown;
    return Array.isArray(ids) && ids.includes(courseId);
  } catch {
    return false;
  }
}

type UpcomingExamRow = {
  id: string;
  name: string;
  date: Date | null;
  courseIds: string | null;
  telegramOpenAt: Date | null;
  telegramCloseAt: Date | null;
};

export type UpcomingExam = {
  id: string;
  name: string;
  date: Date | null;
  openAt: Date;
  closeAt: Date;
  isOpen: boolean;
};

export type UpcomingExamsClient = {
  exam: {
    findMany(args: {
      where: { active: boolean; telegramOpenAt: { not: null }; telegramCloseAt: { gt: Date } };
      select: Record<keyof UpcomingExamRow, true>;
    }): Promise<UpcomingExamRow[]>;
  };
};

export async function listUpcomingExams(
  client: UpcomingExamsClient,
  student: { courseId: string },
  now: Date,
): Promise<UpcomingExam[]> {
  const rows = await client.exam.findMany({
    where: { active: true, telegramOpenAt: { not: null }, telegramCloseAt: { gt: now } },
    select: { id: true, name: true, date: true, courseIds: true, telegramOpenAt: true, telegramCloseAt: true },
  });
  return rows
    .filter((exam) => exam.telegramOpenAt && exam.telegramCloseAt && examMatchesCourse(exam, student.courseId))
    .map((exam) => {
      const openAt = exam.telegramOpenAt as Date;
      const closeAt = exam.telegramCloseAt as Date;
      return { id: exam.id, name: exam.name, date: exam.date, openAt, closeAt, isOpen: openAt <= now && now < closeAt };
    })
    .sort((a, b) => a.openAt.getTime() - b.openAt.getTime() || a.id.localeCompare(b.id));
}

export function displayGrade(grade: { score: number | null; status: string | null }, fullMark: number | null): string {
  if (grade.score != null) return `${grade.score} / ${fullMark ?? "—"}`;
  const status = String(grade.status ?? "").trim();
  if (status && status !== "درجة") return status;
  return PENDING_GRADE_TEXT;
}

export type GradeRow = {
  examId: string;
  examName: string;
  examDate: Date | null;
  score: number | null;
  fullMark: number | null;
  status: string;
  display: string;
};

type GradeWithExam = {
  examId: string;
  score: number | null;
  status: string;
  exam: { name: string; date: Date | null; fullMark: number | null };
};

export type RecentGradesClient = DismissalCutoffClient & {
  grade: {
    findMany(args: {
      where: Prisma.GradeWhereInput;
      select: { examId: true; score: true; status: true; exam: { select: { name: true; date: true; fullMark: true } } };
      orderBy: Array<Record<string, unknown>>;
      take: number;
    }): Promise<GradeWithExam[]>;
  };
};

export async function listRecentGrades(
  client: RecentGradesClient,
  student: { id: string; status: string; dismissalReason: string | null },
): Promise<{ grades: GradeRow[] | null; unavailable: boolean }> {
  let where: Prisma.GradeWhereInput = { studentId: student.id };
  if (isDismissedStatus(student.status)) {
    const cutoff = await loadDismissalCutoff(client, student);
    if (!cutoff) return { grades: null, unavailable: true };
    where = { ...where, ...gradeBeforeCutoff(cutoff) };
  }
  const rows = await client.grade.findMany({
    where,
    select: { examId: true, score: true, status: true, exam: { select: { name: true, date: true, fullMark: true } } },
    orderBy: [{ exam: { date: "desc" } }, { createdAt: "desc" }, { updatedAt: "desc" }],
    take: 10,
  });
  return {
    unavailable: false,
    grades: rows.map((g) => ({
      examId: g.examId,
      examName: g.exam.name,
      examDate: g.exam.date,
      score: g.score,
      fullMark: g.exam.fullMark,
      status: g.status,
      display: displayGrade(g, g.exam.fullMark),
    })),
  };
}
