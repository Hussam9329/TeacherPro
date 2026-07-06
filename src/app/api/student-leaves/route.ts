export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import {
  requireText,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import {
  ensureFollowupTables,
  withFollowupTables,
} from "@/lib/followup-schema";
import {
  recalculateStudentsAcademicState,
  type AcademicServerRecalculationResult,
} from "@/lib/academic-recalculate-server";

function readListPagination(
  req: NextRequest,
  fallbackPageSize = 100,
  maxPageSize = 500,
) {
  const searchParams = new URL(req.url).searchParams;
  const rawPageSize = searchParams.get("pageSize") ?? searchParams.get("limit");
  const rawPage = searchParams.get("page");
  const pageNumber = Number(rawPage ?? 1);
  const pageSizeNumber = Number(rawPageSize ?? fallbackPageSize);
  const page =
    Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1;
  const pageSize =
    Number.isFinite(pageSizeNumber) && pageSizeNumber > 0
      ? Math.min(Math.floor(pageSizeNumber), maxPageSize)
      : fallbackPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function dateOrNow(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dateOnly(value: unknown): string {
  return dateOrNow(value).toISOString().slice(0, 10);
}

function dayAfter(value: Date): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function normalizeLeavePayload(body: Record<string, unknown>) {
  const leaveType = body.leaveType === "period" ? "period" : "exam";
  const rawFrom = body.dateFrom ?? body.date;
  const rawTo = body.dateTo ?? rawFrom;
  const fromKey = dateOnly(rawFrom);
  const toKey = dateOnly(rawTo);
  const dateFrom = dateOrNow(fromKey <= toKey ? fromKey : toKey);
  const dateTo = dateOrNow(fromKey <= toKey ? toKey : fromKey);
  const date =
    leaveType === "period" ? dateFrom : dateOrNow(body.date ?? dateFrom);

  return {
    studentId: String(body.studentId ?? ""),
    examId: leaveType === "exam" ? String(body.examId ?? "") : null,
    leaveType,
    reason: String(body.reason ?? "").trim(),
    studyType: String(body.studyType ?? ""),
    date,
    dateFrom,
    dateTo,
    notes: String(body.notes ?? ""),
  };
}

type NormalizedLeavePayload = ReturnType<typeof normalizeLeavePayload>;

type StudentLeaveRecord = {
  id: string;
  studentId: string;
  examId: string | null;
  leaveType: string;
  reason: string;
  studyType: string;
  date: Date;
  dateFrom: Date | null;
  dateTo: Date | null;
  notes: string;
};

function normalizeStoredLeave(leave: StudentLeaveRecord): NormalizedLeavePayload {
  return normalizeLeavePayload({
    studentId: leave.studentId,
    examId: leave.examId || "",
    leaveType: leave.leaveType,
    reason: leave.reason,
    studyType: leave.studyType,
    date: leave.date,
    dateFrom: leave.dateFrom || leave.date,
    dateTo: leave.dateTo || leave.dateFrom || leave.date,
    notes: leave.notes,
  });
}

function mergeLeavePayload(
  existing: StudentLeaveRecord,
  body: Record<string, unknown>,
): NormalizedLeavePayload {
  const requestedLeaveType =
    body.leaveType !== undefined ? body.leaveType : existing.leaveType;
  const leaveType = requestedLeaveType === "period" ? "period" : "exam";
  const fallbackDate = existing.date;
  const fallbackDateFrom = existing.dateFrom || existing.date;
  const fallbackDateTo = existing.dateTo || existing.dateFrom || existing.date;

  return normalizeLeavePayload({
    studentId: body.studentId !== undefined ? body.studentId : existing.studentId,
    examId:
      leaveType === "exam"
        ? body.examId !== undefined
          ? body.examId
          : existing.examId || ""
        : null,
    leaveType,
    reason: body.reason !== undefined ? body.reason : existing.reason,
    studyType:
      body.studyType !== undefined ? body.studyType : existing.studyType,
    date: body.date !== undefined ? body.date : fallbackDate,
    dateFrom:
      body.dateFrom !== undefined || body.leaveType !== undefined
        ? body.dateFrom ?? body.date ?? fallbackDateFrom
        : fallbackDateFrom,
    dateTo:
      body.dateTo !== undefined || body.leaveType !== undefined
        ? body.dateTo ?? body.dateFrom ?? body.date ?? fallbackDateTo
        : fallbackDateTo,
    notes: body.notes !== undefined ? body.notes : existing.notes,
  });
}

function validateLeavePayload(data: NormalizedLeavePayload) {
  const studentError = requireText(data.studentId, "الطالب");
  if (studentError) return studentError;
  if (data.leaveType === "exam") {
    const examError = requireText(String(data.examId || ""), "الامتحان");
    if (examError) return examError;
  }
  const reasonError = requireText(data.reason, "سبب الإجازة");
  if (reasonError) return reasonError;
  return null;
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

async function getAffectedExamIds(
  tx: Prisma.TransactionClient,
  data: NormalizedLeavePayload,
): Promise<string[]> {
  if (data.leaveType === "exam") return data.examId ? [data.examId] : [];
  const exams = await tx.exam.findMany({
    where: {
      date: {
        gte: data.dateFrom,
        lt: dayAfter(data.dateTo),
      },
    },
    select: { id: true },
  });
  return exams.map((exam) => exam.id);
}

type LeaveGradeBackupRow = {
  studentId: string;
  examId: string;
  status: string;
  score: number | null;
  notes: string | null;
  academicAccountingChecked: boolean;
  gradeCreatedAt: Date | null;
};

type RestoredGrade = {
  id: string;
  status: string;
  score: number | null;
  notes: string | null;
  academicAccountingChecked: boolean;
  createdAt: Date;
  updatedAt: Date;
  studentId: string;
  examId: string;
};

async function backupGradesForLeave(
  tx: Prisma.TransactionClient,
  leaveId: string,
  studentId: string,
  examIds: string[],
): Promise<number> {
  if (!examIds.length) return 0;
  const grades = await tx.grade.findMany({
    where: { studentId, examId: { in: examIds } },
    select: {
      studentId: true,
      examId: true,
      status: true,
      score: true,
      notes: true,
      academicAccountingChecked: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  for (const grade of grades) {
    await tx.$executeRaw`
      INSERT INTO "StudentLeaveGradeBackup" (
        "id",
        "leaveId",
        "studentId",
        "examId",
        "status",
        "score",
        "notes",
        "academicAccountingChecked",
        "gradeCreatedAt",
        "gradeUpdatedAt"
      )
      VALUES (
        ${`slgb_${randomUUID()}`},
        ${leaveId},
        ${grade.studentId},
        ${grade.examId},
        ${grade.status},
        ${grade.score},
        ${grade.notes},
        ${grade.academicAccountingChecked},
        ${grade.createdAt},
        ${grade.updatedAt}
      )
      ON CONFLICT ("leaveId", "studentId", "examId") DO UPDATE SET
        "status" = EXCLUDED."status",
        "score" = EXCLUDED."score",
        "notes" = EXCLUDED."notes",
        "academicAccountingChecked" = EXCLUDED."academicAccountingChecked",
        "gradeCreatedAt" = EXCLUDED."gradeCreatedAt",
        "gradeUpdatedAt" = EXCLUDED."gradeUpdatedAt"
    `;
  }

  return grades.length;
}

async function restoreGradesForLeave(
  tx: Prisma.TransactionClient,
  leaveId: string,
): Promise<RestoredGrade[]> {
  const backups = await tx.$queryRaw<LeaveGradeBackupRow[]>`
    SELECT
      "studentId",
      "examId",
      "status",
      "score",
      "notes",
      "academicAccountingChecked",
      "gradeCreatedAt"
    FROM "StudentLeaveGradeBackup"
    WHERE "leaveId" = ${leaveId}
    ORDER BY "createdAt" ASC
  `;

  const restoredGrades: RestoredGrade[] = [];

  for (const backup of backups) {
    const restored = await tx.grade.upsert({
      where: {
        studentId_examId: {
          studentId: backup.studentId,
          examId: backup.examId,
        },
      },
      update: {
        status: backup.status,
        score: backup.score,
        notes: backup.notes,
        academicAccountingChecked: backup.academicAccountingChecked,
      },
      create: {
        studentId: backup.studentId,
        examId: backup.examId,
        status: backup.status,
        score: backup.score,
        notes: backup.notes,
        academicAccountingChecked: backup.academicAccountingChecked,
        ...(backup.gradeCreatedAt ? { createdAt: backup.gradeCreatedAt } : {}),
      },
    });
    restoredGrades.push(restored);
  }

  if (backups.length) {
    await tx.$executeRaw`DELETE FROM "StudentLeaveGradeBackup" WHERE "leaveId" = ${leaveId}`;
  }

  return restoredGrades;
}


type LeaveCreateResult = {
  leave: unknown;
  backedUpGrades: number;
  restoredGrades: RestoredGrade[];
  academicRecalculation: AcademicServerRecalculationResult;
};

type LeaveUpdateResult = {
  studentLeave: unknown;
  backedUpGrades: number;
  restoredGrades: RestoredGrade[];
  restoredGradeCount: number;
  affectedBefore: string[];
  affectedAfter: string[];
  academicRecalculation: AcademicServerRecalculationResult;
};

type LeaveDeleteResult = {
  restoredGrades: RestoredGrade[];
  academicRecalculation: AcademicServerRecalculationResult;
};

async function removeDuplicateExamLeavesBeforeSave(
  tx: Prisma.TransactionClient,
  leaveId: string | null,
  data: NormalizedLeavePayload,
): Promise<RestoredGrade[]> {
  if (data.leaveType !== "exam" || !data.examId) return [];
  const duplicates = await tx.studentLeave.findMany({
    where: {
      studentId: data.studentId,
      examId: data.examId,
      ...(leaveId ? { id: { not: leaveId } } : {}),
    },
    select: { id: true },
  });
  const restoredGrades: RestoredGrade[] = [];
  for (const duplicate of duplicates) {
    restoredGrades.push(...(await restoreGradesForLeave(tx, duplicate.id)));
  }
  if (duplicates.length) {
    await tx.studentLeave.deleteMany({
      where: { id: { in: duplicates.map((duplicate) => duplicate.id) } },
    });
  }
  return restoredGrades;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const { page, pageSize, skip } = readListPagination(req);
    const [totalCount, studentLeaves] = await withFollowupTables(
      () =>
        Promise.all([
          db.studentLeave.count(),
          db.studentLeave.findMany({
            orderBy: [{ dateFrom: "desc" }, { date: "desc" }],
            skip,
            take: pageSize,
            include: {
              student: true,
              exam: true,
            },
          }),
        ]),
      "StudentLeave",
    );
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return NextResponse.json({
      studentLeaves,
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل الإجازات حالياً.");
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.manage");
  if (authError) return authError;

  try {
    await ensureFollowupTables();
    const body = await req.json();
    const data = normalizeLeavePayload(body);
    const payloadError = validateLeavePayload(data);
    if (payloadError) return validationError(payloadError);

    const result = await withFollowupTables<LeaveCreateResult>(
      () =>
        db.$transaction(async (tx) => {
          const affectedExamIds = await getAffectedExamIds(tx, data);
          const restoredGrades = await removeDuplicateExamLeavesBeforeSave(
            tx,
            null,
            data,
          );
          const savedLeave = await tx.studentLeave.create({
            data,
            include: {
              student: true,
              exam: true,
            },
          });

          const backedUpGrades = await backupGradesForLeave(
            tx,
            savedLeave.id,
            data.studentId,
            affectedExamIds,
          );
          if (affectedExamIds.length) {
            await tx.grade.deleteMany({
              where: {
                studentId: data.studentId,
                examId: { in: affectedExamIds },
              },
            });
          }
          const academicRecalculation = await recalculateStudentsAcademicState(
            [data.studentId, ...restoredGrades.map((grade) => grade.studentId)],
            { tx },
          );
          return {
            leave: savedLeave,
            backedUpGrades,
            restoredGrades,
            academicRecalculation,
          };
        }),
      "StudentLeave",
    );

    return NextResponse.json(
      {
        studentLeave: result.leave,
        backedUpGrades: result.backedUpGrades,
        restoredGrades: result.restoredGrades,
        restoredGradeCount: result.restoredGrades.length,
        academicRecalculation: result.academicRecalculation,
      },
      { status: 201 },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ الإجازة حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.manage");
  if (authError) return authError;

  try {
    await ensureFollowupTables();
    const body = await req.json();
    const id = String(body.id || "").trim();
    if (!id) return validationError("تعذر تحديد الإجازة المطلوبة");

    const result = await withFollowupTables<LeaveUpdateResult>(
      () =>
        db.$transaction(async (tx) => {
          const existingLeave = await tx.studentLeave.findUnique({
            where: { id },
            include: {
              student: true,
              exam: true,
            },
          });
          if (!existingLeave) throw new Error("الإجازة المطلوبة غير موجودة");

          const previousData = normalizeStoredLeave(existingLeave);
          const nextData = mergeLeavePayload(existingLeave, body);
          const payloadError = validateLeavePayload(nextData);
          if (payloadError) throw new Error(payloadError);

          const restoredGrades = await restoreGradesForLeave(tx, id);
          const duplicateRestoredGrades = await removeDuplicateExamLeavesBeforeSave(
            tx,
            id,
            nextData,
          );
          const affectedBefore = await getAffectedExamIds(tx, previousData);
          const affectedAfter = await getAffectedExamIds(tx, nextData);

          const studentLeave = await tx.studentLeave.update({
            where: { id },
            data: {
              studentId: nextData.studentId,
              examId: nextData.examId,
              leaveType: nextData.leaveType,
              reason: nextData.reason,
              studyType: nextData.studyType,
              date: nextData.date,
              dateFrom: nextData.dateFrom,
              dateTo: nextData.dateTo,
              notes: nextData.notes,
            },
            include: {
              student: true,
              exam: true,
            },
          });

          const backedUpGrades = await backupGradesForLeave(
            tx,
            id,
            nextData.studentId,
            affectedAfter,
          );
          if (affectedAfter.length) {
            await tx.grade.deleteMany({
              where: {
                studentId: nextData.studentId,
                examId: { in: affectedAfter },
              },
            });
          }

          const academicRecalculation = await recalculateStudentsAcademicState(
            uniqueIds([
              previousData.studentId,
              nextData.studentId,
              ...restoredGrades.map((grade) => grade.studentId),
              ...duplicateRestoredGrades.map((grade) => grade.studentId),
            ]),
            { tx },
          );

          return {
            studentLeave,
            backedUpGrades,
            restoredGrades: [...restoredGrades, ...duplicateRestoredGrades],
            restoredGradeCount: restoredGrades.length + duplicateRestoredGrades.length,
            affectedBefore,
            affectedAfter,
            academicRecalculation,
          };
        }),
      "StudentLeave",
    );
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحديث الإجازة حالياً.");
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.manage");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return validationError("تعذر تحديد الإجازة المطلوبة");
    const result = await withFollowupTables<LeaveDeleteResult>(
      () =>
        db.$transaction(async (tx) => {
          const existingLeave = await tx.studentLeave.findUnique({
            where: { id },
            select: { studentId: true },
          });
          if (!existingLeave) throw new Error("الإجازة المطلوبة غير موجودة");
          const restoredGrades = await restoreGradesForLeave(tx, id);
          await tx.studentLeave.delete({ where: { id } });
          const academicRecalculation = await recalculateStudentsAcademicState(
            uniqueIds([
              existingLeave.studentId,
              ...restoredGrades.map((grade) => grade.studentId),
            ]),
            { tx },
          );
          return { restoredGrades, academicRecalculation };
        }),
      "StudentLeave",
    );
    return NextResponse.json({
      ok: true,
      restoredGrades: result.restoredGrades,
      restoredGradeCount: result.restoredGrades.length,
      academicRecalculation: result.academicRecalculation,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف الإجازة حالياً.");
  }
}
