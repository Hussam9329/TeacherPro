export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { routeErrorResponse } from "@/lib/route-helpers";
import { lockStudentsAcademicState } from "@/lib/academic-student-lock-server";

export async function PATCH(req: NextRequest) {
  const authError = await requirePermission(req, "students.academicRepair");
  if (authError) return authError;
  try {
    const result = await db.$transaction(async (tx) => {
      const activeLinks = await tx.courseChapter.findMany({
        where: { active: true, archived: false },
        select: { courseId: true, chapterId: true, chapter: { select: { opportunities: true } } },
      });
      const perCourse: Array<{ courseId: string; chapterId: string; chapterOpportunities: number; fixedCount: number }> = [];
      let fixedTotal = 0;
      for (const link of activeLinks) {
        const cap = Math.max(0, Math.trunc(Number(link.chapter.opportunities || 0)));
        const students = await tx.student.findMany({
          where: { courseId: link.courseId, status: "نشط", opportunities: { gt: cap } },
          select: { id: true, opportunities: true },
        });
        if (!students.length) continue;
        await lockStudentsAcademicState(tx, students.map((student) => student.id));
        for (const student of students) {
          await tx.student.update({ where: { id: student.id }, data: { opportunities: cap, baseOpportunities: cap } });
          await tx.opportunityLog.create({ data: {
            studentId: student.id, action: "ضبط فوق السقف", amount: Math.max(0, student.opportunities - cap),
            requestedAmount: Math.max(0, student.opportunities - cap), appliedAmount: Math.max(0, student.opportunities - cap),
            balanceBefore: student.opportunities, balanceAfter: cap,
            reason: "ضبط إداري موثق لرصيد طالب نشط تجاوز سقف الفصل",
            chapterId: link.chapterId,
          } });
        }
        perCourse.push({ courseId: link.courseId, chapterId: link.chapterId, chapterOpportunities: cap, fixedCount: students.length });
        fixedTotal += students.length;
      }
      return { fixedTotal, perCourse };
    }, { isolationLevel: "Serializable" });
    await writeRequestAuditLog(req, "الطلاب", "ضبط فرص الطلاب النشطين فوق السقف", result);
    return NextResponse.json({ ok: true, message: result.fixedTotal ? `تم ضبط ${result.fixedTotal} طالب نشط فقط.` : "لا يوجد طلاب نشطون فوق السقف.", ...result, excludedStatuses: ["مفصول", "مؤرشف"] });
  } catch (error) {
    return routeErrorResponse(error, "تعذر ضبط فرص الطلاب.");
  }
}
