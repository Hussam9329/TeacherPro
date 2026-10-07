export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { oversees, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { normalizeListFilter } from "@/lib/all-filter";
import { parseCallWindowId } from "@/lib/call-batch";
import {
  closeCallWindow,
  currentCallStatus,
  heldByCallWindow,
  holdCallCase,
  liveCallWindows,
  releaseStaleCallWindows,
  retryCallTransaction,
  touchCallWindow,
} from "@/lib/call-reservations-server";
import { baghdadTodayKey } from "@/lib/baghdad-time";

/**
 * «دفعات» in إدارة المكالمات. POST: an open window beats (or says it went to
 * the background, or closes) so the batch it holds stays its own; a beat
 * answers with the students the window still holds, so the page drops any
 * that went to someone else, and with the running build, so a page left open
 * across an update asks to be reloaded. `hold`: «خذه للاتصال» holds one
 * student for this window unless someone else does. GET: the admin's
 * «منو شغال هسه».
 */
const RUNNING_BUILD = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_APP_BUILD || "";
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "follow-up.calls.manage");
  if (principal instanceof NextResponse) return principal;
  try {
    const body = await req.json().catch(() => ({}));
    const windowId = parseCallWindowId(body?.windowId);
    if (!windowId) return validationError("تعذر تحديد نافذة المكالمات.");
    const owner = { id: principal.id, name: principal.name || principal.username || "مستخدم" };
    if (body?.close === true) {
      await withDatabaseSchema(() => closeCallWindow(db, windowId, owner.id), "CallWindow");
      return NextResponse.json({ ok: true, closed: true });
    }
    const courseId = normalizeListFilter(body?.courseId);
    const examId = normalizeListFilter(body?.examId);
    if (!courseId || !examId) return validationError("اختر الدورة والامتحان أولاً.");
    const holdStudentId = typeof body?.hold === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.hold) ? body.hold : "";
    const seenStatus = typeof body?.seenStatus === "string" ? body.seenStatus.trim() : null;
    const now = new Date();
    const result = await withDatabaseSchema(() => retryCallTransaction(() => db.$transaction(async (tx) => {
      await releaseStaleCallWindows(tx, now);
      const owned = await touchCallWindow(tx, { id: windowId, owner, courseId, examId }, now, { away: body?.away === true });
      if (!owned) return null;
      let holdOk: boolean | undefined;
      let changed = false;
      let status = "";
      if (holdStudentId) {
        // A student called after the page loaded is not taken over a stale
        // card: the page gets the new status and reloads instead.
        const current = await currentCallStatus(tx, holdStudentId, examId);
        status = current || "";
        changed = current !== null && seenStatus !== null && seenStatus !== current;
        holdOk = current !== null && !changed &&
          await holdCallCase(tx, { id: windowId, ownerId: owner.id }, holdStudentId, examId, now);
      }
      const held = await heldByCallWindow(tx, windowId, examId, now);
      // Already this window's own: taking it again is fine.
      if (holdStudentId && !holdOk && !changed) holdOk = held.includes(holdStudentId);
      return { held, holdOk, changed, status };
    })), "CallWindow");
    if (!result) return NextResponse.json({ error: "هذه النافذة لحساب آخر." }, { status: 409 });
    return NextResponse.json({ ok: true, ...result, build: RUNNING_BUILD });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحديث نافذة المكالمات.");
  }
}

export async function GET(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "follow-up.calls.manage");
  if (principal instanceof NextResponse) return principal;
  if (!oversees(principal)) {
    return NextResponse.json({ error: "هذه الشاشة لمدير النظام والمشرفين فقط." }, { status: 403 });
  }
  try {
    const windows = await withDatabaseSchema(() => liveCallWindows(db), "CallWindow");
    const courseIds = [...new Set(windows.map((window) => window.courseId).filter(Boolean))];
    const examIds = [...new Set(windows.map((window) => window.examId).filter(Boolean))];
    const userIds = [...new Set(windows.map((window) => window.userId))];
    const todayStart = new Date(`${baghdadTodayKey()}T00:00:00+03:00`);
    const now = new Date();
    const [courses, exams, acted] = await Promise.all([
      db.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } }),
      db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, name: true } }),
      db.studentCall.groupBy({
        by: ["actedById"],
        where: { actedById: { in: userIds }, actedAt: { gte: todayStart }, status: { not: "" } },
        _count: { _all: true },
      }),
    ]);
    const courseName = new Map<string, string>(courses.map((course) => [course.id, course.name]));
    const examName = new Map<string, string>(exams.map((exam) => [exam.id, exam.name]));
    const actedToday = new Map<string, number>(acted.map((row) => [row.actedById || "", row._count._all]));
    return NextResponse.json({
      // Window ids stay on the server: they are what a window holds by.
      windows: windows.map((window, index) => ({
        key: `${index}-${window.openedAt.getTime?.() ?? index}`,
        userName: window.userName,
        courseName: courseName.get(window.courseId) || "",
        examName: examName.get(window.examId) || "",
        held: window.held,
        actedToday: actedToday.get(window.userId) || 0,
        openedAt: window.openedAt,
        lastSeenAt: window.lastSeenAt,
        // On a call from the same phone, or the screen locked: the batch waits.
        away: Boolean(window.awayUntil && new Date(window.awayUntil).getTime() >= now.getTime()),
        mine: window.userId === principal.id,
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر عرض نوافذ المكالمات المفتوحة.");
  }
}
