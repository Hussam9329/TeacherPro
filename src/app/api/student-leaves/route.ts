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
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { parseCourseIds } from "@/lib/exam-course-links";
import {
  isExamOnOrAfterStudentRegistration,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

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

// Q64 FIX: Previously dateOrNow silently replaced invalid dates with
// today's date. Now we throw so the caller can return a 400 error.
function parseDateStrict(value: unknown): Date {
  if (!value || value === null) throw new Error("التاريخ مطلوب.");
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`تاريخ غير صالح: "${String(value)}". أرسل تاريخاً صالحاً بصيغة ISO 8601 (YYYY-MM-DD).`);
  }
  return date;
}

// dateOrNow is kept for backward compat with existing code that legitimately
// falls back to today (e.g. internal default). For user-supplied dates, use
// parseDateStrict.
function dateOrNow(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dateOnly(value: unknown): string {
  return baghdadDateKey(dateOrNow(value)) || baghdadTodayKey();
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
  // Q64 FIX: Validate user-supplied dates strictly. Previously dateOnly()
  // used dateOrNow() which silently replaced invalid dates with today.
  // Now we parse strictly and let invalid dates throw.
  const fromDate = parseDateStrict(rawFrom);
  const toDate = parseDateStrict(rawTo);
  // Ensure dateFrom <= dateTo (swap if needed)
  const dateFrom = fromDate <= toDate ? fromDate : toDate;
  const dateTo = fromDate <= toDate ? toDate : fromDate;
  const date =
    leaveType === "period" ? dateFrom : parseDateStrict(body.date ?? dateFrom);

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

function leaveAcademicScopeKey(data: NormalizedLeavePayload): string {
  return JSON.stringify({
    studentId: data.studentId,
    examId: data.examId || "",
    leaveType: data.leaveType,
    date: baghdadDateKey(data.date),
    dateFrom: baghdadDateKey(data.dateFrom),
    dateTo: baghdadDateKey(data.dateTo),
  });
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
  const [student, exams] = await Promise.all([
    tx.student.findUnique({
      where: { id: data.studentId },
      select: {
        courseId: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
      },
    }),
    tx.exam.findMany({
      where: {
        date: {
          gte: data.dateFrom,
          lt: dayAfter(data.dateTo),
        },
      },
      select: { id: true, courseIds: true, mainSite: true },
    }),
  ]);
  if (!student) return [];
  return exams
    .filter(
      (exam) =>
        parseCourseIds(exam.courseIds).includes(student.courseId) &&
        studentMatchesExamMainSites(
          student,
          splitSelection(String(exam.mainSite || "")),
        ),
    )
    .map((exam) => exam.id);
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
    where: { studentId, examId: { in: examIds }, status: { not: "مجاز" } },
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

async function writeExcusedGradeMarkers(
  tx: Prisma.TransactionClient,
  studentId: string,
  examIds: string[],
): Promise<number> {
  if (!examIds.length) return 0;
  for (const examId of examIds) {
    await tx.grade.upsert({
      where: { studentId_examId: { studentId, examId } },
      update: {
        status: "مجاز",
        score: null,
        notes: "تسجيل تلقائي: الطالب مجاز من هذا الامتحان",
        academicAccountingChecked: false,
      },
      create: {
        studentId,
        examId,
        status: "مجاز",
        score: null,
        notes: "تسجيل تلقائي: الطالب مجاز من هذا الامتحان",
        academicAccountingChecked: false,
      },
    });
  }
  return examIds.length;
}

async function clearExcusedGradeMarkersForLeave(
  tx: Prisma.TransactionClient,
  leaveId: string,
): Promise<void> {
  const leave = await tx.studentLeave.findUnique({ where: { id: leaveId } });
  if (!leave) return;
  const data = normalizeStoredLeave(leave);
  const examIds = await getAffectedExamIds(tx, data);
  if (!examIds.length) return;
  await tx.grade.deleteMany({
    where: {
      studentId: data.studentId,
      examId: { in: examIds },
      status: "مجاز",
    },
  });
}

async function restoreGradesForLeave(
  tx: Prisma.TransactionClient,
  leaveId: string,
): Promise<RestoredGrade[]> {
  await clearExcusedGradeMarkersForLeave(tx, leaveId);
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
  const studentIds = uniqueIds(backups.map((backup) => backup.studentId));
  const examIds = uniqueIds(backups.map((backup) => backup.examId));
  const [students, exams] = await Promise.all([
    studentIds.length
      ? tx.student.findMany({
          where: { id: { in: studentIds } },
          select: {
            id: true,
            createdAt: true,
            accountingGraceDays: true,
            gracePeriodStartDate: true,
          },
        })
      : [],
    examIds.length
      ? tx.exam.findMany({
          where: { id: { in: examIds } },
          select: { id: true, date: true },
        })
      : [],
  ]);
  const studentById = new Map(students.map((student) => [student.id, student] as const));
  const examById = new Map(exams.map((exam) => [exam.id, exam] as const));

  for (const backup of backups) {
    const student = studentById.get(backup.studentId);
    const exam = examById.get(backup.examId);
    // حذف الإجازة لا يجوز أن يعيد غياباً كان غير صالح أصلاً: قبل تسجيل
    // الطالب أو ضمن السماح التلقائي/اليدوي. بقية الحالات (درجة/غش) تبقى
    // قابلة للاستعادة لأن السماح يمنع العقوبة لا إدخال النتيجة.
    if (
      backup.status === "غائب" &&
      student &&
      exam &&
      (!isExamOnOrAfterStudentRegistration(student, exam) ||
        isExamWithinStudentGraceWindow(student, exam))
    ) {
      continue;
    }
    const restored = await tx.grade.upsert({
      where: {
        studentId_examId: {
          studentId: backup.studentId,
          examId: backup.examId,
        },
      },
      update: {
        status: backup.status,
        score: backup.status === "درجة" ? backup.score : null,
        notes: backup.notes,
        academicAccountingChecked: backup.academicAccountingChecked,
      },
      create: {
        studentId: backup.studentId,
        examId: backup.examId,
        status: backup.status,
        score: backup.status === "درجة" ? backup.score : null,
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


type StudentLeaveWithRelations = StudentLeaveRecord & { student?: unknown; exam?: unknown };

type LeaveCreateResult = {
  leave: StudentLeaveWithRelations;
  backedUpGrades: number;
  restoredGrades: RestoredGrade[];
  academicRecalculation: AcademicServerRecalculationResult;
};

type LeaveUpdateResult = {
  studentLeave: StudentLeaveWithRelations;
  backedUpGrades: number;
  restoredGrades: RestoredGrade[];
  restoredGradeCount: number;
  affectedBefore: string[];
  affectedAfter: string[];
  academicRecalculation: AcademicServerRecalculationResult | null;
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
        withSerializableTransaction(async (tx) => {
          // Q68 FIX: Verify the exam belongs to the student's course.
          // Previously, an admin could create a leave for a student in
          // course A on an exam that belongs to course B. The leave was
          // saved, hid a non-existent grade, and caused confusing behavior
          // on restore. Now we reject this upfront.
          if (data.leaveType === "exam" && data.examId) {
            const student = await tx.student.findUnique({
              where: { id: data.studentId },
              select: { id: true, courseId: true, status: true },
            });
            if (!student) {
              throw new Error("الطالب غير موجود أو تم حذفه.");
            }
            if (student.status === "مؤرشف") {
              throw new Error("لا يمكن إضافة إجازة لطالب مؤرشف.");
            }
            // Q69 FIX: Also reject dismissed students. A dismissed student
            // should not receive leaves — they're not actively participating.
            // Reactivate them first if needed.
            if (student.status === "مفصول") {
              throw new Error("لا يمكن إضافة إجازة لطالب مفصول. أعد تفعيله أولاً ثم أنشئ الإجازة.");
            }
            // Check the exam belongs to the student's course via ExamCourse
            const link = await tx.examCourse.findFirst({
              where: { examId: data.examId, courseId: student.courseId },
              select: { id: true },
            });
            if (!link) {
              // Fallback: check legacy courseIds JSON field on Exam
              const exam = await tx.exam.findUnique({
                where: { id: data.examId },
                select: { courseIds: true },
              });
              const courseIds = parseCourseIds(exam?.courseIds);
              if (!courseIds.includes(student.courseId)) {
                throw new Error(
                  "الامتحان غير تابع لدورة الطالب الحالية. لا يمكن إنشاء إجازة لامتحان من دورة أخرى.",
                );
              }
            }
          } else {
            // For period leaves: still verify the student exists and is not archived
            const student = await tx.student.findUnique({
              where: { id: data.studentId },
              select: { id: true, status: true },
            });
            if (!student) {
              throw new Error("الطالب غير موجود أو تم حذفه.");
            }
            if (student.status === "مؤرشف") {
              throw new Error("لا يمكن إضافة إجازة لطالب مؤرشف.");
            }
            // Q69 FIX: Also reject dismissed students for period leaves.
            if (student.status === "مفصول") {
              throw new Error("لا يمكن إضافة إجازة لطالب مفصول. أعد تفعيله أولاً ثم أنشئ الإجازة.");
            }
          }

          // Q65 FIX: Prevent overlapping period leaves for the same student.
          // Previously, the system allowed creating (1-10) and (5-15) for
          // the same student. Both hid grades for the overlapping exams,
          // and deleting one caused restore issues (the backup of the
          // second was empty because the grade was already deleted).
          // Now we reject if any existing period leave for this student
          // overlaps with the new period [dateFrom, dateTo].
          if (data.leaveType === "period") {
            const overlapping = await tx.studentLeave.findFirst({
              where: {
                studentId: data.studentId,
                leaveType: "period",
                // Overlap: existing.dateFrom <= new.dateTo AND existing.dateTo >= new.dateFrom
                AND: [
                  { dateFrom: { lte: data.dateTo } },
                  { dateTo: { gte: data.dateFrom } },
                ],
              },
              select: { id: true, dateFrom: true, dateTo: true, reason: true },
            });
            if (overlapping) {
              const fmt = (d: Date | null) => d ? baghdadDateKey(d) : '?';
              throw new Error(
                `يوجد إجازة فترة سابقة لهذا الطالب تتداخل مع التاريخ المحدد ` +
                `(${fmt(overlapping.dateFrom)} إلى ${fmt(overlapping.dateTo)}). ` +
                `لا يمكن إنشاء إجازتي فترة متداخلتين للطالب نفسه.`,
              );
            }
          }

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
          await writeExcusedGradeMarkers(tx, data.studentId, affectedExamIds);
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

    await writeRequestAuditLog(req, "المتابعة", "تسجيل إجازة وإعادة احتساب الطالب", {
      leaveId: result.leave.id,
      studentId: result.leave.studentId,
      examId: result.leave.examId,
      leaveType: result.leave.leaveType,
      backedUpGrades: result.backedUpGrades,
      restoredGradeCount: result.restoredGrades.length,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });
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
    // Q65/Q68 FIX: Errors thrown inside the transaction (validation errors
    // with Arabic messages) should return 400, not 500. routeErrorResponse
    // treats any non-Prisma error as 500, so we intercept validation
    // messages here.
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("غير تابع لدورة الطالب") ||
      message.includes("تتداخل") ||
      message.includes("لا يمكن إضافة إجازة لطالب مؤرشف") ||
      message.includes("لا يمكن إضافة إجازة لطالب مفصول") ||
      message.includes("الطالب غير موجود") ||
      message.includes("لا يمكن تعديل إجازة لطالب مؤرشف") ||
      message.includes("لا يمكن تعديل إجازة لطالب مفصول") ||
      message.includes("تاريخ غير صالح")
    ) {
      return validationError(message, 400);
    }
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
        withSerializableTransaction(async (tx) => {
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

          // Q68 FIX (PUT): Verify the exam belongs to the student's course.
          if (nextData.leaveType === "exam" && nextData.examId) {
            const student = await tx.student.findUnique({
              where: { id: nextData.studentId },
              select: { id: true, courseId: true, status: true },
            });
            if (!student) {
              throw new Error("الطالب غير موجود أو تم حذفه.");
            }
            if (student.status === "مؤرشف") {
              throw new Error("لا يمكن تعديل إجازة لطالب مؤرشف.");
            }
            // Q69 FIX: Also reject dismissed students on PUT.
            if (student.status === "مفصول") {
              throw new Error("لا يمكن تعديل إجازة لطالب مفصول. أعد تفعيله أولاً.");
            }
            const link = await tx.examCourse.findFirst({
              where: { examId: nextData.examId, courseId: student.courseId },
              select: { id: true },
            });
            if (!link) {
              const exam = await tx.exam.findUnique({
                where: { id: nextData.examId },
                select: { courseIds: true },
              });
              const courseIds = parseCourseIds(exam?.courseIds);
              if (!courseIds.includes(student.courseId)) {
                throw new Error(
                  "الامتحان غير تابع لدورة الطالب الحالية. لا يمكن إنشاء إجازة لامتحان من دورة أخرى.",
                );
              }
            }
          } else {
            const student = await tx.student.findUnique({
              where: { id: nextData.studentId },
              select: { id: true, status: true },
            });
            if (!student) {
              throw new Error("الطالب غير موجود أو تم حذفه.");
            }
            if (student.status === "مؤرشف") {
              throw new Error("لا يمكن تعديل إجازة لطالب مؤرشف.");
            }
            // Q69 FIX: Also reject dismissed students on PUT (period leaves).
            if (student.status === "مفصول") {
              throw new Error("لا يمكن تعديل إجازة لطالب مفصول. أعد تفعيله أولاً.");
            }
          }

          // Q65 FIX (PUT): Prevent overlapping period leaves for the same student.
          // Exclude the current leave being edited from the overlap check.
          if (nextData.leaveType === "period") {
            const overlapping = await tx.studentLeave.findFirst({
              where: {
                studentId: nextData.studentId,
                leaveType: "period",
                id: { not: id },
                AND: [
                  { dateFrom: { lte: nextData.dateTo } },
                  { dateTo: { gte: nextData.dateFrom } },
                ],
              },
              select: { id: true, dateFrom: true, dateTo: true, reason: true },
            });
            if (overlapping) {
              const fmt = (d: Date | null) => d ? baghdadDateKey(d) : '?';
              throw new Error(
                `يوجد إجازة فترة سابقة لهذا الطالب تتداخل مع التاريخ المحدد ` +
                `(${fmt(overlapping.dateFrom)} إلى ${fmt(overlapping.dateTo)}). ` +
                `لا يمكن إنشاء إجازتي فترة متداخلتين للطالب نفسه.`,
              );
            }
          }

          const academicScopeChanged =
            leaveAcademicScopeKey(previousData) !==
            leaveAcademicScopeKey(nextData);
          if (!academicScopeChanged) {
            const studentLeave = await tx.studentLeave.update({
              where: { id },
              data: {
                reason: nextData.reason,
                studyType: nextData.studyType,
                notes: nextData.notes,
              },
              include: { student: true, exam: true },
            });
            return {
              studentLeave,
              backedUpGrades: 0,
              restoredGrades: [],
              restoredGradeCount: 0,
              affectedBefore: [],
              affectedAfter: [],
              academicRecalculation: null,
            };
          }

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
          await writeExcusedGradeMarkers(tx, nextData.studentId, affectedAfter);

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
    await writeRequestAuditLog(req, "المتابعة", "تعديل إجازة وإعادة احتساب الطالب", {
      leaveId: result.studentLeave.id,
      studentId: result.studentLeave.studentId,
      examId: result.studentLeave.examId,
      leaveType: result.studentLeave.leaveType,
      backedUpGrades: result.backedUpGrades,
      restoredGradeCount: result.restoredGradeCount,
      affectedBefore: result.affectedBefore,
      affectedAfter: result.affectedAfter,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    // Q65/Q68/Q69 FIX: validation errors should return 400, not 500.
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("غير تابع لدورة الطالب") ||
      message.includes("تتداخل") ||
      message.includes("لا يمكن إضافة إجازة لطالب مؤرشف") ||
      message.includes("لا يمكن إضافة إجازة لطالب مفصول") ||
      message.includes("الطالب غير موجود") ||
      message.includes("لا يمكن تعديل إجازة لطالب مؤرشف") ||
      message.includes("لا يمكن تعديل إجازة لطالب مفصول") ||
      message.includes("تاريخ غير صالح")
    ) {
      return validationError(message, 400);
    }
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
        withSerializableTransaction(async (tx) => {
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
    await writeRequestAuditLog(req, "المتابعة", "حذف إجازة واسترجاع الدرجات وإعادة الاحتساب", {
      leaveId: id,
      restoredGradeCount: result.restoredGrades.length,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
      studentIds: result.academicRecalculation?.studentIds || [],
    });
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
