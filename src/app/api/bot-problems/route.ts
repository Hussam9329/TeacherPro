export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import {
  BOT_PROBLEM_REASON_MAX,
  BOT_PROBLEMS_PERMISSION,
  cleanBotProblemReason,
  type BotProblem,
} from "@/lib/bot-problems";

// «مشاكل البوت» is a notebook: none of these handlers writes an audit log or
// touches the student, so nothing here shows up anywhere but its window.

const PROBLEM_SELECT = {
  id: true,
  reason: true,
  createdAt: true,
  createdByName: true,
  resolvedAt: true,
  resolvedByName: true,
  student: {
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      telegram: true,
      username: true,
      course: { select: { name: true } },
    },
  },
} as const;

type ProblemRow = {
  id: string;
  reason: string;
  createdAt: Date;
  createdByName: string;
  resolvedAt: Date | null;
  resolvedByName: string;
  student: {
    id: string;
    name: string;
    code: string;
    status: string;
    telegram: string | null;
    username: string | null;
    course: { name: string } | null;
  };
};

function toProblem(row: ProblemRow): BotProblem {
  return {
    id: row.id,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedByName: row.resolvedByName,
    student: {
      id: row.student.id,
      name: row.student.name,
      code: row.student.code,
      status: row.student.status,
      courseName: row.student.course?.name || "",
      telegram: row.student.telegram || "",
      username: row.student.username || "",
    },
  };
}

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** Every problem, newest first; the window filters current and solved itself. */
export async function GET(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, BOT_PROBLEMS_PERMISSION);
  if (principal instanceof NextResponse) return principal;
  try {
    const rows = await withDatabaseSchema(() => db.botProblem.findMany({
      select: PROBLEM_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2000,
    }), "BotProblem");
    return NextResponse.json({ problems: rows.map(toProblem) }, NO_STORE);
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل مشاكل البوت.");
  }
}

/** Adds a problem; it starts as a current one. */
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, BOT_PROBLEMS_PERMISSION);
  if (principal instanceof NextResponse) return principal;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
  const reason = cleanBotProblemReason(body?.reason);
  if (!studentId || studentId.length > 128) return validationError("اختر الطالب أولاً.");
  if (!reason) return validationError("اكتب سبب المشكلة.");
  if (reason.length > BOT_PROBLEM_REASON_MAX) {
    return validationError(`سبب المشكلة طويل؛ الحد ${BOT_PROBLEM_REASON_MAX} حرف.`);
  }
  try {
    const row = await withDatabaseSchema(async () => {
      const student = await db.student.findUnique({ where: { id: studentId }, select: { id: true } });
      if (!student) return null;
      return db.botProblem.create({
        data: {
          studentId,
          reason,
          createdById: principal.id,
          createdByName: principal.name || principal.username || "",
        },
        select: PROBLEM_SELECT,
      });
    }, "BotProblem");
    if (!row) return validationError("الطالب غير موجود.", 404);
    return NextResponse.json({ problem: toProblem(row) }, { status: 201, ...NO_STORE });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ المشكلة.");
  }
}

/** Ticks a problem solved, or brings it back to the current ones. */
export async function PATCH(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, BOT_PROBLEMS_PERMISSION);
  if (principal instanceof NextResponse) return principal;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id || id.length > 128) return validationError("تعذر تحديد المشكلة.");
  if (typeof body?.resolved !== "boolean") return validationError("حالة المشكلة غير صحيحة.");
  const resolved = body.resolved;
  try {
    const row = await withDatabaseSchema(async () => {
      const existing = await db.botProblem.findUnique({ where: { id }, select: { id: true, resolvedAt: true } });
      if (!existing) return null;
      // Ticking twice keeps the first time and name.
      if (Boolean(existing.resolvedAt) === resolved) {
        return db.botProblem.findUnique({ where: { id }, select: PROBLEM_SELECT });
      }
      return db.botProblem.update({
        where: { id },
        data: resolved
          ? { resolvedAt: new Date(), resolvedById: principal.id, resolvedByName: principal.name || principal.username || "" }
          : { resolvedAt: null, resolvedById: null, resolvedByName: "" },
        select: PROBLEM_SELECT,
      });
    }, "BotProblem");
    if (!row) return validationError("المشكلة غير موجودة؛ حدّث القائمة.", 404);
    return NextResponse.json({ problem: toProblem(row) }, NO_STORE);
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحديث المشكلة.");
  }
}
