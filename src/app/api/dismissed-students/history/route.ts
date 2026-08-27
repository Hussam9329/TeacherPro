export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { formatAppDate } from "@/lib/format";
import { parseStudentEnrollmentArchiveSnapshot } from "@/lib/student-enrollment-archive-server";
import {
  buildDismissedHistoryAccess,
  isDismissalActionNote,
  isDismissalOpportunityLog,
  type DismissedHistoryAccess,
} from "@/lib/dismissed-history";
import {
  CALL_STUDENT_NOTE_CATEGORY,
  hasManualCallNote,
} from "@/lib/call-notes-filter";
import {
  sanitizeEnrollmentArchiveSnapshot,
  studentProfileSectionAccess,
} from "@/lib/student-profile-server";
import { DISMISSED_STUDENT_PLEDGE_NOTE_KIND } from "@/lib/dismissed-student-filters-server";

type TimelineEvent = {
  id: string;
  date: string;
  kind: string;
  title: string;
  details: string[];
  tone: "neutral" | "info" | "warning" | "danger" | "success";
};

type LooseRecord = Record<string, unknown>;

type HistorySummary = {
  opportunityEvents: number;
  gradeEvents: number;
  pendingAfterDismissal: number;
  notes: number;
  calls: number;
  leaves: number;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function record(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : {};
}

function records(value: unknown): LooseRecord[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as LooseRecord[]
    : [];
}

function sanitizeHistoryArchiveSnapshot(
  snapshot: LooseRecord,
  sectionAccess: ReturnType<typeof studentProfileSectionAccess>,
  historyAccess: DismissedHistoryAccess,
): LooseRecord {
  const sanitized = sanitizeEnrollmentArchiveSnapshot(snapshot, {
    ...sectionAccess,
    followUp: false,
  });
  if (historyAccess.calls) {
    sanitized.studentCalls = records(snapshot.studentCalls);
  }
  if (historyAccess.leaves) {
    sanitized.studentLeaves = records(snapshot.studentLeaves);
  }
  if (historyAccess.studentNotes) {
    const studentNotes = records(snapshot.studentNotes);
    sanitized.studentNotes = historyAccess.allStudentNotes
      ? studentNotes
      : studentNotes.filter(
          (note) => text(note.kind) === DISMISSED_STUDENT_PLEDGE_NOTE_KIND,
        );
  }
  return sanitized;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function iso(value: unknown): string {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  const raw = text(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function detailDate(value: unknown): string {
  if (value instanceof Date) return formatAppDate(value);
  const raw = text(value);
  return raw ? formatAppDate(raw) : "—";
}

function detailDateTime(value: unknown): string {
  if (value instanceof Date) return formatBaghdadDateTime(value);
  const raw = text(value);
  return raw ? formatBaghdadDateTime(raw) : "—";
}

function latestDismissalDate(
  opportunityLogs: LooseRecord[],
  notes: LooseRecord[],
): string {
  const candidates = [
    ...opportunityLogs
      .filter(isDismissalOpportunityLog)
      .map((item) => iso(item.date))
      .filter(Boolean),
    ...notes
      .filter(isDismissalActionNote)
      .map((item) => iso(item.dismissalDate) || iso(item.date))
      .filter(Boolean),
  ];
  return candidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
}

function gradeLabel(
  statusValue: unknown,
  scoreValue: unknown,
  fullMarkValue?: unknown,
): string {
  const status = text(statusValue);
  const score = nullableNumber(scoreValue);
  const fullMark = nullableNumber(fullMarkValue);
  if (status === "درجة") {
    return `الدرجة: ${score ?? "—"}${fullMark !== null ? ` / ${fullMark}` : ""}`;
  }
  return `الحالة: ${status || "غير محددة"}${score !== null ? ` · الدرجة: ${score}${fullMark !== null ? ` / ${fullMark}` : ""}` : ""}`;
}

function sourceCourseDetail(courseName: string): string {
  return courseName ? `الدورة: ${courseName}` : "";
}

function pushOpportunityEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  idPrefix: string,
) {
  for (const log of rows) {
    const dismissal = isDismissalOpportunityLog(log);
    const amount = integer(log.amount);
    const action = text(log.action);
    const reason = text(log.reason);
    const exam = record(log.exam);
    const chapter = record(log.chapter);
    const chapterName = text(log.chapterNameSnapshot) || text(chapter.name);
    const title = dismissal
      ? "فصل الطالب"
      : amount < 0
        ? `فقدان ${Math.abs(amount)} ${Math.abs(amount) === 1 ? "فرصة" : "فرص"}`
        : amount > 0
          ? `إضافة ${amount} ${amount === 1 ? "فرصة" : "فرص"}`
          : `حركة فرصة: ${action || "إجراء"}`;

    events.push({
      id: `${idPrefix}:opportunity:${text(log.id) || events.length}`,
      date: iso(log.date),
      kind: dismissal ? "dismissal" : "opportunity",
      title,
      details: [
        sourceCourseDetail(courseName),
        action ? `الإجراء المسجل: ${action}` : "",
        `التغيير في الرصيد: ${amount > 0 ? "+" : ""}${amount}`,
        reason ? `السبب: ${reason}` : "",
        chapterName ? `الفصل: ${chapterName}` : "",
        text(exam.name) ? `الامتحان: ${text(exam.name)}` : "",
        text(exam.date) || exam.date instanceof Date
          ? `تاريخ الامتحان: ${detailDate(exam.date)}`
          : "",
      ].filter(Boolean),
      tone: dismissal ? "danger" : amount < 0 ? "warning" : "info",
    });
  }
}

function pushGradeEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  dismissalAt: string,
  idPrefix: string,
) {
  const dismissalTime = Date.parse(dismissalAt || "") || 0;
  for (const grade of rows) {
    const exam = record(grade.exam);
    const createdAt = iso(grade.createdAt) || iso(grade.updatedAt);
    const updatedAt = iso(grade.updatedAt);
    const createdTime = Date.parse(createdAt || "") || 0;
    const updatedTime = Date.parse(updatedAt || "") || 0;
    const afterDismissal = Boolean(dismissalTime && createdTime >= dismissalTime);
    const wasUpdatedLater = Boolean(
      createdTime && updatedTime && updatedTime - createdTime > 60_000,
    );

    events.push({
      id: `${idPrefix}:grade:${text(grade.id) || events.length}`,
      date: createdAt,
      kind: afterDismissal ? "post-dismissal-grade" : "grade",
      title: afterDismissal ? "درجة مسجلة بعد الفصل" : "درجة امتحان",
      details: [
        sourceCourseDetail(courseName),
        `الامتحان: ${text(exam.name) || "غير مسمى"}`,
        text(exam.date) || exam.date instanceof Date
          ? `تاريخ الامتحان: ${detailDate(exam.date)}`
          : "",
        gradeLabel(grade.status, grade.score, exam.fullMark),
        text(grade.notes) ? `الملاحظات: ${text(grade.notes)}` : "",
        bool(grade.academicEffectExcluded)
          ? `الأثر الأكاديمي مستبعد${text(grade.academicEffectExclusionReason) ? `: ${text(grade.academicEffectExclusionReason)}` : ""}`
          : "",
        wasUpdatedLater ? `آخر تحديث للسجل: ${detailDateTime(updatedAt)}` : "",
      ].filter(Boolean),
      tone: afterDismissal ? "warning" : "neutral",
    });
  }
}

function pushSmartNoteEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  idPrefix: string,
) {
  for (const note of rows) {
    const exam = record(note.exam);
    const category = text(note.category);
    const status = text(note.status);
    const dismissedPending = category === "DISMISSED_PENDING";
    const fullMark = nullableNumber(exam.fullMark);
    const score = nullableNumber(note.score);
    events.push({
      id: `${idPrefix}:smart-grade:${text(note.id) || events.length}`,
      date: iso(note.attemptedAt) || iso(note.createdAt),
      kind: dismissedPending ? "pending-grade" : "grade-note",
      title: dismissedPending
        ? "درجة معلّقة بعد الفصل"
        : "ملاحظة درجة معلّقة/مراجعة",
      details: [
        sourceCourseDetail(courseName),
        `الامتحان: ${text(note.examNameSnapshot) || text(exam.name) || "غير مسمى"}`,
        score !== null
          ? `الدرجة المدخلة: ${score}${fullMark !== null ? ` / ${fullMark}` : ""}`
          : "",
        text(note.reason) ? `السبب: ${text(note.reason)}` : "",
        text(note.attemptedByName)
          ? `مدخل الدرجة: ${text(note.attemptedByName)}`
          : "",
        `حالة المراجعة: ${status || "غير محددة"}`,
        text(note.resolution) ? `القرار: ${text(note.resolution)}` : "",
        text(note.resolutionByName)
          ? `حسمها: ${text(note.resolutionByName)}`
          : "",
        text(note.resolvedAt)
          ? `وقت الحسم: ${detailDateTime(note.resolvedAt)}`
          : "",
      ].filter(Boolean),
      tone: dismissedPending && status === "PENDING" ? "danger" : "warning",
    });
  }
}

function pushLeaveEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  idPrefix: string,
) {
  for (const leave of rows) {
    const exam = record(leave.exam);
    events.push({
      id: `${idPrefix}:leave:${text(leave.id) || events.length}`,
      date: iso(leave.date) || iso(leave.createdAt),
      kind: "leave",
      title: "إجازة طالب",
      details: [
        sourceCourseDetail(courseName),
        `النوع: ${text(leave.leaveType) || "غير محدد"}`,
        text(leave.reason) ? `السبب: ${text(leave.reason)}` : "",
        text(exam.name) ? `الامتحان: ${text(exam.name)}` : "",
        text(leave.dateFrom) ? `من: ${detailDate(leave.dateFrom)}` : "",
        text(leave.dateTo) ? `إلى: ${detailDate(leave.dateTo)}` : "",
        text(leave.notes) ? `الملاحظات: ${text(leave.notes)}` : "",
      ].filter(Boolean),
      tone: "info",
    });
  }
}

function pushCallEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  idPrefix: string,
) {
  for (const call of rows) {
    if (text(call.category) === CALL_STUDENT_NOTE_CATEGORY) continue;
    const exam = record(call.exam);
    events.push({
      id: `${idPrefix}:call:${text(call.id) || events.length}`,
      date: iso(call.completedAt) || iso(call.createdAt),
      kind: "call",
      title: "متابعة اتصال",
      details: [
        sourceCourseDetail(courseName),
        text(call.category) ? `التصنيف: ${text(call.category)}` : "",
        text(call.target) ? `جهة الاتصال: ${text(call.target)}` : "",
        text(call.phone) ? `الرقم المستخدم: ${text(call.phone)}` : "",
        text(call.status) ? `حالة التواصل: ${text(call.status)}` : "",
        text(call.notes) ? `الملاحظات: ${text(call.notes)}` : "",
        text(exam.name) ? `الامتحان: ${text(exam.name)}` : "",
      ].filter(Boolean),
      tone: bool(call.completed) ? "success" : "neutral",
    });
  }
}

function isManualCallNote(call: LooseRecord): boolean {
  return hasManualCallNote({
    category: text(call.category),
    notes: text(call.notes),
  });
}

function pushManualCallNoteEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  idPrefix: string,
) {
  for (const note of rows.filter(isManualCallNote)) {
    events.push({
      id: `${idPrefix}:call-note:${text(note.id) || events.length}`,
      date: iso(note.createdAt),
      kind: "call-note",
      title: "ملاحظة متابعة",
      details: [sourceCourseDetail(courseName), text(note.notes)].filter(Boolean),
      tone: "neutral",
    });
  }
}

function pushStudentNoteEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  idPrefix: string,
) {
  for (const note of rows) {
    const kind = text(note.kind);
    events.push({
      id: `${idPrefix}:note:${text(note.id) || events.length}`,
      date: iso(note.date),
      kind: "note",
      title: kind ? `ملاحظة: ${kind}` : "ملاحظة طالب",
      details: [
        sourceCourseDetail(courseName),
        text(note.text),
        text(note.dismissalType)
          ? `نوع الفصل المرتبط: ${text(note.dismissalType)}`
          : "",
        text(note.dismissalReason)
          ? `سبب الفصل المرتبط: ${text(note.dismissalReason)}`
          : "",
      ].filter(Boolean),
      tone: kind === "تعهد ولي الأمر" ? "warning" : "neutral",
    });
  }
}

function pushCorrectionEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  idPrefix: string,
) {
  for (const sheet of rows) {
    const exam = record(sheet.exam);
    const corrector = record(sheet.corrector);
    events.push({
      id: `${idPrefix}:correction:${text(sheet.id) || events.length}`,
      date: iso(sheet.finishedAt) || iso(sheet.startedAt) || iso(exam.date),
      kind: "correction",
      title: "سجل تصحيح ورقة امتحان",
      details: [
        sourceCourseDetail(courseName),
        text(exam.name) ? `الامتحان: ${text(exam.name)}` : "",
        text(sheet.status) ? `حالة التصحيح: ${text(sheet.status)}` : "",
        text(corrector.name) ? `المصحح: ${text(corrector.name)}` : "",
        Number.isFinite(Number(sheet.correctionErrors))
          ? `أخطاء التصحيح: ${integer(sheet.correctionErrors)}`
          : "",
        Number.isFinite(Number(sheet.sumErrors))
          ? `أخطاء الجمع: ${integer(sheet.sumErrors)}`
          : "",
      ].filter(Boolean),
      tone: "neutral",
    });
  }
}

