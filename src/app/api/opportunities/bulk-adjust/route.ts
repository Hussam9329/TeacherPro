export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withFollowupTables } from "@/lib/followup-schema";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  buildOpportunityFilters,
  composeStudentWhere,
  fullOpportunityLimitForStudent,
  hasActiveChapterWhere,
  normalizeBoolean,
} from "@/lib/opportunity-filters-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";

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

function normalizeText(value: unknown, max = 2000): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function normalizePositiveInt(value: unknown, fallback = 1): number {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.trunc(Math.abs(numeric)));
}

async function handleFilterBasedBulkAdjust(req: NextRequest, body: Record<string, unknown>) {
  const actionType = body.actionType === "deduct" ? "deduct" : "add";
  const amount = normalizePositiveInt(body.amount, 1);
  const signedAmount = actionType === "deduct" ? -amount : amount;
  const action = actionType === "deduct" ? "خصم" : "إضافة";
  const reason = normalizeText(body.reason, 2000);
  if (!reason) return validationError("يرجى إدخال سبب العملية الجماعية");

  const excludeDismissed = normalizeBoolean(body.excludeDismissed, true);
  const excludeFullOpportunities = normalizeBoolean(
    body.excludeFullOpportunities,
    true,
  );
  const reactivateDismissedOnAdd = normalizeBoolean(
    body.reactivateDismissedOnAdd,
    false,
  );

  const filters = buildOpportunityFilters({
    courseId: normalizeText(body.courseId, 120),
    status: normalizeText(body.status, 120),
    opportunityCount: normalizeText(body.opportunityCount, 40),
    q: normalizeText(body.q, 300),
  });

  const result = await withFollowupTables(
    async () =>
      db.$transaction(async (tx) => {
        const totalMatching = await tx.student.count({
          where: composeStudentWhere(filters),
        });

        const candidateRows = await tx.student.findMany({
          where: composeStudentWhere([...filters, hasActiveChapterWhere()]),
          select: {
            id: true,
            status: true,
            opportunities: true,
            baseOpportunities: true,
            courseId: true,
          },
        });

        const targetRows = candidateRows.filter((student) => {
          if (excludeDismissed && student.status === "مفصول") {
            return false;
          }
          if (
            actionType === "add" &&
            student.status === "مفصول" &&
            !reactivateDismissedOnAdd
          ) {
            return false;
          }
          if (actionType === "deduct" && excludeFullOpportunities) {
            return (
              Number(student.opportunities || 0) <
              fullOpportunityLimitForStudent(student)
            );
          }
          return true;
        });

        if (!targetRows.length) {
          return {
            updatedStudents: 0,
            savedOpportunityLogs: 0,
            savedStudentNotes: 0,
            totalMatching,
            eligibleWithActiveChapter: candidateRows.length,
            skipped: Math.max(0, totalMatching),
          };
        }

        const courseIds = Array.from(
          new Set(targetRows.map((student) => student.courseId)),
        );
        const activeLinks = courseIds.length
          ? await tx.courseChapter.findMany({
              where: {
                courseId: { in: courseIds },
                active: true,
                archived: false,
              },
              select: { courseId: true, chapterId: true },
            })
          : [];
        const chapterIds = Array.from(
          new Set(activeLinks.map((link) => link.chapterId)),
        );
        const chapters = chapterIds.length
          ? await tx.chapter.findMany({
              where: { id: { in: chapterIds } },
              select: { id: true, opportunities: true },
            })
          : [];
        const chapterById = new Map(
          chapters.map((chapter) => [chapter.id, chapter]),
        );
        const activeChapterByCourseId = new Map(
          activeLinks.map((link) => [
            link.courseId,
            {
              chapterId: link.chapterId,
              opportunities: Number(
                chapterById.get(link.chapterId)?.opportunities || 0,
              ),
            },
          ]),
        );

        const now = new Date();
        const opportunityLogs: Array<{
          studentId: string;
          action: string;
          amount: number;
          reason: string;
          date: Date;
          chapterId: string | null;
        }> = [];
        const studentNotes: Array<{
          studentId: string;
          kind: string;
          text: string;
          date: Date;
          sourceType?: string;
          sourceId?: string;
          dismissalKey?: string;
          dismissalType?: string;
          dismissalReason?: string;
          dismissalDate?: Date;
        }> = [];

        const appliedStudentIds: string[] = [];
        for (const student of targetRows) {
          const activeChapter = activeChapterByCourseId.get(student.courseId);
          if (!activeChapter) continue;
          appliedStudentIds.push(student.id);
          opportunityLogs.push({
            studentId: student.id,
            action,
            amount,
            reason,
            date: now,
            chapterId: activeChapter.chapterId,
          });
          if (
            signedAmount > 0 &&
            reactivateDismissedOnAdd &&
            student.status === "مفصول"
          ) {
            studentNotes.push({
              studentId: student.id,
              kind: "إجراء",
              text: "إعادة تفعيل بعد إضافة فرصة جماعية موثقة بسجل يدوي",
              date: now,
              sourceType: "bulk-opportunity-adjust",
            });
          }
        }

        for (const group of chunks(opportunityLogs)) {
          await tx.opportunityLog.createMany({ data: group });
        }
        for (const group of chunks(studentNotes)) {
          await tx.studentNote.createMany({ data: group });
        }

        const academicRecalculation = appliedStudentIds.length
          ? await recalculateStudentsAcademicState(appliedStudentIds, { tx })
          : null;
        const updatedStudents = academicRecalculation?.students.length || 0;

        return {
          updatedStudents,
          savedOpportunityLogs: opportunityLogs.length,
          savedStudentNotes: studentNotes.length,
          totalMatching,
          eligibleWithActiveChapter: candidateRows.length,
          skipped: Math.max(0, totalMatching - appliedStudentIds.length),
          academicRecalculation,
        };
      }),
    "BulkOpportunityAdjustByFilter",
  );

  await writeRequestAuditLog(req, "إدارة الفرص", actionType === "deduct" ? "خصم فرص جماعي وإعادة احتساب" : "إضافة فرص جماعية وإعادة احتساب", {
    actionType,
    amount,
    reason,
    totalMatching: result.totalMatching,
    eligibleWithActiveChapter: result.eligibleWithActiveChapter,
    updatedStudents: result.updatedStudents,
    savedOpportunityLogs: result.savedOpportunityLogs,
    skipped: result.skipped,
    excludeDismissed,
    excludeFullOpportunities,
    reactivateDismissedOnAdd,
  });

  return NextResponse.json({ ...result, source: "database" });
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.manage");
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(
    req,
    API_RATE_LIMITS.bulkOpportunities,
  );
  if (rateLimitError) return rateLimitError;

  try {
    const body = await req.json();
    if (
      body &&
      typeof body === "object" &&
      (body as Record<string, unknown>).mode === "filter"
    ) {
      return handleFilterBasedBulkAdjust(req, body as Record<string, unknown>);
    }

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
                select: { id: true, status: true },
              })
            : [];
          const existingStudentIds = new Set(
            existingStudents.map((student) => student.id),
          );
          const modifiableStudentIds = new Set(
            existingStudents
              .filter((student) => student.status !== "مؤرشف")
              .map((student) => student.id),
          );
          let updatedStudents = 0;

          const activeChapterByCourseId = new Map<
            string,
            { chapterId: string; opportunities: number }
          >();
          const allModifiableStudentIds = Array.from(modifiableStudentIds);
          if (allModifiableStudentIds.length) {
            const studentRowsForChapterCheck = await tx.student.findMany({
              where: { id: { in: allModifiableStudentIds } },
              select: { id: true, courseId: true },
            });
            const courseIdsForChapter = Array.from(
              new Set(studentRowsForChapterCheck.map((s) => s.courseId)),
            );
            if (courseIdsForChapter.length) {
              const activeLinks = await tx.courseChapter.findMany({
                where: {
                  courseId: { in: courseIdsForChapter },
                  active: true,
                  archived: false,
                },
                select: { courseId: true, chapterId: true },
              });
              const chapterIdsForActive = Array.from(
                new Set(activeLinks.map((l) => l.chapterId)),
              );
              const chaptersForActive = chapterIdsForActive.length
                ? await tx.chapter.findMany({
                    where: { id: { in: chapterIdsForActive } },
                    select: { id: true, opportunities: true },
                  })
                : [];
              const chapterOppById = new Map(
                chaptersForActive.map((c) => [
                  c.id,
                  Number(c.opportunities || 0),
                ]),
              );
              for (const link of activeLinks) {
                const opp = chapterOppById.get(link.chapterId) ?? 0;
                activeChapterByCourseId.set(link.courseId, {
                  chapterId: link.chapterId,
                  opportunities: opp,
                });
              }
            }
          }

          // Build a map of studentId -> courseId using the rows we already fetched
          const courseIdByStudentId = new Map<string, string>();
          // We re-fetch students that are in the update payload to get their courseId.
          // (We already have existingStudents but it only had id selected.)
          const studentIdList = students
            .map((s) => s.id)
            .filter((id) => modifiableStudentIds.has(id));
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
            modifiableStudentIds.has(item.id),
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
              finalOpportunities = Math.min(
                finalOpportunities,
                activeChapter.opportunities,
              );
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
            modifiableStudentIds.has(log.studentId),
          );
          for (const group of chunks(safeOpportunityLogs)) {
            await tx.opportunityLog.createMany({
              data: group,
              skipDuplicates: true,
            });
          }

          const safeStudentNotes = studentNotes.filter((note) =>
            modifiableStudentIds.has(note.studentId),
          );
          for (const group of chunks(safeStudentNotes)) {
            await tx.studentNote.createMany({
              data: group,
              skipDuplicates: true,
            });
          }

          const recalculationIds = Array.from(
            new Set(
              [
                ...students.map((student) => student.id),
                ...safeOpportunityLogs.map((log) => log.studentId),
                ...safeStudentNotes.map((note) => note.studentId),
              ].filter((id) => modifiableStudentIds.has(id)),
            ),
          );
          const academicRecalculation = recalculationIds.length
            ? await recalculateStudentsAcademicState(recalculationIds, { tx })
            : null;

          return {
            updatedStudents,
            savedOpportunityLogs: safeOpportunityLogs.length,
            savedStudentNotes: safeStudentNotes.length,
            skippedMissingStudents:
              allStudentIds.length - existingStudentIds.size,
            skippedArchivedStudents:
              existingStudentIds.size - modifiableStudentIds.size,
            academicRecalculation,
          };
        }),
      "BulkOpportunityAdjust",
    );

    await writeRequestAuditLog(req, "إدارة الفرص", "حفظ تحديث فرص جماعي وإعادة احتساب", {
      updatedStudents: result.updatedStudents,
      savedOpportunityLogs: result.savedOpportunityLogs,
      savedStudentNotes: result.savedStudentNotes,
      skippedMissingStudents: result.skippedMissingStudents,
      skippedArchivedStudents: result.skippedArchivedStudents,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ تحديث الفرص الجماعي حالياً.");
  }
}
