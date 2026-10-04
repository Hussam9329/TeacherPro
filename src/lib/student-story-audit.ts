/**
 * What the student story needs from the audit log: who did each manual action,
 * and the few events only the audit log records (code closing, telegram
 * notice, data edits). Pure: the route passes rows already matched to the
 * student; anything that cannot be tied to this student is ignored.
 */
export type StoryAuditRow = {
  id: string;
  module?: string | null;
  action?: string | null;
  details?: string | null;
  time?: string | Date | null;
  userName?: string | null;
};

export type StoryAuditEventKind =
  | "registered"
  | "edited"
  | "transferred"
  | "restarted"
  | "code-closed"
  | "code-reopened"
  | "telegram-notice"
  | "dismissal-notes"
  | "manual-dismissal"
  | "pledge-return"
  | "manual-return"
  | "archived"
  | "restored-archive";

export type StoryAuditEvent = {
  id: string;
  at: string;
  by: string;
  kind: StoryAuditEventKind;
  /** Field changes in «الحقل: قبل ← بعد» form, for data edits. */
  changes?: string[];
  /** The free-text tail the action carries (a reason, a course, a note). */
  text?: string;
};

export type StoryAuditFacts = {
  leaveActors: Record<string, string>;
  callNoteActors: Record<string, string>;
  opportunityLogActors: Record<string, string>;
  events: StoryAuditEvent[];
};

/** The marker a student edit appends to its audit details. */
export const STUDENT_EDIT_CHANGES_MARKER = " | التغييرات: ";
export const STUDENT_EDIT_CHANGE_SEPARATOR = "؛ ";

function iso(value: StoryAuditRow["time"]): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function json(details: string | null | undefined): Record<string, unknown> | null {
  const text = String(details || "").trim();
  if (!text.startsWith("{")) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** «الاسم - الكود - الباقي»: the tail after the student's name and code. */
function textTail(details: string, code: string): string {
  const marker = ` - ${code}`;
  const index = details.indexOf(marker);
  if (index < 0) return "";
  return details.slice(index + marker.length).replace(/^\s*[-|]\s*/, "").trim();
}

export function buildStoryAuditFacts(
  rows: StoryAuditRow[],
  student: { id: string; code: string },
): StoryAuditFacts {
  const facts: StoryAuditFacts = { leaveActors: {}, callNoteActors: {}, opportunityLogActors: {}, events: [] };
  const ordered = [...rows].sort((a, b) => iso(a.time).localeCompare(iso(b.time)) || String(a.id).localeCompare(String(b.id)));
  for (const row of ordered) {
    const action = str(row.action);
    const by = str(row.userName);
    const at = iso(row.time);
    const details = String(row.details || "");
    const data = json(details);
    const ownStudent = data ? str(data.studentId) === student.id : true;
    const push = (kind: StoryAuditEventKind, extra: Partial<StoryAuditEvent> = {}) => {
      if (at) facts.events.push({ id: row.id, at, by, kind, ...extra });
    };

    if (data && !ownStudent && !(data.after && typeof data.after === "object")) continue;

    if (/^تسجيل إجازة/u.test(action) && data && ownStudent) {
      const leaveId = str(data.leaveId);
      if (leaveId && by && !facts.leaveActors[leaveId]) facts.leaveActors[leaveId] = by;
      continue;
    }
    if (data && str(data.source) === "call-note-management") {
      const after = (data.after || data.before) as Record<string, unknown> | null;
      if (!after || str(after.studentId) !== student.id) continue;
      const callId = str(after.id);
      if (callId && by && (!facts.callNoteActors[callId] || /إضافة/u.test(action))) facts.callNoteActors[callId] = by;
      continue;
    }
    if (data && ownStudent && (str(data.actionType) === "add" || str(data.actionType) === "deduct")) {
      const logId = str(data.createdLogId) || str(data.logId);
      if (logId && by) facts.opportunityLogActors[logId] = by;
      continue;
    }
    if (action === "تسجيل طالب") {
      push("registered", { text: textTail(details, student.code) });
      continue;
    }
    if (
      action === "تعديل بيانات طالب" ||
      action === "تعديل إعدادات الطالب مع إبقاء الملف" ||
      action === "نقل طالب وبدء ملف جديد" ||
      action === "إعادة بدء الطالب داخل الدورة"
    ) {
      const markerIndex = details.indexOf(STUDENT_EDIT_CHANGES_MARKER);
      const changes = markerIndex >= 0
        ? details.slice(markerIndex + STUDENT_EDIT_CHANGES_MARKER.length).split(STUDENT_EDIT_CHANGE_SEPARATOR).map((item) => item.trim()).filter(Boolean)
        : [];
      const kind: StoryAuditEventKind = action === "نقل طالب وبدء ملف جديد"
        ? "transferred"
        : action === "إعادة بدء الطالب داخل الدورة" ? "restarted" : "edited";
      push(kind, { changes });
      continue;
    }
    if (action === "اغلاق كود الطالب المفصول" && ownStudent) { push("code-closed"); continue; }
    if (action === "إلغاء اغلاق كود الطالب المفصول" && ownStudent) { push("code-reopened"); continue; }
    if (action === "فتح تبليغ الفصل في تليكرام" && ownStudent) { push("telegram-notice"); continue; }
    if (action === "تعديل ملاحظات الفصل" && data && ownStudent) {
      const after = data.after as Record<string, unknown> | undefined;
      push("dismissal-notes", { text: str(after?.dismissalNotes) });
      continue;
    }
    if (action === "فصل الطالب") { push("manual-dismissal", { text: textTail(details, student.code) }); continue; }
    if (action === "تم تعهد الطالب - إعادة تفعيل بفرصتين") { push("pledge-return"); continue; }
    if (action === "استعادة الطالب المفصول يدوياً") {
      const reason = /السبب:\s*(.+)$/u.exec(details)?.[1]?.trim() || "";
      push("manual-return", { text: reason });
      continue;
    }
    if (action === "أرشفة طالب بدل الحذف") { push("archived"); continue; }
    if (action === "استعادة طالب من الأرشيف") { push("restored-archive"); continue; }
  }
  return facts;
}

/** The modules whose rows can carry a story fact. Grade saves are excluded:
 * the story reads grades from the grades themselves. */
export const STORY_AUDIT_MODULES = [
  "تسجيل الطلاب",
  "سجل الطلاب",
  "المتابعة",
  "المكالمات",
  "إدارة الفرص",
  "إدارة المفصولين",
] as const;
