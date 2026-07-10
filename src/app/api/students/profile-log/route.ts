export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";

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
      },
    });
    if (!student) return validationError("الطالب غير موجود");

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

    const examIds = Array.from(
      new Set(
        [
          ...grades.map((grade) => grade.examId),
          ...opportunityLogs.map((log) => log.examId),
          ...studentLeaves.map((leave) => leave.examId),
          ...studentCalls.map((call) => call.examId),
        ]
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      ),
    );
    const exams = examIds.length
      ? await db.exam.findMany({ where: { id: { in: examIds } } })
      : [];

    return NextResponse.json({
      studentId,
      grades,
      exams,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      logs: auditLogs,
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل لوغ ملف الطالب من بيانات النظام.");
  }
}
