export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import type { Grade } from "@prisma/client";
import type { AcademicStudent } from "@/lib/academic-types";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { assertDatabaseSchemaReady } from "@/lib/schema-readiness";
import {
  AcademicGradeWritebackError,
  syncAcademicGradeWriteback,
} from "@/lib/academic-grade-writeback-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { isStudentInGracePeriod } from "@/lib/grace-periods";
import { loadActiveGracePeriodsByStudent } from "@/lib/grace-periods-server";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";
import { assertGradeStatusScoreConsistency } from "@/lib/grade-status-score-validation";

const MAX_STUDENTS_PER_REQUEST = 2_000;

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "grades.add");
  if (authError) return authError;

  try {
    await assertDatabaseSchemaReady();

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

    // ROOT-CAUSE FIX: This batch endpoint always sends status != "درجة"
    // (it only ever writes "غائب" or "قبل تسجيل الطالب")
    // and always sends score = null. We assert this invariant here so that
    // any future refactor that accidentally passes a score will fail loudly
    // with a clear Arabic message instead of silently persisting a
    // contradictory row.
    try {
      assertGradeStatusScoreConsistency("غائب", null);
    } catch (error) {
      if (error instanceof AcademicGradeWritebackError) {
        return validationError(error.message, error.status);
      }
      throw error;
    }

    // One SERIALIZABLE transaction owns the entire batch. Grade writes are
    // validated one by one, then all affected students are recalculated once.
    // This avoids self-deadlocks caused by parallel transactions repeatedly
    // reading and updating the same academic tables.
    const result = await withSerializableTransaction(async (tx) => {
      const grades: Grade[] = [];
      const skippedStudentIds: string[] = [];
      const failures: Array<{ studentId: string; error: string }> = [];
      const createdStudentIds: string[] = [];

      // Everything the loop needs is read once for the whole batch: the exam,
      // the students, their existing grades and leaves. Reading them per
      // student made a 2,000-student batch thousands of sequential queries.
      const exam = await tx.exam.findUnique({
        where: { id: examId },
        select: { id: true, date: true },
      });
      const [existingGradeRows, studentRows, leaveRows] = await Promise.all([
        tx.grade.findMany({
          where: { examId, studentId: { in: studentIds } },
          select: { studentId: true },
        }),
        tx.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, createdAt: true },
        }),
        tx.studentLeave.findMany({
          where: {
            studentId: { in: studentIds },
            OR: [{ examId }, { leaveType: "period" }],
          },
          select: { studentId: true, leaveType: true, dateFrom: true, dateTo: true, examId: true },
        }),
      ]);
      const studentsWithGrade = new Set(existingGradeRows.map((row) => row.studentId));
      const studentsById = new Map(studentRows.map((row) => [row.id, row]));
      const leavesByStudent = new Map<string, typeof leaveRows>();
      for (const leave of leaveRows) {
        const list = leavesByStudent.get(leave.studentId) || [];
        list.push(leave);
        leavesByStudent.set(leave.studentId, list);
      }

      for (const studentId of studentIds) {
        try {
          if (studentsWithGrade.has(studentId)) {
            skippedStudentIds.push(studentId);
            continue;
          }

          const student = studentsById.get(studentId);
          if (!student) throw new AcademicGradeWritebackError("الطالب غير موجود.", 404);
          if (!exam) throw new AcademicGradeWritebackError("الامتحان غير موجود.", 404);

          // ROOT-CAUSE FIX: Skip students who have an active leave for this
          // exam (or for the exam's date range). Previously, the batch
          // endpoint would set status="غائب" with notes="تسجيل جماعي كغائب"
          // BEFORE syncAcademicGradeWriteback's blockOnLeave check fired,
          // leaving a contradictory row on the student's record: status
          // eventually converted to "مجاز" (or stayed "غائب") but the
          // stale "تسجيل جماعي كغائب" note remained. Worse, when the leave
          // was added AFTER the batch absence, the grade stayed "غائب" and
          // the recalc treated it as a real absence → false dismissal.
          //
          // Now: we look up any active StudentLeave BEFORE writing any
          // grade, and skip the student entirely. The student's leave is
          // authoritative — they should not be marked absent.
          const examDate = exam.date instanceof Date ? exam.date : new Date(String(exam.date));
          const leaveCoversExam = (leavesByStudent.get(studentId) || []).some((leave) =>
            leave.leaveType === "exam"
              ? leave.examId === examId
              : leave.leaveType === "period" && leave.dateFrom && leave.dateTo
                ? examDate >= leave.dateFrom && examDate <= leave.dateTo
                : false,
          );
          if (leaveCoversExam) {
            skippedStudentIds.push(studentId);
            continue;
          }

          // A missing student inside a grace period is still recorded as the
          // fact "غائب"; the accounting engine excuses it by the exam date.
          const registeredForExam = isExamOnOrAfterStudentRegistration(student, exam);
          const automaticStatus = registeredForExam ? "غائب" : "قبل تسجيل الطالب";

          const writeback = await syncAcademicGradeWriteback({
            tx,
            studentId,
            examId,
            status: automaticStatus,
            score: null,
            notes: !registeredForExam
              ? "قبل تسجيل الطالب"
              : "",
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
      const examDate = grades.length
        ? (await tx.exam.findUnique({ where: { id: examId }, select: { date: true } }))?.date
        : null;
      const gracePeriods = await loadActiveGracePeriodsByStudent(
        tx,
        grades.filter((grade) => grade.status === "غائب").map((grade) => grade.studentId),
      );
      const absentInGrace = examDate
        ? grades.filter((grade) =>
            grade.status === "غائب" &&
            isStudentInGracePeriod(gracePeriods.get(grade.studentId), examDate)).length
        : 0;

      return {
        grades,
        absentInGrace,
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
      createdAbsentInGrace: result.absentInGrace,
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
