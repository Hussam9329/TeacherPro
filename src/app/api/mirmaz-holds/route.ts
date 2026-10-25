export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { writeAuditLog } from "@/lib/audit-log-server";
import { normalizeForSearch } from "@/lib/validation";
import { compareNames } from "@/lib/mirmaz-name-match";
import { MIRMAZ_KEY_PREFIX, examsAround, saveThroughGradeEntry } from "@/lib/mirmaz-integration-server";

/**
 * «مرماز برو»: every grade that came from Mirmaz Pro, and the ones that did
 * not place themselves, to place by hand.
 *   GET ?view=all               every grade from Mirmaz, grouped by exam, with its state now
 *   GET                         pending holds (or ?status=RESOLVED|REJECTED) and the counts
 *   GET ?students=<name>        students for a manual pick (same name matching as the tool, then plain search)
 *   GET ?examsNear=<day>&fullMark=<n>  exams within a week of that day
 *   PATCH { id, action: "resolve", studentId, examId, confirmReplace? }  saves it as the signed-in user
 *   PATCH { id, action: "reject" }       sets it aside
 * Placing a grade needs «إدخال درجات» (grades.add), like the grade entry screen.
 */

const STATUSES = new Set(["PENDING", "RESOLVED", "REJECTED"]);
const LIST_LIMIT = 300;
const ALL_LIMIT = 5000;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type LedgerRow = {
  answerId: string;
  /** SAVED (placed itself) | RESOLVED (placed by hand) | PENDING (waits) | REJECTED (set aside) */
  status: string;
  holdId: string | null;
  score: number;
  studentName: string;
  examName: string;
  examDate: string;
  examFullMark: number | null;
  correctedBy: string;
  note: string;
  studentId: string | null;
  examId: string | null;
  byName: string | null;
  at: string;
};

/**
 * Grades that placed themselves before each paper kept its own row (status
 * SAVED): read from their receipts, the newest per paper.
 */
async function savedBeforeRows(known: Set<string>): Promise<LedgerRow[]> {
  const receipts = await db.correctionReceipt.findMany({
    where: { kind: "mirmaz-grade", response: { not: { contains: "\"pending\":true" } } },
    orderBy: { createdAt: "desc" },
    take: ALL_LIMIT,
    select: { key: true, studentId: true, examId: true, response: true, createdAt: true },
  });
  const rows: LedgerRow[] = [];
  for (const receipt of receipts) {
    const [answerId, score] = receipt.key.slice(MIRMAZ_KEY_PREFIX.length).split(":");
    if (!answerId || known.has(answerId)) continue;
    const stored = parseJson<{ status?: number; body?: { stored?: string } }>(receipt.response, {});
    if (stored.status !== 200) continue;
    known.add(answerId);
    rows.push({
      answerId, status: "SAVED", holdId: null, score: Number(score) || 0,
      studentName: "", examName: "", examDate: "", examFullMark: null, correctedBy: "",
      note: stored.body?.stored === "pending_note" ? "انحفظت كملاحظة معلّقة (حسب قواعد TeacherPro)" : "",
      studentId: receipt.studentId, examId: receipt.examId, byName: "تلقائي", at: receipt.createdAt.toISOString(),
    });
  }
  return rows;
}

/** Every grade from Mirmaz, grouped by exam (TeacherPro's exam once placed, else Mirmaz's), newest first. */
async function allGrades() {
  const holds = await db.mirmazHold.findMany({ orderBy: { updatedAt: "desc" }, take: ALL_LIMIT });
  const rows: LedgerRow[] = holds.map((hold) => ({
    answerId: hold.answerId,
    status: hold.status,
    holdId: hold.id,
    score: hold.score,
    studentName: hold.studentName,
    examName: hold.examName,
    examDate: hold.examDate,
    examFullMark: hold.examFullMark,
    correctedBy: hold.correctedBy,
    note: hold.status === "PENDING" ? hold.reasonText : hold.status === "SAVED" ? hold.reasonText : "",
    studentId: hold.resolvedStudentId,
    examId: hold.resolvedExamId,
    byName: hold.resolvedByName,
    at: (hold.resolvedAt ?? hold.updatedAt).toISOString(),
  }));
  rows.push(...(await savedBeforeRows(new Set(rows.map((row) => row.answerId)))));

  const studentIds = [...new Set(rows.map((row) => row.studentId).filter(Boolean))] as string[];
  const examIds = [...new Set(rows.map((row) => row.examId).filter(Boolean))] as string[];
  // `in: []` matches nothing, so empty lists need no special case.
  const [students, exams, grades] = await Promise.all([
    db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } }),
    db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, name: true, date: true, fullMark: true } }),
    db.grade.findMany({ where: { studentId: { in: studentIds }, examId: { in: examIds } }, select: { studentId: true, examId: true, status: true, score: true } }),
  ]);
  const studentName = new Map(students.map((student) => [student.id, student.name]));
  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const gradeOf = new Map(grades.map((grade) => [`${grade.studentId}:${grade.examId}`, grade]));

  type Group = { key: string; title: string; date: string; fullMark: number | null; placed: boolean; rows: Array<Record<string, unknown>> };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const exam = row.examId ? examById.get(row.examId) : undefined;
    const key = exam ? `tp:${exam.id}` : `mz:${row.examName || "—"}`;
    let group = groups.get(key);
    if (!group) {
      group = exam
        ? { key, title: exam.name, date: exam.date.toISOString().slice(0, 10), fullMark: exam.fullMark, placed: true, rows: [] }
        : { key, title: row.examName || "امتحان غير معروف", date: row.examDate, fullMark: row.examFullMark, placed: false, rows: [] };
      groups.set(key, group);
    }
    const now = row.studentId && row.examId ? gradeOf.get(`${row.studentId}:${row.examId}`) : undefined;
    group.rows.push({
      ...row,
      tpStudentName: row.studentId ? studentName.get(row.studentId) ?? null : null,
      fullMark: exam?.fullMark ?? row.examFullMark,
      current: now ? { status: now.status, score: now.score } : null,
    });
  }
  const counts = { ALL: rows.length, SAVED: 0, RESOLVED: 0, PENDING: 0, REJECTED: 0 } as Record<string, number>;
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return { groups: [...groups.values()], counts, generatedAt: new Date().toISOString() };
}

export async function GET(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "grades.add");
  if (principal instanceof NextResponse) return principal;
  try {
    const params = req.nextUrl.searchParams;

    if (params.get("view") === "all") {
      return NextResponse.json(await allGrades(), { headers: { "Cache-Control": "no-store" } });
    }

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
    counts.ALL = grouped.reduce((sum, row) => sum + row._count._all, 0); // «كل الدرجات» (receipts from before are counted there)
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