function pushTelegramSubmissionEvents(
  events: TimelineEvent[],
  rows: LooseRecord[],
  courseName: string,
  idPrefix: string,
) {
  for (const submission of rows) {
    const exam = record(submission.exam);
    events.push({
      id: `${idPrefix}:telegram-submission:${text(submission.id) || events.length}`,
      date: iso(submission.submittedAt) || iso(submission.receivedAt),
      kind: "telegram-submission",
      title: "استلام أوراق امتحان عبر تيليجرام",
      details: [
        sourceCourseDetail(courseName),
        text(exam.name) ? `الامتحان: ${text(exam.name)}` : "",
        text(submission.status) ? `الحالة: ${text(submission.status)}` : "",
        integer(submission.pageCount) > 0
          ? `عدد الصفحات: ${integer(submission.pageCount)}`
          : "",
        text(submission.matchType) ? `نوع المطابقة: ${text(submission.matchType)}` : "",
        text(submission.notes) ? `الملاحظات: ${text(submission.notes)}` : "",
      ].filter(Boolean),
      tone: "info",
    });
  }
}

function countPendingDismissedNotes(rows: LooseRecord[]): number {
  return rows.filter(
    (note) =>
      text(note.category) === "DISMISSED_PENDING" && text(note.status) === "PENDING",
  ).length;
}

function withoutDuplicatedDismissalActionNotes(
  notes: LooseRecord[],
  opportunityLogs: LooseRecord[],
): LooseRecord[] {
  const dismissalTimes = opportunityLogs
    .filter(isDismissalOpportunityLog)
    .map((log) => Date.parse(iso(log.date)))
    .filter(Number.isFinite);
  if (dismissalTimes.length === 0) return notes;

  return notes.filter((note) => {
    if (!isDismissalActionNote(note)) return true;
    const noteTime = Date.parse(iso(note.dismissalDate) || iso(note.date));
    if (!Number.isFinite(noteTime)) return true;
    return !dismissalTimes.some(
      (dismissalTime) => Math.abs(dismissalTime - noteTime) <= 60_000,
    );
  });
}

