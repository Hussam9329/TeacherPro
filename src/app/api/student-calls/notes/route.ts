export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasPermission, oversees, requireAnyPermissionPrincipal, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { CALL_STUDENT_NOTE_CATEGORY, hasManualCallNote } from "@/lib/call-notes-filter";
import { normalizeContactStatus } from "@/lib/call-contact-status";
import { studentCourseScopeWhere, studentScopeWhere } from "@/lib/student-scope";
import {
  CallNoteMutationError, readExpectedNoteRevision, setCallNoteResolved,
} from "@/lib/call-note-management-server";

// «الأرشيف»: the newest completed notes, and who completed each and when
// (read from the «إنجاز ملاحظة مكالمات» entries of the action log).
const ARCHIVE_LIMIT = 1000;
const RESOLUTION_LOG_LIMIT = 3000;

async function loadNoteResolutions(noteIds: string[]) {
  const wanted = new Set(noteIds);
  const found = new Map<string, { at: Date; by: string | null }>();
  if (!wanted.size) return found;
  const logs = await db.auditLog.findMany({
    where: { module: "المكالمات", action: "إنجاز ملاحظة مكالمات" },
    select: { time: true, userName: true, details: true },
    orderBy: [{ time: "desc" }, { id: "desc" }],
    take: RESOLUTION_LOG_LIMIT,
  });
  for (const log of logs) {
    let id = "";
    try {
      const details = JSON.parse(log.details || "{}") as { after?: { id?: unknown } | null };
      id = typeof details.after?.id === "string" ? details.after.id : "";
    } catch {
      continue;
    }
    // Newest first: a note completed, reopened and completed again keeps the last time.
    if (wanted.has(id) && !found.has(id)) found.set(id, { at: log.time, by: log.userName });
  }
  return found;
}

export async function GET(req: NextRequest) {
  const principal = await requireAnyPermissionPrincipal(req, ["follow-up.calls.view", "follow-up.view"]);
  if (principal instanceof NextResponse) return principal;
  // The platform button (open the platform, copy the student's phone) is for
  // whoever can open «إغلاق الكودات»; nobody else gets the phone from here.
  const platform = principal.isAdmin || oversees(principal) ||
    ["students.view", "page.dismissed-students.view"].some((permission) => principal.permissions.includes(permission));
  // Whoever may edit students fixes the student's and the parent's numbers
  // right on the card, so they get both numbers.
  const contacts = hasPermission(principal, "students.edit");
  try {
    const params = new URL(req.url).searchParams;
    const archive = params.get("view") === "archive";
    const courseId = (params.get("courseId") || "").trim();
    const examId = (params.get("examId") || "").trim();
    const result = await withDatabaseSchema(async () => {
      // The dashboard opens the complete shared queue. Optional parameters are
      // retained for callers that already request one course/exam explicitly.
      const exam = examId
        ? await db.exam.findUnique({ where: { id: examId }, select: { id: true, name: true } })
        : null;
      if (examId && !exam) throw new CallNoteMutationError("الامتحان غير موجود.", 404);
      if (examId && courseId) {
        const examCourse = await db.examCourse.findFirst({ where: { examId, courseId }, select: { id: true } });
        if (!examCourse) throw new CallNoteMutationError("الامتحان غير مرتبط بالدورة المختارة.", 400);
      }
      const notes = await db.studentCall.findMany({
        where: {
          category: CALL_STUDENT_NOTE_CATEGORY,
          // Completed notes stay in the database; they are «الأرشيف».
          noteResolved: archive,
          notes: { not: "" },
          ...(examId ? { OR: [{ examId }, { examId: null }] } : {}),
          student: { is: courseId ? studentCourseScopeWhere(courseId, "followup") : studentScopeWhere("followup") },
        },
        select: {
          id: true, studentId: true, examId: true, notes: true,
          category: true, noteRevision: true, noteResolved: true, createdAt: true,
          exam: { select: { id: true, name: true } },
          student: { select: { id: true, name: true, code: true, telegram: true, username: true, phone: platform || contacts, parentPhone: contacts, courseId: true, course: { select: { id: true, name: true } } } },
        },
        orderBy: archive
          ? [{ createdAt: "desc" }, { id: "desc" }]
          : [{ student: { name: "asc" } }, { createdAt: "desc" }, { id: "desc" }],
        ...(archive ? { take: ARCHIVE_LIMIT } : {}),
      });
      const visibleNotes = notes.filter(hasManualCallNote);
      const resolutions = archive ? await loadNoteResolutions(visibleNotes.map((note) => note.id)) : null;
      const studentIds = [...new Set(visibleNotes.map((note) => note.studentId))];
      const calls = studentIds.length ? await db.studentCall.findMany({
        where: { studentId: { in: studentIds }, category: { not: CALL_STUDENT_NOTE_CATEGORY } },
        select: { studentId: true, examId: true, status: true, completed: true, exam: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }) : [];
      const contactKey = (studentId: string, callExamId: string | null) => JSON.stringify([studentId, callExamId]);
      const contactByExam = new Map<string, typeof calls[number]>();
      const latestContactByStudent = new Map<string, typeof calls[number]>();
      for (const call of calls) {
        const key = contactKey(call.studentId, call.examId);
        if (!contactByExam.has(key)) contactByExam.set(key, call);
        if (!latestContactByStudent.has(call.studentId) && normalizeContactStatus(call)) {
          latestContactByStudent.set(call.studentId, call);
        }
      }
      return {
        notes: visibleNotes.map((note) => {
          // A note for one exam must never borrow another exam's action.
          // Older general notes remain general; their latest actual contact is
          // presented separately rather than inventing an exam association.
          const contact = note.examId
            ? contactByExam.get(contactKey(note.studentId, note.examId))
            : latestContactByStudent.get(note.studentId);
          const resolution = resolutions?.get(note.id);
          return {
            ...note,
            scope: note.examId ? "exam" : "general",
            contactStatus: normalizeContactStatus(contact),
            contactExam: contact?.exam || null,
            ...(resolutions ? { resolvedAt: resolution?.at.toISOString() || null, resolvedBy: resolution?.by || null } : {}),
          };
        }),
        exam, totalCount: visibleNotes.length, view: archive ? "archive" : "pending", platform, contacts,
        source: "database",
      };
    }, "StudentCall");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CallNoteMutationError) return NextResponse.json({ error: error.message, studentCall: error.studentCall }, { status: error.status });
    return routeErrorResponse(error, "تعذر تحميل ملاحظات المكالمات حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "follow-up.calls.manage");
  if (principal instanceof NextResponse) return principal;
  try {
    const body = await req.json();
    const id = String(body.id || "").trim();
    const expectedRevision = readExpectedNoteRevision(body.expectedRevision);
    if (!id || expectedRevision === undefined || typeof body.resolved !== "boolean") {
      return validationError("تعذر تحديد الملاحظة وحالة الإنجاز المطلوبة.");
    }
    const studentCall = await withDatabaseSchema(
      () => db.$transaction((tx) => setCallNoteResolved(tx, principal, {
        id, expectedRevision, resolved: body.resolved,
      })), "StudentCall",
    );
    return NextResponse.json({ studentCall });
  } catch (error) {
    if (error instanceof CallNoteMutationError) return NextResponse.json({ error: error.message, studentCall: error.studentCall }, { status: error.status });
    return routeErrorResponse(error, "تعذر حفظ إنجاز الملاحظة حالياً.");
  }
}

export const PATCH = PUT;
