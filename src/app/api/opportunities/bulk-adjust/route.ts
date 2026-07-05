export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withFollowupTables } from "@/lib/followup-schema";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";

type StudentUpdatePayload = {
  id?: unknown;
  opportunities?: unknown;
  status?: unknown;
  dismissalType?: unknown;
  dismissalReason?: unknown;
  dismissalNotes?: unknown;
};

type OpportunityLogPayload = {
  id?: unknown;
  studentId?: unknown;
  examId?: unknown;
  action?: unknown;
  amount?: unknown;
  reason?: unknown;
  date?: unknown;
  chapterId?: unknown;
};

type StudentNotePayload = {
  id?: unknown;
  studentId?: unknown;
  kind?: unknown;
  text?: unknown;
  date?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  dismissalKey?: unknown;
  dismissalType?: unknown;
  dismissalReason?: unknown;
  dismissalDate?: unknown;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeNonNegativeInt(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function normalizeDate(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeOptionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function chunks<T>(items: T[], size = 250): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function normalizeStudentUpdates(value: unknown) {
  return asArray<StudentUpdatePayload>(value)
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      opportunities: normalizeNonNegativeInt(item.opportunities),
      status: item.status !== undefined ? String(item.status ?? "") : undefined,
      dismissalType:
        item.dismissalType !== undefined
          ? String(item.dismissalType ?? "")
          : undefined,
      dismissalReason:
        item.dismissalReason !== undefined
          ? String(item.dismissalReason ?? "")
          : undefined,
      dismissalNotes:
        item.dismissalNotes !== undefined
          ? String(item.dismissalNotes ?? "")
          : undefined,
    }))
    .filter((item) => item.id);
}

function normalizeOpportunityLogs(value: unknown) {
  return asArray<OpportunityLogPayload>(value)
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      studentId: String(item.studentId ?? "").trim(),
      examId: item.examId ? String(item.examId) : null,
      action: String(item.action ?? "").trim(),
      amount: normalizeNonNegativeInt(item.amount),
      reason: item.reason ? String(item.reason) : null,
      date: normalizeDate(item.date),
      chapterId: item.chapterId ? String(item.chapterId) : null,
    }))
    .filter((item) => item.id && item.studentId && item.action);
}

