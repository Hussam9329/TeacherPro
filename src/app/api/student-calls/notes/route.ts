export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAnyPermission, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { CALL_STUDENT_NOTE_CATEGORY, hasManualCallNote } from "@/lib/call-notes-filter";
import { normalizeContactStatus } from "@/lib/call-contact-status";
import { studentCourseScopeWhere, studentScopeWhere } from "@/lib/student-scope";
import {
  CallNoteMutationError, readExpectedNoteRevision, setCallNoteResolved,
} from "@/lib/call-note-management-server";

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ["follow-up.calls.view", "follow-up.view"]);
  if (authError) return authError;
  try {
    const params = new URL(req.url).searchParams;
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
          noteResolved: false,
          notes: { not: "" },
          ...(examId ? { OR: [{ examId }, { examId: null }] } : {}),
          student: { is: courseId ? studentCourseScopeWhere(courseId, "followup") : studentScopeWhere("followup") },
        },
        select: {
          id: true, studentId: true, examId: true, notes: true,
          category: true, noteRevision: true, noteResolved: true, createdAt: true,
          exam: { select: { id: true, name: true } },
          student: { select: { id: true, name: true, code: true, courseId: true, course: { select: { id: true, name: true } } } },
        },
        orderBy: [{ student: { name: "asc" } }, { createdAt: "desc" }, { id: "desc" }],
      });
      const visibleNotes = notes.filter(hasManualCallNote);
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
          return {
            ...note,
            scope: note.examId ? "exam" : "general",
            contactStatus: normalizeContactStatus(contact),
            contactExam: contact?.exam || null,
          };
        }),
        exam, totalCount: visibleNotes.length,
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
