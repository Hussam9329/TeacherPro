export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { listStudentGracePeriods } from "@/lib/grace-periods-server";
import {
  applyGraceChange,
  GraceChangeError,
  planGraceChange,
  type GraceChangeAction,
  type GraceChangeRequest,
} from "@/lib/grace-period-plan-server";

const ACTIONS = new Set<GraceChangeAction>(["create", "update", "cancel"]);

function readRequest(body: Record<string, unknown>): GraceChangeRequest | string {
  const action = String(body.action || "") as GraceChangeAction;
  if (!ACTIONS.has(action)) return "نوع العملية غير معروف.";
  const studentId = String(body.studentId || "").trim();
  if (!studentId) return "اختر الطالب أولاً.";
  return {
    studentId,
    action,
    periodId: body.periodId ? String(body.periodId) : undefined,
    startDate: body.startDate ? String(body.startDate) : undefined,
    endDate: body.endDate ? String(body.endDate) : undefined,
    cancelReason: body.cancelReason ? String(body.cancelReason) : undefined,
  };
}

/** GET /api/grace-periods?studentId= — the student's card, current and past periods. */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;
  try {
    const studentId = String(new URL(req.url).searchParams.get("studentId") || "").trim();
    if (!studentId) return validationError("اختر الطالب أولاً.");
    const result = await withDatabaseSchema(async () => {
      const student = await db.student.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          telegram: true,
          username: true,
          createdAt: true,
          course: { select: { name: true } },
        },
      });
      if (!student) return null;
      return { student, periods: await listStudentGracePeriods(db, studentId) };
    }, "GracePeriod");
    if (!result) return validationError("الطالب غير موجود.", 404);
    return NextResponse.json(
      {
        student: {
          id: result.student.id,
          name: result.student.name,
          code: result.student.code,
          status: result.student.status,
          telegram: result.student.telegram || "",
          username: result.student.username || "",
          createdAt: result.student.createdAt.toISOString(),
          courseName: result.student.course?.name || "",
        },
        periods: result.periods,
        today: baghdadTodayKey(),
        source: "database",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل فترات السماح.");
  }
}

/**
 * POST /api/grace-periods
 *   { mode: "preview", action, studentId, periodId?, startDate?, endDate? }
 *   { mode: "apply", ...same, previewToken, cancelReason? }
 * The only endpoint in TeacherPro that creates, edits or cancels a grace period.
 */
export async function POST(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "students.edit");
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const request = readRequest(body);
    if (typeof request === "string") return validationError(request);
    const mode = body.mode === "apply" ? "apply" : "preview";

    if (mode === "preview") {
      const plan = await withDatabaseSchema(
        () => withSerializableTransaction((tx) => planGraceChange(tx, request)),
        "GracePeriod",
      );
      return NextResponse.json({ ...plan, source: "database" });
    }

    const result = await withDatabaseSchema(
      () => withSerializableTransaction((tx) =>
        applyGraceChange(
          tx,
          { ...request, previewToken: String(body.previewToken || "") },
          { id: principal.id, name: principal.name },
        ),
      ),
      "GracePeriod",
    );
    return NextResponse.json({
      ok: true,
      periodId: result.periodId,
      student: result.student,
      affectedExams: result.plan.affectedExams.length,
      periods: await listStudentGracePeriods(db, request.studentId),
      source: "database",
    });
  } catch (error) {
    if (error instanceof GraceChangeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const code = (error as { code?: string; meta?: { code?: string } })?.meta?.code ||
      (error as { code?: string })?.code;
    if (code === "23P01" || String((error as Error)?.message || "").includes("GRACE_PERIOD_OVERLAP")) {
      return NextResponse.json(
        { error: "يوجد للطالب فترة سماح تتداخل مع الفترة المحددة. يرجى تعديل الفترة الموجودة بدلاً من إنشاء فترة جديدة." },
        { status: 409 },
      );
    }
    return routeErrorResponse(error, "تعذر حفظ فترة السماح.");
  }
}
