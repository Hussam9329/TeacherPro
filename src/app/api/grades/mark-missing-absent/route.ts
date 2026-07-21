export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import type { Grade } from "@prisma/client";
import type { AcademicStudent } from "@/lib/academic-types";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { ensureExamSchema } from "@/lib/exam-schema";
import { ensureFollowupTables } from "@/lib/followup-schema";
import {
  AcademicGradeWritebackError,
  syncAcademicGradeWriteback,
} from "@/lib/academic-grade-writeback-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";

const MAX_STUDENTS_PER_REQUEST = 2_000;

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "grades.add");
  if (authError) return authError;

  try {
    await ensureExamSchema();
    await ensureFollowupTables();

    const body = (await req.json()) as Record<string, unknown>;
    const examId = String(body.examId || "").trim();
    const rawStudentIds = Array.isArray(body.studentIds) ? body.studentIds : [];
    const studentIds = Array.from(
      new Set(rawStudentIds.map((value) => String(value || "").trim()).filter(Boolean)),
    );

    if (!examId) return validationError("يجب اختيار الامتحان أولاً");
    if (studentIds.length === 0)
      return validationError("لا يوجد طلاب لتسجيل حالاتهم");
    if (studentIds.length > MAX_STUDENTS_PER_REQUEST)
      return validationError("عدد الطلاب في العملية أكبر من الحد المسموح");

    const examExists = await db.exam.count({ where: { id: examId } });
    if (!examExists) return validationError("الامتحان غير موجود", 404);

    // One SERIALIZABLE transaction owns the entire batch. Grade writes are
    // validated one by one, then all affected students are recalculated once.
    // This avoids self-deadlocks caused by parallel transactions repeatedly
    // reading and updating the same academic tables.
    const result = await withSerializableTransaction(async (tx) => {
      const grades: Grade[] = [];
      const skippedStudentIds: string[] = [];
      const failures: Array<{ studentId: string; error: string }> = [];
      const createdStudentIds: string[] = [];

      for (const studentId of studentIds) {
        try {
          const existingGrade = await tx.grade.findUnique({
            where: { studentId_examId: { studentId, examId } },
          });
          if (existingGrade) {
            skippedStudentIds.push(studentId);
            continue;
          }

          const [student, exam] = await Promise.all([
            tx.student.findUnique({
              where: { id: studentId },
              select: {
                createdAt: true,
                accountingGraceDays: true,
                gracePeriodStartDate: true,
              },
            }),
            tx.exam.findUnique({
              where: { id: examId },
              select: { date: true },
            }),
          ]);
          if (!student) throw new AcademicGradeWritebackError("الطالب غير موجود.", 404);
          if (!exam) throw new AcademicGradeWritebackError("الامتحان غير موجود.", 404);

          const registeredForExam = isExamOnOrAfterStudentRegistration(student, exam);
          const withinGrace =
            registeredForExam && isExamWithinStudentGraceWindow(student, exam);
          const automaticStatus = !registeredForExam
            ? "قبل تسجيل الطالب"
            : withinGrace
              ? "ضمن فترة السماح"
              : "غائب";

          const writeback = await syncAcademicGradeWriteback({
            tx,
            studentId,
            examId,
            status: automaticStatus,
            score: null,
            notes: !registeredForExam
              ? "تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب"
              : withinGrace
                ? "تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان"
                : "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم",
            sourceLabel: "تسجيل الحالات الجماعي",
            allowBlankGrade: false,
            blockOnLeave: true,
            enforceExamAvailability: true,
            deferAcademicRecalculation: true,
          });
          if (!writeback) {
            throw new AcademicGradeWritebackError("تعذر إنشاء سجل حالة الطالب.");
          }
          grades.push(writeback.grade);
          createdStudentIds.push(studentId);
        } catch (error) {
          if (error instanceof AcademicGradeWritebackError) {
            failures.push({ studentId, error: error.message });
            continue;
          }
          throw error;
        }
      }

      const academicRecalculation = createdStudentIds.length
        ? await recalculateStudentsAcademicState(createdStudentIds, { tx })
        : null;

      return {
        grades,
        skippedStudentIds,
        failures,
        academicRecalculation,
      };
    });

    const grades = result.grades;
    const skippedStudentIds = result.skippedStudentIds;
    const failures = result.failures;
    const recalculatedStudents = new Map<string, AcademicStudent>();
    for (const student of result.academicRecalculation?.students || []) {
      recalculatedStudents.set(student.id, student);
    }

    await writeRequestAuditLog(
      req,
      "الدرجات",
      "تسجيل الحالات الجماعي لغير المدخلين",
      {
        examId,
        requested: studentIds.length,
        created: grades.length,
        skippedExisting: skippedStudentIds.length,
        failed: failures.length,
      },
    );

    return NextResponse.json({
      created: grades.length,
      createdAbsent: grades.filter((grade) => grade.status === "غائب").length,
      createdGrace: grades.filter((grade) => grade.status === "ضمن فترة السماح").length,
      createdBeforeRegistration: grades.filter(
        (grade) => grade.status === "قبل تسجيل الطالب",
      ).length,
      skippedExisting: skippedStudentIds.length,
      skippedStudentIds,
      failed: failures.length,
      failures,
      grades,
      academicRecalculation: {
        students: Array.from(recalculatedStudents.values()),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تسجيل حالات الطلاب جماعياً حالياً.");
  }
}
