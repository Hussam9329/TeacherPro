export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { normalizeBoolean } from "@/lib/opportunity-filters-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { isValidStudentStatus } from "@/lib/student-status-enums";
import {
  globalImpactConfirmationResponse,
  isConfirmedImpact,
  riskyBulkOpportunityTargetCount,
} from "@/lib/global-side-effects-safety";
import { attachStudentOpportunitySnapshotsWithClient } from "@/lib/student-opportunity-snapshot-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { buildBulkOpportunityPreview } from "@/lib/bulk-opportunity-preview-server";
import { ZERO_BALANCE_VIOLATION_MARKER } from "@/lib/opportunity-balance";

type StudentUpdatePayload = {
  id?: unknown;
  opportunities?: unknown;
  status?: unknown;
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
  chapterNameSnapshot?: unknown;
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
    .map((item) => {
      // Validate status against the single authoritative student-status enum.
      const rawStatus = item.status !== undefined ? String(item.status ?? "") : undefined;
      if (rawStatus !== undefined && !isValidStudentStatus(rawStatus)) {
        throw new Error(
          `قيمة الحالة "${rawStatus}" غير صالحة. القيم المسموح بها: نشط، مفصول، مؤرشف.`,
        );
      }
      return {
        id: String(item.id ?? "").trim(),
        opportunities: normalizeNonNegativeInt(item.opportunities),
        status: rawStatus,
      };
    })
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
      chapterNameSnapshot: item.chapterNameSnapshot
        ? String(item.chapterNameSnapshot)
        : null,
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

async function handleFilterBasedBulkAdjust(
  req: NextRequest,
  body: Record<string, unknown>,
) {
  const actionType = body.actionType === "deduct" ? "deduct" : "add";
  const amount = normalizePositiveInt(body.amount, 1);
  const action = actionType === "deduct" ? "خصم" : "إضافة";
  const reason = normalizeText(body.reason, 2000);
  if (!reason) return validationError("يرجى إدخال سبب العملية الجماعية");

  const excludeDismissed = normalizeBoolean(body.excludeDismissed, true);
  const excludeFullOpportunities = normalizeBoolean(
    body.excludeFullOpportunities,
    true,
  );
  const previewInput = {
    courseId: normalizeText(body.courseId, 120),
    status: normalizeText(body.status, 120),
    opportunityCount: normalizeText(body.opportunityCount, 40),
    q: normalizeText(body.q, 300),
    actionType,
    excludeDismissed,
    excludeFullOpportunities,
  } as const;
  const submittedPreviewToken = normalizeText(body.previewToken, 200);

  const result = await withDatabaseSchema(
    async () =>
      withSerializableTransaction(async (tx) => {
        const preview = await buildBulkOpportunityPreview(tx, previewInput);
        const {
          targetRows,
          totalMatching,
          eligibleWithActiveChapter,
          noActiveChapter,
          activeChapterConflicts,
          zeroOpportunityLimit,
          invalidOpportunitySource,
          targetCount,
          previewToken,
        } = preview;

        if (!targetRows.length) {
          return {
            updatedStudents: 0,
            savedOpportunityLogs: 0,
            savedStudentNotes: 0,
            totalMatching,
            eligibleWithActiveChapter,
            noActiveChapter,
            activeChapterConflicts,
            zeroOpportunityLimit,
            invalidOpportunitySource,
            skipped: Math.max(0, totalMatching),
            targetCount: 0,
            requiresConfirmation: false,
          };
        }

        if (!submittedPreviewToken || submittedPreviewToken !== previewToken) {
          return {
            previewConflict: true,
            totalMatching,
            eligibleWithActiveChapter,
            noActiveChapter,
            activeChapterConflicts,
            zeroOpportunityLimit,
            invalidOpportunitySource,
            targetCount,
            skipped: preview.skipped,
            previewToken,
          };
        }

        const confirmed = isConfirmedImpact(body.confirmImpact);
        if (riskyBulkOpportunityTargetCount(targetCount) && !confirmed) {
          return {
            confirmationRequired: true,
            totalMatching,
            eligibleWithActiveChapter,
            noActiveChapter,
            activeChapterConflicts,
            zeroOpportunityLimit,
            invalidOpportunitySource,
            targetCount,
            skipped: preview.skipped,
            previewToken,
          };
        }

        const now = new Date();
        const opportunityLogs: Array<{
          studentId: string;
          action: string;
          amount: number;
          reason: string;
          date: Date;
          chapterId: string | null;
          chapterNameSnapshot?: string | null;
        }> = [];
        const appliedStudentIds: string[] = [];
        for (const student of targetRows) {
          const activeChapter = student.activeChapter;
          if (!activeChapter) continue;
          appliedStudentIds.push(student.id);
          opportunityLogs.push({
            studentId: student.id,
            action,
            amount,
            reason:
              actionType === "deduct" && student.opportunities === 0
                ? `${reason} ${ZERO_BALANCE_VIOLATION_MARKER}`
                : reason,
            date: now,
            chapterId: activeChapter.id,
            chapterNameSnapshot: activeChapter.name || null,
          });
        }

        for (const group of chunks(opportunityLogs)) {
          await tx.opportunityLog.createMany({ data: group });
        }
        const academicRecalculation = appliedStudentIds.length
          ? await recalculateStudentsAcademicState(appliedStudentIds, { tx })
          : null;
        const updatedStudents = academicRecalculation?.students.length || 0;

        return {
          updatedStudents,
          savedOpportunityLogs: opportunityLogs.length,
          savedStudentNotes: 0,
          reactivatedStudents: 0,
          migratedPendingGrades: 0,
          pendingGradeConflicts: 0,
          totalMatching,
          eligibleWithActiveChapter,
          noActiveChapter,
          activeChapterConflicts,
          zeroOpportunityLimit,
          invalidOpportunitySource,
          skipped: Math.max(0, totalMatching - appliedStudentIds.length),
          targetCount,
          previewToken,
          requiresConfirmation: riskyBulkOpportunityTargetCount(targetCount),
          academicRecalculation,
        };
      }),
    "BulkOpportunityAdjustByFilter",
  );

  if ("previewConflict" in result && result.previewConflict) {
    return NextResponse.json(
      {
        error:
          "تغيّر نطاق الطلاب أو أرصدتهم بعد المعاينة. تم إيقاف العملية قبل أي تعديل؛ راجع العدد ثم أكد من جديد.",
        requiresFreshPreview: true,
        details: {
          totalMatching: result.totalMatching,
          targetCount: result.targetCount,
          skipped: result.skipped,
        },
      },
      { status: 409 },
    );
  }

  if ("confirmationRequired" in result && result.confirmationRequired) {
    return globalImpactConfirmationResponse(
      `عملية الفرص الجماعية ستؤثر على ${result.targetCount} طالب. راجع المعاينة ثم أكد العملية من الواجهة.`,
      {
        actionType,
        amount,
        reason,
        totalMatching: result.totalMatching,
        eligibleWithActiveChapter: result.eligibleWithActiveChapter,
        noActiveChapter: result.noActiveChapter,
        activeChapterConflicts: result.activeChapterConflicts,
        zeroOpportunityLimit: result.zeroOpportunityLimit,
        invalidOpportunitySource: result.invalidOpportunitySource,
        targetCount: result.targetCount,
        skipped: result.skipped,
      },
    );
  }

  await writeRequestAuditLog(
    req,
    "إدارة الفرص",
    actionType === "deduct"
      ? "خصم فرص جماعي وإعادة احتساب"
      : "إضافة فرص جماعية وإعادة احتساب",
    {
      actionType,
      amount,
      reason,
      totalMatching: result.totalMatching,
      eligibleWithActiveChapter: result.eligibleWithActiveChapter,
      noActiveChapter: result.noActiveChapter,
      activeChapterConflicts: result.activeChapterConflicts,
      zeroOpportunityLimit: result.zeroOpportunityLimit,
      invalidOpportunitySource: result.invalidOpportunitySource,
      targetCount: result.targetCount,
      updatedStudents: result.updatedStudents,
      savedOpportunityLogs: result.savedOpportunityLogs,
      skipped: result.skipped,
      excludeDismissed,
      excludeFullOpportunities,
      confirmedImpact: isConfirmedImpact(body.confirmImpact),
    },
  );

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

    const result = await withDatabaseSchema(
      async () =>
        withSerializableTransaction(async (tx) => {
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
                select: {
                  id: true,
                  status: true,
                  courseId: true,
                  opportunities: true,
                  baseOpportunities: true,
                },
              })
            : [];
          const existingStudentIds = new Set(
            existingStudents.map((student) => student.id),
          );
          const existingStudentById = new Map(
            existingStudents.map((student) => [student.id, student]),
          );
          const requestedStatusTransition = students.find((student) => {
            if (student.status === undefined) return false;
            const existing = existingStudentById.get(student.id);
            return Boolean(existing && existing.status !== student.status);
          });
          if (requestedStatusTransition) {
            throw Object.assign(
              new Error(
                "تغيير حالة الطالب من حمولة الفرص الجماعية القديمة موقوف. حدّث الصفحة؛ استرجاع المفصول يتم حصراً من إدارة المفصولين.",
              ),
              { code: "RETIRED_BULK_STATUS_TRANSITION" },
            );
          }
          const modifiableStudentIds = new Set(
            existingStudents
              .filter((student) => student.status !== "مؤرشف")
              .map((student) => student.id),
          );
          let updatedStudents = 0;
          const modifiableStudents = existingStudents.filter(
            (student) => student.status !== "مؤرشف",
          );
          const opportunitySnapshots =
            await attachStudentOpportunitySnapshotsWithClient<
              (typeof modifiableStudents)[number]
            >(tx, modifiableStudents);
          const opportunitySnapshotByStudentId = new Map(
            opportunitySnapshots.map((student) => [student.id, student]),
          );
          const invalidOpportunityUpdate = students.find((student) => {
            if (!modifiableStudentIds.has(student.id)) return false;
            const snapshot = opportunitySnapshotByStudentId.get(student.id);
            return !snapshot || snapshot.opportunityHealth !== "ready";
          });
          if (invalidOpportunityUpdate) {
            const snapshot = opportunitySnapshotByStudentId.get(
              invalidOpportunityUpdate.id,
            );
            const reason =
              snapshot?.opportunityHealth === "active-chapter-conflict"
                ? "الدورة تحتوي على أكثر من فصل نشط"
                : snapshot?.opportunityHealth === "zero-limit"
                  ? "الفصل النشط سقفه صفر"
                  : "الدورة لا تحتوي على فصل نشط";
            throw new Error(
              `تعذر تحديث الفرص لأن مصدر السقف غير صالح: ${reason}. أصلح الفصل ثم أعد المحاولة.`,
            );
          }

          for (const student of students.filter((item) =>
            modifiableStudentIds.has(item.id),
          )) {
            // The active chapter is the only authoritative cap. The stored
            // baseOpportunities value is audit/backward-compatibility data and
            // must never decide a write when chapter configuration changed.
            const opportunitySnapshot =
              opportunitySnapshotByStudentId.get(student.id);
            const opportunityLimit = opportunitySnapshot?.opportunityLimit;
            if (opportunityLimit === null || opportunityLimit === undefined) {
              throw new Error(
                "تعذر تحديد سقف الفرص من الفصل النشط لهذا الطالب.",
              );
            }
            const finalOpportunities = Math.min(
              Math.max(0, Math.trunc(student.opportunities)),
              opportunityLimit,
            );

            // هذا المسار الجماعي يعدّل الرصيد فقط. تغيير حالة مفصول → نشط
            // محصور في students/status-action من إدارة المفصولين.
            const data = { opportunities: finalOpportunities };

            const update = await tx.student.updateMany({
              where: { id: student.id },
              data,
            });
            updatedStudents += update.count;
          }

          const safeOpportunityLogs = opportunityLogs.filter(
            (log) =>
              modifiableStudentIds.has(log.studentId) &&
              log.action !== "إعادة تفعيل" &&
              log.action !== "رصيد إعادة التفعيل" &&
              log.action !== "رصيد بعد تعهد",
          );
          const safeExamIds = Array.from(
            new Set(
              safeOpportunityLogs
                .map((log) => log.examId)
                .filter(Boolean) as string[],
            ),
          );
          const validExamIds = new Set(
            safeExamIds.length
              ? (
                  await tx.exam.findMany({
                    where: { id: { in: safeExamIds } },
                    select: { id: true },
                  })
                ).map((exam) => exam.id)
              : [],
          );
          const safeChapterIds = Array.from(
            new Set(
              safeOpportunityLogs
                .map((log) => log.chapterId)
                .filter(Boolean) as string[],
            ),
          );
          const chapterNameById = new Map(
            safeChapterIds.length
              ? (
                  await tx.chapter.findMany({
                    where: { id: { in: safeChapterIds } },
                    select: { id: true, name: true },
                  })
                ).map((chapter) => [chapter.id, chapter.name])
              : [],
          );
          const relationalSafeOpportunityLogs = safeOpportunityLogs.map(
            (log) => ({
              ...log,
              reason:
                log.action === "خصم" &&
                existingStudentById.get(log.studentId)?.opportunities === 0
                  ? `${log.reason || ""} ${ZERO_BALANCE_VIOLATION_MARKER}`.trim()
                  : log.reason,
              examId:
                log.examId && validExamIds.has(log.examId) ? log.examId : null,
              chapterId:
                log.chapterId && chapterNameById.has(log.chapterId)
                  ? log.chapterId
                  : null,
              chapterNameSnapshot:
                log.chapterId && chapterNameById.has(log.chapterId)
                  ? chapterNameById.get(log.chapterId) || null
                  : log.chapterNameSnapshot || null,
            }),
          );
          for (const group of chunks(relationalSafeOpportunityLogs)) {
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
                ...relationalSafeOpportunityLogs.map((log) => log.studentId),
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
            reactivatedStudents: 0,
            migratedPendingGrades: 0,
            pendingGradeConflicts: 0,
            academicRecalculation,
          };
        }),
      "BulkOpportunityAdjust",
    );

    await writeRequestAuditLog(
      req,
      "إدارة الفرص",
      "حفظ تحديث فرص جماعي وإعادة احتساب",
      {
        updatedStudents: result.updatedStudents,
        savedOpportunityLogs: result.savedOpportunityLogs,
        savedStudentNotes: result.savedStudentNotes,
        skippedMissingStudents: result.skippedMissingStudents,
        skippedArchivedStudents: result.skippedArchivedStudents,
        reactivatedStudents: result.reactivatedStudents,
        migratedPendingGrades: result.migratedPendingGrades,
        pendingGradeConflicts: result.pendingGradeConflicts,
        recalculatedStudents:
          result.academicRecalculation?.students?.length || 0,
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (
      (error as { code?: string } | null)?.code ===
      "RETIRED_BULK_STATUS_TRANSITION"
    ) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "مسار تغيير الحالة موقوف.",
          requiresRefresh: true,
          retiredReactivationAction: true,
        },
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store",
            "X-TeacherPro-Retryable": "0",
          },
        },
      );
    }
    // Validation errors (invalid status) should
    // return 400, not 500. routeErrorResponse treats unknown errors as 500.
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("قيمة الحالة") ||
      message.includes("غير صالحة")
    ) {
      return validationError(message, 400);
    }
    return routeErrorResponse(error, "تعذر حفظ تحديث الفرص الجماعي حالياً.");
  }
}
