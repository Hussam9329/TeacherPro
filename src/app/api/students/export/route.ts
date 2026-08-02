export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { buildStudentRegistryWhere } from "@/lib/student-registry-filters-server";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const where = await buildStudentRegistryWhere(searchParams);
    const [totalCount, students] = await Promise.all([
      db.student.count({ where }),
      db.student.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { course: true },
      }),
    ]);

    const exportStudents = students.map((student) => ({
      ...student,
      courseName: student.course?.name || "",
    }));

    return NextResponse.json({
      students: exportStudents,
      total: exportStudents.length,
      totalCount,
      capped: false,
    });
  } catch (error) {
    console.error("[API] /api/students/export error:", error);
    return NextResponse.json(
      { error: "تعذر تصدير بيانات الطلاب حالياً." },
      { status: 500 },
    );
  }
}
