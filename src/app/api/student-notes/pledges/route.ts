export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { Prisma } from "@prisma/client";

const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";
const ARCHIVED_STUDENT_STATUS = "مؤرشف";

type DismissalInfo = {
  key: string;
  sourceType: string;
  sourceId: string;
  type: string;
  reason: string;
  date: string;
  examName: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function dayKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "";
  return String(value || "").slice(0, 10);
}

function normalizeDismissalText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/^تلقائي:\s*/, "")
    .replace(/^فصل الطالب:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDismissalKey(parts: {
  studentId: string;
  sourceType: string;
  sourceId: string;
  type: string;
  reason: string;
  date: string;
}) {
  return [
    parts.studentId,
    parts.sourceType,
    parts.sourceId,
    normalizeDismissalText(parts.type),
    normalizeDismissalText(parts.reason),
    dayKey(parts.date),
  ].join("::");
}

function dismissalGroupFromType(type: string | null | undefined) {
  return String(type || "").includes("نهائي") ? "final" : "temporary";
}

function rowMatchesSearch(row: { student: Record<string, unknown>; dismissalInfo: DismissalInfo; note?: Record<string, unknown> | null }, query: string) {
  if (!query.trim()) return true;
  const haystack = [
    row.student.name,
    row.student.code,
    row.student.phone,
    row.student.parentPhone,
    row.student.telegram,
    row.student.school,
    row.student.status,
    row.dismissalInfo.type,
    row.dismissalInfo.reason,
    row.dismissalInfo.examName,
    row.note?.text,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return haystack.includes(query.trim().toLowerCase());
}

function isLikelyDismissalLog(log: { action: string; reason: string | null }, dismissalReason: string): boolean {
  const rawReason = String(log.reason || "");
  const logReason = normalizeDismissalText(rawReason);
  const normalizedReason = normalizeDismissalText(dismissalReason);
  return (
    log.action === "فصل تلقائي" ||
    (log.action === "خصم" && rawReason.startsWith("فصل الطالب")) ||
    Boolean(normalizedReason && logReason.includes(normalizedReason))
  );
}

async function getActiveChapterForCourse(
  tx: Prisma.TransactionClient,
  courseId: string,
) {
  const links = await tx.courseChapter.findMany({
    where: { courseId, active: true, archived: false },
    select: {
      chapter: { select: { id: true, name: true, opportunities: true } },
    },
  });
  if (links.length !== 1) return null;
  return links[0].chapter;
}

function buildInfoForDismissedStudent(
  student: {
    id: string;
    status: string;
    dismissalType: string | null;
    dismissalReason: string | null;
    createdAt: Date;
  },
  logs: Array<{
    id: string;
    action: string;
    reason: string | null;
    date: Date;
    examId: string | null;
    exam?: { name: string } | null;
  }>,
  actionNotes: Array<{
    id: string;
    kind: string;
    text: string;
    date: Date;
  }>,
): DismissalInfo | null {
  if (student.status !== "مفصول") return null;
  const type = student.dismissalType || "فصل مؤقت";
  const reason = student.dismissalReason || type || "طالب مفصول";
  const normalizedReason = normalizeDismissalText(reason);

  const dismissalLogs = logs
    .filter((log) => isLikelyDismissalLog(log, reason))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const sourceLog =
    dismissalLogs.find((log) => log.action === "فصل تلقائي") ||
    dismissalLogs[0] ||
    null;

  const sourceNote = sourceLog
    ? null
    : actionNotes
        .filter((note) => note.kind === "إجراء")
        .filter((note) => {
          const noteText = normalizeDismissalText(note.text);
          return (
            note.text.includes("فصل الطالب") ||
            (normalizedReason && noteText.includes(normalizedReason))
          );
        })
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0] || null;

  const sourceType = sourceLog ? "opportunity-log" : sourceNote ? "student-note" : "student-dismissal";
  const sourceId = sourceLog?.id || sourceNote?.id || student.id;
  const date = dayKey(sourceLog?.date || sourceNote?.date || student.createdAt);

  return {
    key: buildDismissalKey({
      studentId: student.id,
      sourceType,
      sourceId,
      type,
      reason,
      date,
    }),
    sourceType,
    sourceId,
    type,
    reason,
    date,
    examName: sourceLog?.exam?.name || "",
  };
}

function buildInfoFromPledgeNote(
  student: { id: string },
  note: {
    id: string;
    text: string;
    date: Date;
    sourceType: string;
    sourceId: string;
    dismissalKey: string;
    dismissalType: string;
    dismissalReason: string;
    dismissalDate: Date | null;
  },
  sourceLog?: { date: Date; exam?: { name: string } | null } | null,
): DismissalInfo {
  const type = note.dismissalType || "فصل مؤقت";
  const reason = note.dismissalReason || note.text || type;
  const sourceType = note.sourceType || "pledge-note";
  const sourceId = note.sourceId || note.id;
  const date = dayKey(note.dismissalDate || sourceLog?.date || note.date);
  const key =
    note.dismissalKey ||
    buildDismissalKey({
      studentId: student.id,
      sourceType,
      sourceId,
      type,
      reason,
      date,
    });

  return {
    key,
    sourceType,
    sourceId,
    type,
    reason,
    date,
    examName: sourceLog?.exam?.name || "",
  };
}

async function buildPledgeRows(searchParams: URLSearchParams) {
  const q = cleanText(searchParams.get("q"));
  const typeFilter = cleanText(searchParams.get("typeFilter") || "all");
  const statusFilter = cleanText(searchParams.get("statusFilter") || "all");

  const [dismissedStudents, pledgeNotes] = await db.$transaction([
    db.student.findMany({
      where: { status: "مفصول" },
      include: { course: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.studentNote.findMany({
      where: { kind: PLEDGE_NOTE_KIND },
      include: { student: { include: { course: { select: { name: true } } } } },
      orderBy: { date: "desc" },
      take: 1000,
    }),
  ]);

  const studentIds = Array.from(
    new Set([
      ...dismissedStudents.map((student) => student.id),
      ...pledgeNotes.map((note) => note.studentId),
    ]),
  );

  type LogRow = Awaited<ReturnType<typeof db.opportunityLog.findMany>>[number];
  type ActionNoteRow = Awaited<
    ReturnType<typeof db.studentNote.findMany>
  >[number];

  let logs: LogRow[] = [];
  let actionNotes: ActionNoteRow[] = [];
  if (studentIds.length) {
    const [l, a] = await db.$transaction([
      db.opportunityLog.findMany({
        where: { studentId: { in: studentIds } },
        include: { exam: { select: { name: true } } },
        orderBy: { date: "desc" },
      }),
      db.studentNote.findMany({
        where: { studentId: { in: studentIds }, kind: "إجراء" },
        orderBy: { date: "desc" },
      }),
    ]);
    logs = l as LogRow[];
    actionNotes = a as ActionNoteRow[];
  }

  const logsByStudent = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = logsByStudent.get(log.studentId) || [];
    list.push(log);
    logsByStudent.set(log.studentId, list);
  }

  const actionNotesByStudent = new Map<string, typeof actionNotes>();
  for (const note of actionNotes) {
    const list = actionNotesByStudent.get(note.studentId) || [];
    list.push(note);
    actionNotesByStudent.set(note.studentId, list);
  }

  const pledgeNotesByStudent = new Map<string, typeof pledgeNotes>();
  for (const note of pledgeNotes) {
    const list = pledgeNotesByStudent.get(note.studentId) || [];
    list.push(note);
    pledgeNotesByStudent.set(note.studentId, list);
  }

  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const student of dismissedStudents) {
    const dismissalInfo = buildInfoForDismissedStudent(
      student,
      logsByStudent.get(student.id) || [],
      actionNotesByStudent.get(student.id) || [],
    );
    if (!dismissalInfo) continue;

    const linkedNote = (pledgeNotesByStudent.get(student.id) || []).find((note) => {
      if (note.dismissalKey) return note.dismissalKey === dismissalInfo.key;
      if (note.sourceType && note.sourceId)
        return note.sourceType === dismissalInfo.sourceType && note.sourceId === dismissalInfo.sourceId;
      const noteReason = normalizeDismissalText(note.dismissalReason || note.text);
      return (
        !noteReason ||
        noteReason.includes(normalizeDismissalText(dismissalInfo.reason)) ||
        normalizeDismissalText(dismissalInfo.reason).includes(noteReason)
      );
    }) || null;

    const key = linkedNote?.dismissalKey || dismissalInfo.key;
    seen.add(key);
    rows.push({
      key,
      student,
      dismissalInfo,
      group: dismissalGroupFromType(dismissalInfo.type),
      pledged: Boolean(linkedNote),
      note: linkedNote,
      reactivated: false,
      source: "database",
    });
  }

  for (const note of pledgeNotes) {
    const sourceLog =
      note.sourceType === "opportunity-log" && note.sourceId
        ? logs.find((log) => log.id === note.sourceId) || null
        : null;
    const dismissalInfo = buildInfoFromPledgeNote(note.student, note, sourceLog);
    const key = note.dismissalKey || dismissalInfo.key || note.id;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key,
      student: note.student,
      dismissalInfo,
      group: dismissalGroupFromType(note.dismissalType || dismissalInfo.type),
      pledged: true,
      note,
      reactivated: note.student.status !== "مفصول",
      source: "database",
    });
  }

  const stats = {
    dismissed: dismissedStudents.length,
    temporary: rows.filter((row) => row.group === "temporary" && (row.student as { status?: string }).status === "مفصول").length,
    final: rows.filter((row) => row.group === "final" && (row.student as { status?: string }).status === "مفصول").length,
    pledged: rows.filter((row) => Boolean(row.pledged)).length,
    reactivated: rows.filter((row) => Boolean(row.reactivated)).length,
    pending: rows.filter((row) => !row.pledged && (row.student as { status?: string }).status === "مفصول").length,
    source: "database" as const,
    generatedAt: new Date().toISOString(),
  };

  const filtered = rows
    .filter((row) => {
      if (typeFilter === "temporary" && row.group !== "temporary") return false;
      if (typeFilter === "final" && row.group !== "final") return false;
      if (statusFilter === "pledged" && !row.pledged) return false;
      if (statusFilter === "pending" && row.pledged) return false;
      if (statusFilter === "reactivated" && !row.reactivated) return false;
      return rowMatchesSearch(
        row as { student: Record<string, unknown>; dismissalInfo: DismissalInfo; note?: Record<string, unknown> | null },
        q,
      );
    })
    .sort((a, b) =>
      `${a.pledged ? 1 : 0}-${a.group === "temporary" ? 0 : 1}-${(a.student as { name?: string }).name || ""}`.localeCompare(
        `${b.pledged ? 1 : 0}-${b.group === "temporary" ? 0 : 1}-${(b.student as { name?: string }).name || ""}`,
        "ar",
      ),
    );

  return { rows: filtered, stats, totalCount: filtered.length, source: "database" as const, generatedAt: new Date().toISOString() };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const payload = await buildPledgeRows(new URL(req.url).searchParams);
    return NextResponse.json(payload);
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل التعهدات من قاعدة البيانات.");
  }
}

