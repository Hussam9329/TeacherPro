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
import { baghdadDateKey } from "@/lib/baghdad-time";
import { loadActiveGracePeriodsByStudent } from "@/lib/grace-periods-server";

function validDate(value: unknown): Date | null {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

function dayKey(value: Date | string | null | undefined): string {
  return baghdadDateKey(value);
}

const protectedKinds = new Set<GradeClassificationKind>([
  "missing",
  "excused",
  "grace-period",
  "before-registration",
  "unavailable-exam",
  "no-discount-protected",
]);

/**
 * Preview of a registration-date change. Grace periods are not part of the
 * student edit anymore; they are read (unchanged) so the projection matches
 * what the save will compute.
 */
export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({}));
    const studentId = String(body.studentId || body.id || "").trim();
    if (!studentId) return validationError("تعذر تحديد الطالب المطلوب");

    // Build the human-readable impact, engine projection, and confirmation
    // token from one SERIALIZABLE snapshot. A preview can therefore never mix
    // grades from one moment with a token from another moment.
    const response = await withSerializableTransaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: { id: true, name: true, courseId: true, createdAt: true },
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
      const dateChanged = dayKey(proposedCreatedAt) !== dayKey(student.createdAt);

      const [grades, leaves, gracePeriodsByStudent, projection, previewToken] = await Promise.all([
        tx.grade.findMany({
          where: { studentId },
          include: { exam: true },
          orderBy: { updatedAt: "desc" },
        }),
        tx.studentLeave.findMany({ where: { studentId } }),
        loadActiveGracePeriodsByStudent(tx, [studentId]),
        previewStudentAcademicUpdate(
          studentId,
          { createdAt: proposedCreatedAt },
          { tx },
        ),
        buildStudentAcademicImpactToken(tx, {
          studentId,
          proposedCreatedAt,
        }),
      ]);
      const gracePeriods = gracePeriodsByStudent.get(studentId) || [];

      const currentStudent = { courseId: student.courseId, createdAt: student.createdAt, gracePeriods };
      const projectedStudent = { courseId: student.courseId, createdAt: proposedCreatedAt, gracePeriods };

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

      return {
        studentId,
        studentName: student.name,
        requiresConfirmation: dateChanged,
        changes: { dateChanged },
        current: { createdAt: dayKey(student.createdAt) },
        proposed: { createdAt: dayKey(proposedCreatedAt) },
        impact: {
          totalGrades: grades.length,
          changedGrades: changes.length,
          becameProtected,
          becameChargeable,
          movedBeforeRegistration,
          returnedAfterRegistration,
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
    return routeErrorResponse(error, "تعذر معاينة أثر تاريخ التسجيل.");
  }
}
