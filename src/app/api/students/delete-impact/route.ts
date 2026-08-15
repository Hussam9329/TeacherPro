export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { getStudentDeleteImpact } from "@/lib/student-delete-impact";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.delete");
  if (authError) return authError;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "تعذر تحديد الطالب المطلوب" },
      { status: 400 },
    );
  }

  const impact = await getStudentDeleteImpact(id);
  if (!impact) {
    return NextResponse.json(
      { error: "تعذر العثور على الطالب المطلوب" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ...impact, source: "database" });
}