export async function POST(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "follow-up.manage");
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  try {
    const body = await req.json().catch(() => ({}));
    const action = cleanText(body.action);
    const studentId = cleanText(body.studentId);
    const dismissalInfo = (body.dismissalInfo || {}) as Partial<DismissalInfo>;
    const noteId = cleanText(body.noteId);

    if (!studentId) return validationError("تعذر تحديد الطالب المطلوب.");
    if (action !== "pledge-and-reactivate" && action !== "remove-pledge") {
      return validationError("إجراء التعهد غير معروف.");
    }

    if (action === "remove-pledge") {
      const result = await db.$transaction(async (tx) => {
        const student = await tx.student.findUnique({ where: { id: studentId } });
        if (!student) throw Object.assign(new Error("student not found"), { code: "P2025" });

        const where: Prisma.StudentNoteWhereInput = noteId
          ? { id: noteId, studentId, kind: PLEDGE_NOTE_KIND }
          : {
              studentId,
              kind: PLEDGE_NOTE_KIND,
              OR: [
                dismissalInfo.key ? { dismissalKey: cleanText(dismissalInfo.key) } : {},
                dismissalInfo.sourceType && dismissalInfo.sourceId
                  ? { sourceType: cleanText(dismissalInfo.sourceType), sourceId: cleanText(dismissalInfo.sourceId) }
                  : {},
              ].filter((item) => Object.keys(item).length > 0),
            };

        if (!noteId && (!where.OR || where.OR.length === 0)) {
          return { deletedCount: 0, student };
        }

        const deleted = await tx.studentNote.deleteMany({ where });

        await tx.auditLog.create({
          data: {
            module: "التعهدات",
            action: "إلغاء تعهد ولي الأمر",
            details: `${student.name} - ${student.code} - ${cleanText(dismissalInfo.reason) || "تعهد"}`,
            userId: principal.id,
            userName: principal.name,
          },
        });

        return { deletedCount: deleted.count, student };
      });

      return NextResponse.json({ ok: true, action, ...result, source: "database" });
    }

    const type = cleanText(dismissalInfo.type) || "فصل مؤقت";
    const reason = cleanText(dismissalInfo.reason) || "تعهد ولي الأمر";
    const sourceType = cleanText(dismissalInfo.sourceType) || "student-dismissal";
    const sourceId = cleanText(dismissalInfo.sourceId) || studentId;
    const dismissalDate = cleanText(dismissalInfo.date);
    const dismissalKey =
      cleanText(dismissalInfo.key) ||
      buildDismissalKey({
        studentId,
        sourceType,
        sourceId,
        type,
        reason,
        date: dismissalDate || dayKey(new Date()),
      });

    const result = await db.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw Object.assign(new Error("student not found"), { code: "P2025" });
      if (student.status === ARCHIVED_STUDENT_STATUS) {
        throw Object.assign(new Error("archived student cannot be pledged"), { statusCode: 409 });
      }

      const existing = await tx.studentNote.findFirst({
        where: {
          studentId,
          kind: PLEDGE_NOTE_KIND,
          OR: [
            { dismissalKey },
            { sourceType, sourceId },
          ],
        },
      });

      const pledgeNote =
        existing ||
        await tx.studentNote.create({
          data: {
            studentId,
            kind: PLEDGE_NOTE_KIND,
            text: `تم تعهد ولي الأمر على ${type}: ${reason}`,
            sourceType,
            sourceId,
            dismissalKey,
            dismissalType: type,
            dismissalReason: reason,
            dismissalDate: dismissalDate ? new Date(dismissalDate) : null,
          },
        });

      const shouldReactivate = student.status === "مفصول";
      const activeChapter = shouldReactivate ? await getActiveChapterForCourse(tx, student.courseId) : null;

      const updatedStudent = shouldReactivate
        ? await tx.student.update({
            where: { id: studentId },
            data: {
              status: "نشط",
              dismissalType: "",
              dismissalReason: "",
              dismissalNotes: "",
              opportunities: 1,
            },
          })
        : student;

      const reactivationLog = shouldReactivate
        ? await tx.opportunityLog.create({
            data: {
              studentId,
              examId: null,
              action: "إعادة تفعيل",
              amount: 0,
              reason: "تثبيت إعادة التفعيل بعد تعهد ولي الأمر: لا يعاد فصل الطالب بسبب سجلات قديمة، وأي مخالفة جديدة بعد الفرصة تصبح نهائية",
              chapterId: activeChapter?.id || null,
              chapterNameSnapshot: activeChapter?.name || null,
            },
          })
        : null;

      const finalChanceLog = shouldReactivate
        ? await tx.opportunityLog.create({
            data: {
              studentId,
              examId: null,
              action: "فرصة أخيرة بعد تعهد",
              amount: 1,
              reason: "إرجاع الطالب بعد تعهد ولي الأمر بفرصة واحدة فقط",
              chapterId: activeChapter?.id || null,
              chapterNameSnapshot: activeChapter?.name || null,
            },
          })
        : null;

      const actionNote = shouldReactivate
        ? await tx.studentNote.create({
            data: {
              studentId,
              kind: "إجراء",
              text: `إعادة تفعيل الطالب بعد تعهد ولي الأمر للفصل السابق: ${reason}`,
              sourceType: "pledge-reactivation",
              sourceId: pledgeNote.id,
              dismissalKey,
              dismissalType: type,
              dismissalReason: reason,
              dismissalDate: dismissalDate ? new Date(dismissalDate) : null,
            },
          })
        : null;

      await tx.auditLog.create({
        data: {
          module: "التعهدات",
          action: shouldReactivate ? "تثبيت تعهد وإعادة تفعيل" : "تثبيت تعهد ولي الأمر",
          details: `${student.name} - ${student.code} - ${type} - ${reason}`,
          userId: principal.id,
          userName: principal.name,
        },
      });

      return {
        student: updatedStudent,
        studentNote: pledgeNote,
        actionNote,
        opportunityLogs: [reactivationLog, finalChanceLog].filter(Boolean),
        reactivated: shouldReactivate,
      };
    });

    return NextResponse.json({ ok: true, action, ...result, source: "database" });
  } catch (error) {
    const err = error as { code?: string; statusCode?: number };
    if (err.code === "P2025") {
      return NextResponse.json({ error: "تعذر العثور على الطالب المطلوب." }, { status: 404 });
    }
    if (err.statusCode === 409) {
      return NextResponse.json({ error: "لا يمكن تثبيت تعهد لطالب مؤرشف. استعد الطالب أولاً." }, { status: 409 });
    }
    return routeErrorResponse(error, "تعذر تنفيذ إجراء التعهد حالياً.");
  }
}
