export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { Student } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { requireStudentDevice } from "@/lib/student-app/auth";
import { buildProfile } from "@/lib/student-app/profile";

export async function GET(req: NextRequest) {
  try {
    const session = await requireStudentDevice<Student>(req, db);
    if (session instanceof Response) return session;
    return NextResponse.json({ ok: true, student: await buildProfile(session.student) });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل بيانات الطالب حالياً.");
  }
}
