export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import {
  classifyGradeAcademicImpact,
  type GradeClassificationKind,
} from "@/lib/grade-classification";
import { previewStudentAcademicUpdate } from "@/lib/academic-recalculate-server";
import { buildStudentAcademicImpactToken } from "@/lib/student-academic-impact-token";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import {
  normalizeGracePeriodStartMode,
  resolveManualGraceStartDate,
} from "@/lib/student-grace";

function normalizeGraceDays(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(30, Math.max(0, Math.trunc(numeric)));
}

function validDate(value: unknown): Date | null {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

function dayKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

const protectedKinds = new Set<GradeClassificationKind>([
  "missing",
  "excused",
  "grace-period",
  "before-registration",
  "unavailable-exam",
  "no-discount-protected",
]);

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({}));
    const studentId = String(body.studentId || body.id || "").trim();
    if (!studentId) return validationError("تعذر تحديد الطالب المطلوب");
    const gracePeriodStartMode = normalizeGracePeriodStartMode(
      body.gracePeriodStartMode,
    );
    if (
      body.gracePeriodStartMode !== undefined &&
      body.gracePeriodStartMode !== null &&
      body.gracePeriodStartMode !== "" &&
      !gracePeriodStartMode
    ) {
      return validationError(
        "مصدر بدء فترة السماح غير واضح. اختر تاريخ التسجيل أو اليوم.",
      );
    }

    // Build the human-readable impact, engine projection, and confirmation
    // token from one SERIALIZABLE snapshot. A preview can therefore never mix
    // grades from one moment with a token from another moment.
    const response = await withSerializableTransaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          name: true,
          createdAt: true,
          accountingGraceDays: true,
          gracePeriodStartDate: true,
        },
      });
      if (!student) {
        throw Object.assign(new Error("student not found"), {
          statusCode: 404,
        });
      }

      const proposedCreatedAt =
        body.createdAt === undefined
          ? student.createdAt
          : validDate(body.createdAt);
      if (!proposedCreatedAt) {
        throw Object.assign(new Error("invalid registration date"), {
          statusCode: 400,
        });
      }
      const proposedGraceDays =
        body.accountingGraceDays === undefined
          ? student.accountingGraceDays
          : normalizeGraceDays(body.accountingGraceDays);

      const dateChanged = dayKey(proposedCreatedAt) !== dayKey(student.createdAt);
      const graceDaysChanged =
        proposedGraceDays !== Number(student.accountingGraceDays || 0);
      const proposedGraceStartDate =
        proposedGraceDays <= 0
          ? null
          : graceDaysChanged || gracePeriodStartMode
            ? resolveManualGraceStartDate({
                mode: gracePeriodStartMode || "now",
                createdAt: proposedCreatedAt,
              })
            : student.gracePeriodStartDate;
      const graceStartChanged =
        dayKey(proposedGraceStartDate) !== dayKey(student.gracePeriodStartDate);
      const graceChanged = graceDaysChanged || graceStartChanged;

      const [grades, leaves, projection, previewToken] = await Promise.all([
        tx.grade.findMany({
          where: { studentId },
          include: { exam: true },
          orderBy: { updatedAt: "desc" },
        }),
        tx.studentLeave.findMany({ where: { studentId } }),
        previewStudentAcademicUpdate(
          studentId,
          {
            createdAt: proposedCreatedAt,
            accountingGraceDays: proposedGraceDays,
            gracePeriodStartDate: proposedGraceStartDate,
          },
          { tx },
        ),
        buildStudentAcademicImpactToken(tx, {
          studentId,
          proposedCreatedAt,
          proposedGraceDays,
          proposedGraceStartDate,
        }),
      ]);

      const currentStudent = {
        createdAt: student.createdAt,
        accountingGraceDays: student.accountingGraceDays,
        gracePeriodStartDate: student.gracePeriodStartDate,
      };
      const projectedStudent = {
        createdAt: proposedCreatedAt,
        accountingGraceDays: proposedGraceDays,
        gracePeriodStartDate: proposedGraceStartDate,
      };

      const changes = grades
        .map((grade) => {
          const before = classifyGradeAcademicImpact(grade, grade.exam, {
            student: currentStudent,
            leaves,
          });
          const after = classifyGradeAcademicImpact(grade, grade.exam, {
            student: projectedStudent,
            leaves,
          });
          return {
            examId: grade.examId,
            examName: grade.exam.name,
            examDate: dayKey(grade.exam.date),
            before,
            after,
            changed: before !== after,
          };
        })
        .filter((item) => item.changed);

      const becameProtected = changes.filter(
        (item) =>
          !protectedKinds.has(item.before) && protectedKinds.has(item.after),
      ).length;
      const becameChargeable = changes.filter(
        (item) =>
          protectedKinds.has(item.before) && !protectedKinds.has(item.after),
      ).length;
      const movedBeforeRegistration = changes.filter(
        (item) =>
          item.after === "before-registration" && item.before !== item.after,
      ).length;
      const returnedAfterRegistration = changes.filter(
        (item) =>
          item.before === "before-registration" && item.after !== item.before,
      ).length;
      const movedIntoGrace = changes.filter(
        (item) => item.after === "grace-period" && item.before !== item.after,
      ).length;
      const leftGrace = changes.filter(
        (item) => item.before === "grace-period" && item.after !== item.before,
      ).length;

      return {
        studentId,
        studentName: student.name,
        requiresConfirmation: dateChanged || graceChanged,
        changes: { dateChanged, graceChanged },
        current: {
          createdAt: dayKey(student.createdAt),
          accountingGraceDays: Number(student.accountingGraceDays || 0),
          gracePeriodStartDate: dayKey(student.gracePeriodStartDate),
        },
        proposed: {
          createdAt: dayKey(proposedCreatedAt),
          accountingGraceDays: proposedGraceDays,
          gracePeriodStartDate: dayKey(proposedGraceStartDate),
        },
        impact: {
          totalGrades: grades.length,
          changedGrades: changes.length,
          becameProtected,
          becameChargeable,
          movedBeforeRegistration,
          returnedAfterRegistration,
          movedIntoGrace,
          leftGrace,
          sample: changes.slice(0, 12),
        },
        projection,
        previewToken,
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json(response);
  } catch (error) {
    const candidate = error as { statusCode?: number; message?: string };
    if (candidate.statusCode === 404) {
      return NextResponse.json({ error: "الطالب غير موجود" }, { status: 404 });
    }
    if (candidate.statusCode === 400) {
      return validationError("تاريخ التسجيل الجديد غير صالح");
    }
    return routeErrorResponse(error, "تعذر معاينة أثر تاريخ التسجيل وفترة السماح.");
  }
}
