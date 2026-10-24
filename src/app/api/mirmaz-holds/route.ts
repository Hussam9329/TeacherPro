export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { writeAuditLog } from "@/lib/audit-log-server";
import { normalizeForSearch } from "@/lib/validation";
import { compareNames } from "@/lib/mirmaz-name-match";
import { examsAround, saveThroughGradeEntry } from "@/lib/mirmaz-integration-server";

/**
 * «مرماز برو»: grades from Mirmaz Pro that did not place themselves.
 *   GET                         pending holds (or ?status=RESOLVED|REJECTED) and the counts
 *   GET ?students=<name>        students for a manual pick (same name matching as the tool, then plain search)
 *   GET ?examsNear=<day>&fullMark=<n>  exams within a week of that day
 *   PATCH { id, action: "resolve", studentId, examId, confirmReplace? }  saves it as the signed-in user
 *   PATCH { id, action: "reject" }       sets it aside
 * Placing a grade needs «إدخال درجات» (grades.add), like the grade entry screen.
 */

const STATUSES = new Set(["PENDING", "RESOLVED", "REJECTED"]);
const LIST_LIMIT = 300;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "grades.add");
  if (principal instanceof NextResponse) return principal;
  try {
    const params = req.nextUrl.searchParams;

    const studentQuery = params.get("students");
    if (studentQuery !== null) {
      const wanted = studentQuery.trim();
      if (wanted.length < 2) return NextResponse.json({ students: [] });
      const plain = normalizeForSearch(wanted);
      const students = await db.student.findMany({
        where: { status: { not: "مؤرشف" } },
        select: { id: true, name: true, code: true, status: true, course: { select: { name: true } } },
      });
      const ranked = students
        .map((student) => ({ student, match: compareNames(wanted, student.name), contains: normalizeForSearch(`${student.name} ${student.code}`).includes(plain) }))
        .filter((item) => item.match.likely || item.contains)
        .sort((x, y) => Number(y.match.full) - Number(x.match.full) || y.match.matched - x.match.matched || Number(y.contains) - Number(x.contains))
        .slice(0, 20)
        .map(({ student, match }) => ({
          id: student.id, name: student.name, code: student.code, status: student.status,
          course: student.course?.name || "", matched: match.matched, of: match.of, full: match.full,
        }));
      return NextResponse.json({ students: ranked }, { headers: { "Cache-Control": "no-store" } });
    }

    const near = params.get("examsNear");
    if (near !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(near)) return NextResponse.json({ exams: [] });
      const fullMark = Number(params.get("fullMark"));
      const exams = await examsAround(near, Number.isInteger(fullMark) && fullMark > 0 ? fullMark : null, 7);
      return NextResponse.json({
        exams: exams.map((exam) => ({ id: exam.id, name: exam.name, date: exam.dayKey, fullMark: exam.fullMark })),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const status = STATUSES.has(String(params.get("status"))) ? String(params.get("status")) : "PENDING";
    const [holds, grouped] = await Promise.all([
      db.mirmazHold.findMany({ where: { status }, orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" }, take: LIST_LIMIT }),
      db.mirmazHold.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts = { PENDING: 0, RESOLVED: 0, REJECTED: 0 } as Record<string, number>;
    for (const row of grouped) counts[row.status] = row._count._all;
    const placedIds = holds.flatMap((hold) => [hold.resolvedStudentId, hold.resolvedExamId]).filter(Boolean) as string[];
    const [placedStudents, placedExams] = placedIds.length
      ? await Promise.all([
          db.student.findMany({ where: { id: { in: placedIds } }, select: { id: true, name: true } }),
          db.exam.findMany({ where: { id: { in: placedIds } }, select: { id: true, name: true } }),
        ])
      : [[], []];
    const nameOf = new Map([...placedStudents, ...placedExams].map((item) => [item.id, item.name]));
    return NextResponse.json({
      holds: holds.map((hold) => ({
        ...hold,
        candidates: parseJson(hold.candidates, []),
        examCandidates: parseJson(hold.examCandidates, []),
        resolvedStudentName: hold.resolvedStudentId ? nameOf.get(hold.resolvedStudentId) ?? null : null,
        resolvedExamName: hold.resolvedExamId ? nameOf.get(hold.resolvedExamId) ?? null : null,
      })),
      counts,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل «مرماز برو».");
  }
}

export async function PATCH(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "grades.add");
  if (principal instanceof NextResponse) return principal;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const id = String(body?.id || "").trim();
    const action = String(body?.action || "");
    if (!id || !["resolve", "reject"].includes(action)) return validationError("طلب غير صحيح.");
    const hold = await db.mirmazHold.findUnique({ where: { id } });
    if (!hold) return validationError("الدرجة المعلّقة غير موجودة.", 404);
    if (hold.status !== "PENDING") return validationError("هذي الدرجة انعالجت قبل.", 409);

    if (action === "reject") {
      await db.mirmazHold.update({ where: { id }, data: { status: "REJECTED", resolvedByName: principal.name, resolvedAt: new Date() } });
      await writeAuditLog(principal, "الدرجات", "ترك درجة معلّقة من Mirmaz Pro", { holdId: id, answerId: hold.answerId, studentName: hold.studentName, score: hold.score });
      return NextResponse.json({ ok: true });
    }

    const studentId = String(body?.studentId || "").trim();
    const examId = String(body?.examId || "").trim();
    if (!studentId || !examId) return validationError("اختر الطالب والامتحان.");
    const [student, exam, current] = await Promise.all([
      db.student.findUnique({ where: { id: studentId }, select: { name: true } }),
      db.exam.findUnique({ where: { id: examId }, select: { name: true, fullMark: true } }),
      db.grade.findUnique({ where: { studentId_examId: { studentId, examId } }, select: { status: true, score: true } }),
    ]);
    if (!student || !exam) return validationError("الطالب أو الامتحان غير موجود.", 404);
    if (hold.score > exam.fullMark) return validationError(`الدرجة ${hold.score} أكبر من الدرجة الكاملة لهذا الامتحان (${exam.fullMark}).`);
    const hasResult = current && (current.score !== null || current.status !== "درجة");
    if (hasResult && !(current!.status === "درجة" && current!.score === hold.score) && body?.confirmReplace !== true) {
      const what = current!.score !== null ? `درجة ${current!.score}` : `«${current!.status}»`;
      return NextResponse.json({ ok: false, code: "CONFIRM_REPLACE", error: `${student.name} عنده ${what} بهذا الامتحان. تبدلها بـ ${hold.score}؟` }, { status: 409 });
    }

    // As the person placing it: their session, their name in the log.
    const saved = await saveThroughGradeEntry(req.url, req.headers.get("cookie") || "", studentId, examId, hold.score);
    if (!saved.ok) return NextResponse.json({ ok: false, code: saved.code, error: saved.error }, { status: saved.status });
    await db.mirmazHold.update({
      where: { id },
      data: { status: "RESOLVED", resolvedStudentId: studentId, resolvedExamId: examId, resolvedByName: principal.name, resolvedAt: new Date() },
    });
    await writeAuditLog(principal, "الدرجات", "تثبيت درجة معلّقة من Mirmaz Pro", { holdId: id, answerId: hold.answerId, studentId, examId, score: hold.score });
    return NextResponse.json({ ok: true, stored: saved.status === 202 ? "pending_note" : "grade", studentName: student.name, examName: exam.name });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ الدرجة المعلّقة.");
  }
}