export async function GET(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(
    req,
    "students.view",
  );
  if (principalOrError instanceof NextResponse) return principalOrError;
  const access = studentProfileSectionAccess(principalOrError);
  const historyAccess = buildDismissedHistoryAccess({
    isAdmin: principalOrError.isAdmin,
    permissions: principalOrError.permissions,
    baseAccess: {
      grades: access.grades,
      opportunities: access.opportunities,
      correction: access.correction,
      archives: access.archives,
    },
  });

  try {
    const studentId = text(new URL(req.url).searchParams.get("studentId"));
    if (!studentId) {
      return NextResponse.json({ error: "معرف الطالب مطلوب." }, { status: 400 });
    }

    const historySnapshot = await db.$transaction(
      async (tx) => {
        const student = await tx.student.findFirst({
          where: { id: studentId, status: "مفصول" },
          select: {
            id: true,
            name: true,
            code: true,
            school: true,
            gender: true,
            phone: true,
            parentPhone: true,
            telegram: true,
            courseId: true,
            courseProgram: true,
            courseTerm: true,
            studyType: true,
            locationScope: true,
            mainSite: true,
            subSite: true,
            status: true,
            dismissalType: true,
            dismissalReason: true,
            dismissalNotes: true,
            opportunities: true,
            baseOpportunities: true,
            createdAt: true,
            course: { select: { id: true, name: true } },
          },
        });
        if (!student) return null;

        const [
          opportunityLogs,
          grades,
          smartNotes,
          leaves,
          calls,
          notes,
          corrections,
          telegramSubmissions,
          archives,
        ] = await Promise.all([
          access.opportunities
            ? tx.opportunityLog.findMany({
                where: { studentId },
                select: {
                  id: true,
                  action: true,
                  amount: true,
                  reason: true,
                  date: true,
                  chapterNameSnapshot: true,
                  exam: { select: { name: true, date: true } },
                  chapter: { select: { name: true } },
                },
                orderBy: [{ date: "asc" }, { id: "asc" }],
              })
            : Promise.resolve([]),
          access.grades
            ? tx.grade.findMany({
                where: { studentId },
                select: {
                  id: true,
                  status: true,
                  score: true,
                  notes: true,
                  academicEffectExcluded: true,
                  academicEffectExclusionReason: true,
                  createdAt: true,
                  updatedAt: true,
                  exam: {
                    select: { name: true, date: true, fullMark: true },
                  },
                },
                orderBy: [
                  { createdAt: "asc" },
                  { updatedAt: "asc" },
                  { id: "asc" },
                ],
              })
            : Promise.resolve([]),
          access.grades
            ? tx.gradeSmartNote.findMany({
                where: { studentId },
                select: {
                  id: true,
                  category: true,
                  status: true,
                  examNameSnapshot: true,
                  score: true,
                  reason: true,
                  attemptedByName: true,
                  attemptedAt: true,
                  resolution: true,
                  resolutionByName: true,
                  resolvedAt: true,
                  createdAt: true,
                  exam: {
                    select: { name: true, date: true, fullMark: true },
                  },
                },
                orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
              })
            : Promise.resolve([]),
          historyAccess.leaves
            ? tx.studentLeave.findMany({
                where: { studentId },
                select: {
                  id: true,
                  leaveType: true,
                  reason: true,
                  date: true,
                  dateFrom: true,
                  dateTo: true,
                  notes: true,
                  createdAt: true,
                  exam: { select: { name: true } },
                },
                orderBy: [
                  { date: "asc" },
                  { createdAt: "asc" },
                  { id: "asc" },
                ],
              })
            : Promise.resolve([]),
          historyAccess.calls
            ? tx.studentCall.findMany({
                where: { studentId },
                select: {
                  id: true,
                  category: true,
                  target: true,
                  phone: true,
                  status: true,
                  completed: true,
                  completedAt: true,
                  notes: true,
                  createdAt: true,
                  exam: { select: { name: true } },
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              })
            : Promise.resolve([]),
          historyAccess.studentNotes
            ? tx.studentNote.findMany({
                where: {
                  studentId,
                  ...(historyAccess.allStudentNotes
                    ? {}
                    : { kind: DISMISSED_STUDENT_PLEDGE_NOTE_KIND }),
                },
                select: {
                  id: true,
                  kind: true,
                  text: true,
                  date: true,
                  dismissalType: true,
                  dismissalReason: true,
                  dismissalDate: true,
                },
                orderBy: [{ date: "asc" }, { id: "asc" }],
              })
            : Promise.resolve([]),
          access.correction
            ? tx.correctionSheet.findMany({
                where: { studentId },
                select: {
                  id: true,
                  status: true,
                  startedAt: true,
                  finishedAt: true,
                  correctionErrors: true,
                  sumErrors: true,
                  exam: { select: { name: true, date: true } },
                  corrector: { select: { name: true } },
                },
                orderBy: { id: "asc" },
              })
            : Promise.resolve([]),
          access.correction
            ? tx.telegramExamSubmission.findMany({
                where: { studentId },
                select: {
                  id: true,
                  status: true,
                  matchType: true,
                  pageCount: true,
                  notes: true,
                  submittedAt: true,
                  receivedAt: true,
                  exam: { select: { name: true } },
                },
                orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
              })
            : Promise.resolve([]),
          access.archives
            ? tx.studentEnrollmentArchive.findMany({
                where: { studentId },
                select: {
                  id: true,
                  fromCourseName: true,
                  toCourseName: true,
                  resetKind: true,
                  reason: true,
                  snapshot: true,
                  createdByName: true,
                  createdAt: true,
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              })
            : Promise.resolve([]),
        ]);

        return {
          student,
          opportunityLogs,
          grades,
          smartNotes,
          leaves,
          calls,
          notes,
          corrections,
          telegramSubmissions,
          archives,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );

    if (!historySnapshot) {
      return NextResponse.json(
        { error: "الطالب غير موجود ضمن المفصولين حالياً." },
        { status: 404 },
      );
    }

    const {
      student,
      opportunityLogs,
      grades,
      smartNotes,
      leaves,
      calls,
      notes,
      corrections,
      telegramSubmissions,
      archives,
    } = historySnapshot;

    const liveOpportunityLogs = opportunityLogs as unknown as LooseRecord[];
    const liveGrades = grades as unknown as LooseRecord[];
    const liveSmartNotes = smartNotes as unknown as LooseRecord[];
    const liveLeaves = leaves as unknown as LooseRecord[];
    const liveCalls = calls as unknown as LooseRecord[];
    const liveNotes = notes as unknown as LooseRecord[];
    const liveCorrections = corrections as unknown as LooseRecord[];
    const liveTelegramSubmissions = telegramSubmissions as unknown as LooseRecord[];

    const currentDismissalAt = latestDismissalDate(
      liveOpportunityLogs,
      liveNotes,
    );

    const parsedArchives = archives.map((archive) => ({
      archive,
      snapshot: sanitizeHistoryArchiveSnapshot(
        parseStudentEnrollmentArchiveSnapshot(archive.snapshot),
        access,
        historyAccess,
      ),
    }));

    const firstArchiveStudent = parsedArchives.length
      ? record(parsedArchives[0].snapshot.student)
      : {};
    const registrationAt = iso(firstArchiveStudent.createdAt) || iso(student.createdAt);
    const firstCourseName = parsedArchives[0]?.archive.fromCourseName || student.course.name;

    const events: TimelineEvent[] = [
      {
        id: `registration:${student.id}`,
        date: registrationAt,
        kind: "registration",
        title: "تسجيل الطالب في النظام",
        details: [
          `الدورة الأولى: ${firstCourseName}`,
          `الكود: ${student.code}`,
          text(firstArchiveStudent.courseProgram || student.courseProgram)
            ? `نوع الاشتراك: ${text(firstArchiveStudent.courseProgram || student.courseProgram)}`
            : "",
          text(firstArchiveStudent.studyType || student.studyType)
            ? `نوع البرنامج: ${text(firstArchiveStudent.studyType || student.studyType)}`
            : "",
        ].filter(Boolean),
        tone: "success",
      },
    ];

    const summary: HistorySummary = {
      opportunityEvents: liveOpportunityLogs.length,
      gradeEvents: liveGrades.length,
      pendingAfterDismissal: countPendingDismissedNotes(liveSmartNotes),
      notes: liveNotes.length + liveCalls.filter(isManualCallNote).length,
      calls: liveCalls.filter(
        (call) => text(call.category) !== CALL_STUDENT_NOTE_CATEGORY,
      ).length,
      leaves: liveLeaves.length,
    };

    for (const { archive, snapshot } of parsedArchives) {
      const prefix = `archive:${archive.id}`;
      const archivedOpportunityLogs = records(snapshot.opportunityLogs);
      const archivedGrades = records(snapshot.grades);
      const archivedSmartNotes = records(snapshot.gradeSmartNotes);
      const archivedLeaves = records(snapshot.studentLeaves);
      const archivedCalls = records(snapshot.studentCalls);
      const archivedNotes = records(snapshot.studentNotes);
      const archivedCorrections = records(snapshot.correctionSheets);
      const archivedTelegramSubmissions = records(snapshot.telegramExamSubmissions);
      const archivedTimelineNotes = withoutDuplicatedDismissalActionNotes(
        archivedNotes,
        archivedOpportunityLogs,
      );
      const archivedDismissalAt = latestDismissalDate(
        archivedOpportunityLogs,
        archivedNotes,
      );
      const courseName = archive.fromCourseName || text(record(snapshot.fromCourse).name);

      summary.opportunityEvents += archivedOpportunityLogs.length;
      summary.gradeEvents += archivedGrades.length;
      summary.pendingAfterDismissal += countPendingDismissedNotes(archivedSmartNotes);
      summary.notes +=
        archivedNotes.length + archivedCalls.filter(isManualCallNote).length;
      summary.calls += archivedCalls.filter(
        (call) => text(call.category) !== CALL_STUDENT_NOTE_CATEGORY,
      ).length;
      summary.leaves += archivedLeaves.length;

      pushOpportunityEvents(events, archivedOpportunityLogs, courseName, prefix);
      pushGradeEvents(events, archivedGrades, courseName, archivedDismissalAt, prefix);
      pushSmartNoteEvents(events, archivedSmartNotes, courseName, prefix);
      pushLeaveEvents(events, archivedLeaves, courseName, prefix);
      pushCallEvents(events, archivedCalls, courseName, prefix);
      pushManualCallNoteEvents(events, archivedCalls, courseName, prefix);
      pushStudentNoteEvents(events, archivedTimelineNotes, courseName, prefix);
      pushCorrectionEvents(events, archivedCorrections, courseName, prefix);
      pushTelegramSubmissionEvents(
        events,
        archivedTelegramSubmissions,
        courseName,
        prefix,
      );

      events.push({
        id: `${prefix}:transition`,
        date: iso(archive.createdAt),
        kind: "enrollment",
        title:
          archive.resetKind === "course-transfer"
            ? "نقل الطالب إلى دورة جديدة"
            : "بدء تسجيل جديد للطالب",
        details: [
          archive.fromCourseName ? `من: ${archive.fromCourseName}` : "",
          archive.toCourseName ? `إلى: ${archive.toCourseName}` : "",
          archive.reason ? `السبب: ${archive.reason}` : "",
          archive.createdByName ? `بواسطة: ${archive.createdByName}` : "",
        ].filter(Boolean),
        tone: "info",
      });
    }

    const currentCourseName = student.course.name;
    pushOpportunityEvents(
      events,
      liveOpportunityLogs,
      currentCourseName,
      "current",
    );
    pushGradeEvents(
      events,
      liveGrades,
      currentCourseName,
      currentDismissalAt,
      "current",
    );
    pushSmartNoteEvents(
      events,
      liveSmartNotes,
      currentCourseName,
      "current",
    );
    pushLeaveEvents(events, liveLeaves, currentCourseName, "current");
    pushCallEvents(events, liveCalls, currentCourseName, "current");
    pushManualCallNoteEvents(events, liveCalls, currentCourseName, "current");
    pushStudentNoteEvents(
      events,
      withoutDuplicatedDismissalActionNotes(
        liveNotes,
        liveOpportunityLogs,
      ),
      currentCourseName,
      "current",
    );
    pushCorrectionEvents(
      events,
      liveCorrections,
      currentCourseName,
      "current",
    );
    pushTelegramSubmissionEvents(
      events,
      liveTelegramSubmissions,
      currentCourseName,
      "current",
    );

    if (
      !liveOpportunityLogs.some(isDismissalOpportunityLog) &&
      !liveNotes.some(isDismissalActionNote)
    ) {
      events.push({
        id: `current:dismissal-state:${student.id}`,
        date: currentDismissalAt,
        kind: "dismissal",
        title: "حالة الفصل الحالية",
        details: [
          sourceCourseDetail(currentCourseName),
          student.dismissalType ? `نوع الفصل: ${student.dismissalType}` : "",
          student.dismissalReason
            ? `السبب: ${student.dismissalReason}`
            : "لا يوجد سبب فصل مسجل",
          student.dismissalNotes
            ? `الملاحظات: ${student.dismissalNotes}`
            : "",
        ].filter(Boolean),
        tone: "danger",
      });
    }

    events.sort((a, b) => {
      const ad = a.date ? Date.parse(a.date) || Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const bd = b.date ? Date.parse(b.date) || Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return a.id.localeCompare(b.id);
    });

    return NextResponse.json({
      source: "database",
      student: {
        id: student.id,
        name: student.name,
        code: student.code,
        school: student.school,
        gender: student.gender,
        phone: student.phone || "",
        parentPhone: student.parentPhone || "",
        telegram: student.telegram || "",
        courseId: student.courseId,
        courseName: student.course.name,
        courseProgram: student.courseProgram || "",
        courseTerm: student.courseTerm || "",
        studyType: student.studyType || "",
        locationScope: student.locationScope || "",
        mainSite: student.mainSite || "",
        subSite: student.subSite || "",
        status: student.status,
        dismissalType: student.dismissalType || "",
        dismissalReason: student.dismissalReason || "",
        dismissalNotes: student.dismissalNotes || "",
        opportunities: student.opportunities,
        baseOpportunities: student.baseOpportunities,
        createdAt: registrationAt,
        dismissalAt: currentDismissalAt,
      },
      summary,
      events,
      sections: {
        opportunities: access.opportunities,
        grades: access.grades,
        followUp:
          historyAccess.calls ||
          historyAccess.leaves ||
          historyAccess.studentNotes,
        calls: historyAccess.calls,
        leaves: historyAccess.leaves,
        notes: historyAccess.studentNotes || historyAccess.calls,
        correction: access.correction,
        archives: access.archives,
      },
      generatedAt: new Date().toISOString(),
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل السجل الكامل للطالب المفصول.",
    );
  }
}
