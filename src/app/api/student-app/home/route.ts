export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { Student } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { requireStudentDevice } from "@/lib/student-app/auth";
import { listRecentGrades, listUpcomingExams } from "@/lib/student-app/read-models";

export async function GET(req: NextRequest) {
  try {
    const session = await requireStudentDevice<Student>(req, db);
    if (session instanceof Response) return session;
    const now = new Date();
    const [upcomingExams, recent] = await Promise.all([
      listUpcomingExams(db, session.student, now),
      listRecentGrades(db, session.student),
    ]);
    return NextResponse.json({
      ok: true,
      upcomingExams,
      grades: recent.grades,
      gradesUnavailable: recent.unavailable,
      serverNow: now,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل الصفحة الرئيسية حالياً.");
  }
}
