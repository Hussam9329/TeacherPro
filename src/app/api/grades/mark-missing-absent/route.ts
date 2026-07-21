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

const MAX_STUDENTS_PER_REQUEST = 2_000;
const BULK_WRITE_CONCURRENCY = 8;

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
      return validationError("لا يوجد طلاب لتسجيلهم غائبين");
    if (studentIds.length > MAX_STUDENTS_PER_REQUEST)
      return validationError("عدد الطلاب في العملية أكبر من الحد المسموح");

    const examExists = await db.exam.count({ where: { id: examId } });
    if (!examExists) return validationError("الامتحان غير موجود", 404);

    const grades: Grade[] = [];
    const recalculatedStudents = new Map<string, AcademicStudent>();
    const skippedStudentIds: string[] = [];
    const failures: Array<{ studentId: string; error: string }> = [];

    // Each student is resolved from current database state. Existing grades are
    // deliberately skipped, making the bulk action safe to retry after a lost
    // response and preventing stale entry-sheet rows from producing 409 storms.
    const processStudent = async (studentId: string) => {
      try {
        const result = await withSerializableTransaction(async (tx) => {
          const existingGrade = await tx.grade.findUnique({
            where: { studentId_examId: { studentId, examId } },
          });
          if (existingGrade) return { existingGrade, writeback: null };

          const writeback = await syncAcademicGradeWriteback({
            tx,
            studentId,
            examId,
            status: "غائب",
            score: null,
            notes: "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم",
            sourceLabel: "تسجيل الغياب الجماعي",
            allowBlankGrade: false,
            blockOnLeave: true,
            enforceExamAvailability: true,
          });
          if (!writeback) {
            throw new AcademicGradeWritebackError("تعذر إنشاء سجل الغياب للطالب.");
          }
          return { existingGrade: null, writeback };
        });

        if (result.existingGrade) {
          skippedStudentIds.push(studentId);
          return;
        }
        if (result.writeback) {
          grades.push(result.writeback.grade);
          for (const student of result.writeback.academicRecalculation?.students || []) {
            recalculatedStudents.set(student.id, student);
          }
        }
      } catch (error) {
        if (error instanceof AcademicGradeWritebackError) {
          failures.push({ studentId, error: error.message });
          return;
        }
        throw error;
      }
    };

    // A bounded worker pool keeps the operation fast for large exams without
    // exhausting the Neon connection pool. Every student still has an isolated
    // SERIALIZABLE transaction and an existing grade is never overwritten.
    let nextStudentIndex = 0;
    const worker = async () => {
      while (nextStudentIndex < studentIds.length) {
        const studentId = studentIds[nextStudentIndex];
        nextStudentIndex += 1;
        await processStudent(studentId);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(BULK_WRITE_CONCURRENCY, studentIds.length) },
        () => worker(),
      ),
    );

    await writeRequestAuditLog(
      req,
      "الدرجات",
      "تسجيل الغياب الجماعي لغير المدخلين",
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
    return routeErrorResponse(error, "تعذر تسجيل الغياب الجماعي حالياً.");
  }
}
