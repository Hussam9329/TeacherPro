export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { parseStudentEnrollmentArchiveSnapshot } from "@/lib/student-enrollment-archive-server";
import { evaluateStudentExamEligibility, isExamAssignedToStudentCourse } from "@/lib/student-exam-eligibility-server";
import { splitSelection, studentMatchesExamMainSites } from "@/lib/exam-utils";

/**
 * ملف الطالب يجب أن يعرض تاريخه الحقيقي من بيانات النظام، وليس من البيانات المؤقتة المحلي.
 * هذا المسار يجلب كل السجلات المرتبطة بطالب واحد حتى لو لم يفتح المستخدم
 * صفحات الدرجات/الفرص/الإجازات قبل فتح ملف الطالب.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const studentId = String(searchParams.get("studentId") || "").trim();
    if (!studentId) return validationError("studentId مطلوب");

    const student = await db.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        code: true,
        phone: true,
        parentPhone: true,
        courseId: true,
        status: true,
        createdAt: true,
        accountingGraceDays: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
      },
    });
    if (!student) return validationError("الطالب غير موجود");

    const enrollmentArchives = await db.studentEnrollmentArchive.findMany({
      where: { studentId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const currentEnrollmentStartedAt = enrollmentArchives[0]?.createdAt || null;

    const [
      grades,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      auditLogs,
    ] = await Promise.all([
      db.grade.findMany({
        where: { studentId },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      }),
      db.opportunityLog.findMany({
        where: { studentId },
        orderBy: [{ date: "desc" }, { id: "desc" }],
      }),
      db.studentLeave.findMany({
        where: { studentId },
        include: { student: true, exam: true },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      }),
      db.studentCall.findMany({
        where: { studentId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      db.studentNote.findMany({
        where: { studentId },
        orderBy: [{ date: "desc" }, { id: "desc" }],
      }),
      db.auditLog.findMany({
        where: {
          ...(currentEnrollmentStartedAt
            ? { time: { gte: currentEnrollmentStartedAt } }
            : {}),
          OR: [
            { details: { contains: student.id, mode: "insensitive" as const } },
            { details: { contains: student.code, mode: "insensitive" as const } },
            { details: { contains: student.name, mode: "insensitive" as const } },
            ...(student.phone
              ? [{ details: { contains: student.phone, mode: "insensitive" as const } }]
              : []),
            ...(student.parentPhone
              ? [
                  {
                    details: {
                      contains: student.parentPhone,
                      mode: "insensitive" as const,
                    },
                  },
                ]
              : []),
          ],
        },
        orderBy: { time: "desc" },
        take: 100,
      }),
    ]);

    // ملف الطالب يعرض كل امتحانات دورته وموقعه، حتى إذا لم توجد درجة بعد.
    const candidateExams = await db.exam.findMany({
      include: { examCourses: { select: { courseId: true } } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
    const exams = candidateExams.filter((exam) =>
      isExamAssignedToStudentCourse(student, exam) &&
      studentMatchesExamMainSites(student, splitSelection(exam.mainSite)),
    );
    const examStates = [] as Array<{
      examId: string;
      code: string;
      label: string;
      reason: string;
      withinGrace: boolean;
      hasLeave: boolean;
      gradeId: string | null;
      gradeStatus: string | null;
      score: number | null;
    }>;
    type GradeRow = {
      id: string;
      examId: string;
      status: string;
      score: number | null;
    };
    const gradeRows = grades as GradeRow[];
    const gradeByExamId = new Map<string, GradeRow>(
      gradeRows.map((grade) => [grade.examId, grade]),
    );
    for (const exam of exams) {
      const eligibility = await evaluateStudentExamEligibility(db, student, exam, {
        requireActiveChapter: false,
        checkAvailability: true,
        checkRegistration: true,
        checkLeave: true,
        allowDismissed: true,
      });
      const grade = gradeByExamId.get(exam.id);
      const storedGradeLabel =
        grade?.status === "غائب"
          ? "غائب"
          : grade?.status === "غش"
            ? "غش"
            : grade?.status === "درجة" && grade.score !== null
              ? "ممتحن"
              : "بلا درجة";
      const excludedReasonCodes = new Set([
        "student-leave",
        "before-registration",
        "exam-unavailable",
        "student-archived",
      ]);
      const storedGradeIsExcluded = Boolean(
        grade && excludedReasonCodes.has(eligibility.code),
      );
      let label = storedGradeLabel;
      let reason = grade ? "توجد نتيجة محفوظة لهذا الامتحان." : eligibility.reason;
      let code = grade ? "graded" : eligibility.code;

      if (grade && storedGradeIsExcluded) {
        label = `${storedGradeLabel} — غير محتسبة`;
        reason = `${eligibility.reason} النتيجة محفوظة للمتابعة فقط ولا تغيّر فرص الطالب أو حالته الأكاديمية.`;
        code = eligibility.code;
      } else if (grade && eligibility.withinGrace) {
        label = `${storedGradeLabel} — ضمن السماح`;
        reason = "النتيجة محفوظة، لكن أثر الخصم محمي بسبب فترة السماح الحالية.";
        code = "grace-period";
      } else if (!grade) {
        if (eligibility.code === "student-leave") label = "مجاز";
        else if (eligibility.code === "before-registration") label = "سابق للتسجيل";
        else if (eligibility.code === "exam-unavailable") label = "غير متاح";
        else if (eligibility.withinGrace) label = "ضمن فترة السماح — بلا درجة";
      }

      examStates.push({
        examId: exam.id,
        code,
        label,
        reason,
        withinGrace: eligibility.withinGrace,
        hasLeave: eligibility.hasLeave,
        gradeId: grade?.id || null,
        gradeStatus: grade?.status || null,
        score: grade?.score ?? null,
      });
    }

    return NextResponse.json({
      studentId,
      grades,
      exams,
      examStates,
      examSummary: {
        total: exams.length,
        withGrade: examStates.filter((state) => state.gradeId).length,
        withoutGrade: examStates.filter((state) => !state.gradeId).length,
      },
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      logs: auditLogs,
      enrollmentArchives: enrollmentArchives.map((archive) => ({
        id: archive.id,
        studentId: archive.studentId,
        fromCourseId: archive.fromCourseId,
        fromCourseName: archive.fromCourseName,
        toCourseId: archive.toCourseId,
        toCourseName: archive.toCourseName,
        resetKind: archive.resetKind,
        reason: archive.reason,
        createdById: archive.createdById,
        createdByName: archive.createdByName,
        createdAt: archive.createdAt,
        snapshot: parseStudentEnrollmentArchiveSnapshot(archive.snapshot),
      })),
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل لوغ ملف الطالب من بيانات النظام.");
  }
}