function normalizeStudentNotes(value: unknown) {
  return asArray<StudentNotePayload>(value)
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      studentId: String(item.studentId ?? "").trim(),
      kind: String(item.kind ?? "").trim(),
      text: String(item.text ?? "").trim(),
      date: normalizeDate(item.date),
      sourceType: String(item.sourceType ?? ""),
      sourceId: String(item.sourceId ?? ""),
      dismissalKey: String(item.dismissalKey ?? ""),
      dismissalType: String(item.dismissalType ?? ""),
      dismissalReason: String(item.dismissalReason ?? ""),
      dismissalDate: normalizeOptionalDate(item.dismissalDate),
    }))
    .filter((item) => item.id && item.studentId && item.text);
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.manage");
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.bulkOpportunities);
  if (rateLimitError) return rateLimitError;

  try {
    const body = await req.json();
    const students = normalizeStudentUpdates(body.students);
    const opportunityLogs = normalizeOpportunityLogs(body.opportunityLogs);
    const studentNotes = normalizeStudentNotes(body.studentNotes);

    if (!students.length && !opportunityLogs.length && !studentNotes.length) {
      return validationError("لا توجد تغييرات جماعية لحفظها");
    }

    const result = await withFollowupTables(
      async () =>
        db.$transaction(async (tx) => {
          const allStudentIds = Array.from(
            new Set(
              [
                ...students.map((student) => student.id),
                ...opportunityLogs.map((log) => log.studentId),
                ...studentNotes.map((note) => note.studentId),
              ].filter(Boolean),
            ),
          );
          const existingStudents = allStudentIds.length
            ? await tx.student.findMany({
                where: { id: { in: allStudentIds } },
                select: { id: true },
              })
            : [];
          const existingStudentIds = new Set(
            existingStudents.map((student) => student.id),
          );
          let updatedStudents = 0;

          const activeChapterByCourseId = new Map<string, { chapterId: string; opportunities: number }>();
          if (allStudentIds.length) {
            const studentRowsForChapterCheck = await tx.student.findMany({
              where: { id: { in: allStudentIds } },
              select: { id: true, courseId: true },
            });
            const courseIdsForChapter = Array.from(new Set(studentRowsForChapterCheck.map((s) => s.courseId)));
            if (courseIdsForChapter.length) {
              const activeLinks = await tx.courseChapter.findMany({
                where: { courseId: { in: courseIdsForChapter }, active: true, archived: false },
                select: { courseId: true, chapterId: true },
              });
              const chapterIdsForActive = Array.from(new Set(activeLinks.map((l) => l.chapterId)));
              const chaptersForActive = chapterIdsForActive.length
                ? await tx.chapter.findMany({ where: { id: { in: chapterIdsForActive } }, select: { id: true, opportunities: true } })
                : [];
              const chapterOppById = new Map(chaptersForActive.map((c) => [c.id, Number(c.opportunities || 0)]));
              for (const link of activeLinks) {
                const opp = chapterOppById.get(link.chapterId) ?? 0;
                activeChapterByCourseId.set(link.courseId, { chapterId: link.chapterId, opportunities: opp });
              }
            }
          }

          // Build a map of studentId -> courseId using the rows we already fetched
          const courseIdByStudentId = new Map<string, string>();
          // We re-fetch students that are in the update payload to get their courseId.
          // (We already have existingStudents but it only had id selected.)
          const studentIdList = students.map((s) => s.id).filter((id) => existingStudentIds.has(id));
          if (studentIdList.length) {
            const studentRowsForCourse = await tx.student.findMany({
              where: { id: { in: studentIdList } },
              select: { id: true, courseId: true },
            });
            for (const row of studentRowsForCourse) {
              courseIdByStudentId.set(row.id, row.courseId);
            }
          }

          for (const student of students.filter((item) =>
            existingStudentIds.has(item.id),
          )) {
            // Clamp opportunities to baseOpportunities of the active chapter
            // for this student's course. This prevents the client from ever
            // writing a value above the cap (e.g. due to a stale local cache
            // or an outdated bulk operation from before a chapter change).
            const studentCourseId = courseIdByStudentId.get(student.id);
            const activeChapter = studentCourseId
              ? activeChapterByCourseId.get(studentCourseId)
              : undefined;
            let finalOpportunities = student.opportunities;
            if (activeChapter && activeChapter.opportunities > 0) {
              finalOpportunities = Math.min(finalOpportunities, activeChapter.opportunities);
            }
            // Non-negative floor.
            finalOpportunities = Math.max(0, Math.trunc(finalOpportunities));

            const data: {
              opportunities: number;
              status?: string;
              dismissalType?: string;
              dismissalReason?: string;
              dismissalNotes?: string;
            } = { opportunities: finalOpportunities };

            if (student.status !== undefined) data.status = student.status;
            if (student.dismissalType !== undefined)
              data.dismissalType = student.dismissalType;
            if (student.dismissalReason !== undefined)
              data.dismissalReason = student.dismissalReason;
            if (student.dismissalNotes !== undefined)
              data.dismissalNotes = student.dismissalNotes;

            const update = await tx.student.updateMany({
              where: { id: student.id },
              data,
            });
            updatedStudents += update.count;
          }

          const safeOpportunityLogs = opportunityLogs.filter((log) =>
            existingStudentIds.has(log.studentId),
          );
          for (const group of chunks(safeOpportunityLogs)) {
            await tx.opportunityLog.createMany({
              data: group,
              skipDuplicates: true,
            });
          }

          const safeStudentNotes = studentNotes.filter((note) =>
            existingStudentIds.has(note.studentId),
          );
          for (const group of chunks(safeStudentNotes)) {
            await tx.studentNote.createMany({
              data: group,
              skipDuplicates: true,
            });
          }

          return {
            updatedStudents,
            savedOpportunityLogs: safeOpportunityLogs.length,
            savedStudentNotes: safeStudentNotes.length,
            skippedMissingStudents:
              allStudentIds.length - existingStudentIds.size,
          };
        }),
      "BulkOpportunityAdjust",
    );

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ تحديث الفرص الجماعي حالياً.");
  }
}
