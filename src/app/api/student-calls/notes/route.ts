export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { CALL_STUDENT_NOTE_CATEGORY, hasManualCallNote } from "@/lib/call-notes-filter";
import { normalizeContactStatus } from "@/lib/call-contact-status";
import { studentCourseScopeWhere } from "@/lib/student-scope";
import {
  CallNoteMutationError, readExpectedNoteRevision, setCallNoteResolved,
} from "@/lib/call-note-management-server";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;
  try {
    const params = new URL(req.url).searchParams;
    const courseId = (params.get("courseId") || "").trim();
    const examId = (params.get("examId") || "").trim();
    if (!courseId || !examId) return validationError("اختر الدورة والامتحان أولاً.");
    const result = await withDatabaseSchema(async () => {
      const [exam, examCourse] = await Promise.all([
        db.exam.findUnique({ where: { id: examId }, select: { id: true, name: true } }),
        db.examCourse.findFirst({ where: { examId, courseId }, select: { id: true } }),
      ]);
      if (!exam) throw new CallNoteMutationError("الامتحان غير موجود.", 404);
      if (!examCourse) {
        throw new CallNoteMutationError("الامتحان غير مرتبط بالدورة المختارة.", 400);
      }
      const notes = await db.studentCall.findMany({
        where: {
          category: CALL_STUDENT_NOTE_CATEGORY,
          noteResolved: false,
          notes: { not: "" },
          OR: [{ examId }, { examId: null }],
          student: { is: studentCourseScopeWhere(courseId, "followup") },
        },
        select: {
          id: true, studentId: true, examId: true, notes: true,
          category: true, noteRevision: true, noteResolved: true, createdAt: true,
          student: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ student: { name: "asc" } }, { createdAt: "desc" }, { id: "desc" }],
      });
      const visibleNotes = notes.filter(hasManualCallNote);
      const studentIds = [...new Set(visibleNotes.map((note) => note.studentId))];
      const calls = studentIds.length ? await db.studentCall.findMany({
        where: { studentId: { in: studentIds }, examId, category: { not: CALL_STUDENT_NOTE_CATEGORY } },
        select: { studentId: true, status: true, completed: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }) : [];
      const contactByStudent = new Map<string, string>();
      for (const call of calls) {
        if (!contactByStudent.has(call.studentId)) {
          contactByStudent.set(call.studentId, normalizeContactStatus(call));
        }
      }
      return {
        notes: visibleNotes.map((note) => ({
          ...note,
          scope: note.examId ? "exam" : "general",
          contactStatus: contactByStudent.get(note.studentId) || "",
        })),
        exam: { id: exam.id, name: exam.name }, totalCount: visibleNotes.length,
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
