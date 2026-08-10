import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const GRADE_SMART_NOTE_CATEGORIES = [
  "DISMISSED_PENDING",
  "GRACE_SCORED",
  "BEFORE_REGISTRATION_PENDING",
  "LEAVE_PENDING",
] as const;

export const GRADE_SMART_NOTE_STATUSES = [
  "PENDING",
  "PROCESSED",
  "CONFLICT",
  "REJECTED",
] as const;

export const GRACE_SCORED_GRADE_EXCLUSION_REASON =
  "درجة حقيقية أُدخلت لامتحان داخل فترة سماح الطالب، وهي مستبعدة دائماً من الخصم والفصل والمحاسبة الأكاديمية.";

export function gradeSmartNoteExclusionSource(
  category: GradeSmartNoteCategory,
  noteId: string,
): string {
  return `GradeSmartNote:${category}:${noteId}`;
}

export function isProtectedDismissedPendingGrade(grade: {
  academicEffectExcluded?: boolean | null;
  academicEffectExclusionSource?: string | null;
}): boolean {
  return Boolean(
    grade.academicEffectExcluded &&
      String(grade.academicEffectExclusionSource || "").startsWith(
        "GradeSmartNote:DISMISSED_PENDING:",
      ),
  );
}

export function isProtectedSmartNoteHistoricalGrade(grade: {
  academicEffectExcluded?: boolean | null;
  academicEffectExclusionSource?: string | null;
}): boolean {
  if (!grade.academicEffectExcluded) return false;
  const source = String(grade.academicEffectExclusionSource || "");
  return (
    source.startsWith("GradeSmartNote:DISMISSED_PENDING:") ||
    source.startsWith("GradeSmartNote:GRACE_SCORED:")
  );
}

export type GradeSmartNoteCategory =
  (typeof GRADE_SMART_NOTE_CATEGORIES)[number];
export type GradeSmartNoteStatus =
  (typeof GRADE_SMART_NOTE_STATUSES)[number];

type PrismaClientLike = typeof db | Prisma.TransactionClient;

export interface GradeSmartNoteActor {
  id?: string | null;
  name?: string | null;
}

export interface GradeSmartNoteSnapshot {
  student: { id: string; name: string; code: string };
  exam: { id: string; name: string; date: Date | string | null };
}

export interface UpsertGradeSmartNoteInput extends GradeSmartNoteSnapshot {
  category: GradeSmartNoteCategory;
  status: GradeSmartNoteStatus;
  score?: number | null;
  reason: string;
  actor?: GradeSmartNoteActor | null;
  attemptedAt?: Date;
  resolution?: string | null;
  resolutionActor?: GradeSmartNoteActor | null;
  resolvedAt?: Date | null;
  tx?: Prisma.TransactionClient;
}

export function isGradeSmartNoteCategory(
  value: unknown,
): value is GradeSmartNoteCategory {
  return GRADE_SMART_NOTE_CATEGORIES.includes(
    String(value || "") as GradeSmartNoteCategory,
  );
}

export function isGradeSmartNoteStatus(
  value: unknown,
): value is GradeSmartNoteStatus {
  return GRADE_SMART_NOTE_STATUSES.includes(
    String(value || "") as GradeSmartNoteStatus,
  );
}

function snapshotDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Upsert one current structured entry for a student/exam/category. Repeated
 * clicks update the same note instead of creating duplicate pending work.
 * Callers that also mutate Grade must pass the same transaction.
 */
export async function upsertGradeSmartNote(
  input: UpsertGradeSmartNoteInput,
) {
  const client: PrismaClientLike = input.tx || db;
  const uniqueWhere = {
    examId_studentId_category: {
      examId: input.exam.id,
      studentId: input.student.id,
      category: input.category,
    },
  } as const;

  // Network retries and stale entry sheets must never reopen a note that was
  // already processed, rejected, or marked as a conflict. Explicit reopening
  // remains possible only through the version-checked smart-note API.
  if (input.status === "PENDING") {
    const resolvedExisting = await client.gradeSmartNote.findUnique({
      where: uniqueWhere,
    });
    if (resolvedExisting && resolvedExisting.status !== "PENDING") {
      return resolvedExisting;
    }
  }
  const attemptedAt = input.attemptedAt || new Date();
  const resolvedAt =
    input.status === "PENDING"
      ? null
      : input.resolvedAt || new Date();
  const resolutionActor = input.resolutionActor || input.actor || null;

  return client.gradeSmartNote.upsert({
    where: uniqueWhere,
    create: {
      category: input.category,
      status: input.status,
      examId: input.exam.id,
      studentId: input.student.id,
      examNameSnapshot: input.exam.name,
      examDateSnapshot: snapshotDate(input.exam.date),
      studentNameSnapshot: input.student.name,
      studentCodeSnapshot: input.student.code,
      score: input.score ?? null,
      reason: input.reason,
      attemptedById: input.actor?.id || null,
      attemptedByName: input.actor?.name || null,
      attemptedAt,
      resolution:
        input.status === "PENDING" ? null : input.resolution || null,
      resolutionById:
        input.status === "PENDING" ? null : resolutionActor?.id || null,
      resolutionByName:
        input.status === "PENDING" ? null : resolutionActor?.name || null,
      resolvedAt,
    },
    update: {
      status: input.status,
      examNameSnapshot: input.exam.name,
      examDateSnapshot: snapshotDate(input.exam.date),
      studentNameSnapshot: input.student.name,
      studentCodeSnapshot: input.student.code,
      score: input.score ?? null,
      reason: input.reason,
      attemptedById: input.actor?.id || null,
      attemptedByName: input.actor?.name || null,
      attemptedAt,
      resolution:
        input.status === "PENDING" ? null : input.resolution || null,
      resolutionById:
        input.status === "PENDING" ? null : resolutionActor?.id || null,
      resolutionByName:
        input.status === "PENDING" ? null : resolutionActor?.name || null,
      resolvedAt,
    },
  });
}

export function gradeSmartNoteResolutionGradeId(
  note: { resolutionGrade?: { id: string } | null },
): string | null {
  return note.resolutionGrade?.id || null;
}
