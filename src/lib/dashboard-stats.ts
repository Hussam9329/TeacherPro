import {
  hasStudentLeaveForExam,
  isExamBeforeStudentRegistration,
  isExamWithinStudentGracePeriodUnified,
  isGradeEnteredUnified,
  type ExamLike,
  type GradeLike,
  type StudentGraceLike,
  type StudentLeaveLike,
} from "@/lib/grade-classification";
import { getExamEntryAvailability } from "@/lib/exam-utils";
import {
  formatAuditLogDisplay,
  type AuditLogEntityLabels,
} from "@/lib/audit-log-display";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";
import { baghdadDateKey } from "@/lib/baghdad-time";

export type DashboardExamLike = ExamLike & {
  active: boolean;
  fullMark: number;
};

export function isDashboardGradeMissing(input: {
  grade?: GradeLike | null;
  exam: DashboardExamLike;
  student: StudentGraceLike;
  leaves?: StudentLeaveLike[];
  now?: Date;
}): boolean {
  const { grade, exam, student, leaves = [], now = new Date() } = input;
  if (!getExamEntryAvailability(exam, now).available) return false;
  if (isExamBeforeStudentRegistration(student, exam)) return false;
  if (isExamWithinStudentGracePeriodUnified(student, exam)) return false;
  if (hasStudentLeaveForExam(leaves, exam)) return false;
  return !isGradeEnteredUnified(grade, exam);
}

export function getActiveChapterHealth(
  links: Array<{ courseId: string; active?: boolean; archived?: boolean }>,
): {
  healthyCourseIds: Set<string>;
  conflictCourseIds: Set<string>;
  activeLinkCountByCourse: Map<string, number>;
} {
  const activeLinkCountByCourse = new Map<string, number>();
  for (const link of links) {
    if (link.active === false || link.archived === true) continue;
    activeLinkCountByCourse.set(
      link.courseId,
      (activeLinkCountByCourse.get(link.courseId) || 0) + 1,
    );
  }

  const healthyCourseIds = new Set<string>();
  const conflictCourseIds = new Set<string>();
  for (const [courseId, count] of activeLinkCountByCourse) {
    if (count === 1) healthyCourseIds.add(courseId);
    if (count > 1) conflictCourseIds.add(courseId);
  }
  return { healthyCourseIds, conflictCourseIds, activeLinkCountByCourse };
}

export type DashboardDismissalInfo = {
  key: string;
  sourceType: string;
  sourceId: string;
  type: string;
  reason: string;
  date: string;
};

export type DashboardDismissedStudent = {
  id: string;
  status: string;
  dismissalType?: string | null;
  dismissalReason?: string | null;
  createdAt: Date | string;
};

export type DashboardDismissalLog = {
  id: string;
  action: string;
  reason?: string | null;
  date: Date | string;
};

export type DashboardDismissalActionNote = {
  id: string;
  kind: string;
  text: string;
  date: Date | string;
};

export type DashboardPledgeNote = {
  text?: string | null;
  date?: Date | string | null;
  dismissalKey?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  dismissalType?: string | null;
  dismissalReason?: string | null;
  dismissalDate?: Date | string | null;
};

function normalizeDismissalText(value: unknown): string {
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
}): string {
  return [
    parts.studentId,
    parts.sourceType,
    parts.sourceId,
    normalizeDismissalText(parts.type),
    normalizeDismissalText(parts.reason),
    baghdadDateKey(parts.date),
  ].join("::");
}

function isLikelyDismissalLog(
  log: DashboardDismissalLog,
  dismissalReason: string,
): boolean {
  const rawReason = String(log.reason || "");
  const logReason = normalizeDismissalText(rawReason);
  const normalizedReason = normalizeDismissalText(dismissalReason);
  return (
    log.action === "فصل تلقائي" ||
    (log.action === "خصم" && rawReason.startsWith("فصل الطالب")) ||
    Boolean(normalizedReason && logReason.includes(normalizedReason))
  );
}

function timestamp(value: Date | string | null | undefined): number {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
}

export function buildCurrentDismissalInfo(
  student: DashboardDismissedStudent,
  logs: DashboardDismissalLog[],
  actionNotes: DashboardDismissalActionNote[],
): DashboardDismissalInfo | null {
  if (student.status !== "مفصول") return null;
  const type = student.dismissalType || "فصل";
  const reason = student.dismissalReason || type || "طالب مفصول";
  const normalizedReason = normalizeDismissalText(reason);

  const sourceLog = logs
    .filter((log) => isLikelyDismissalLog(log, reason))
    .sort((left, right) => timestamp(right.date) - timestamp(left.date))[0] ||
    null;

  const sourceNote = sourceLog
    ? null
    : actionNotes
        .filter((note) => note.kind === "إجراء")
        .filter((note) => {
          const noteText = normalizeDismissalText(note.text);
          return (
            note.text.includes("فصل الطالب") ||
            Boolean(normalizedReason && noteText.includes(normalizedReason))
          );
        })
        .sort((left, right) => timestamp(right.date) - timestamp(left.date))[0] ||
      null;

  const sourceType = sourceLog
    ? "opportunity-log"
    : sourceNote
      ? "student-note"
      : "student-dismissal";
  const sourceId = sourceLog?.id || sourceNote?.id || student.id;
  const date = baghdadDateKey(sourceLog?.date || sourceNote?.date || student.createdAt);
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
  };
}

/**
 * A pledge belongs to the current dismissal only when it carries the current
 * immutable key/source. Legacy rows are accepted only with matching dismissal
 * metadata and date; an old generic pledge never hides a newer dismissal.
 */
export function pledgeMatchesCurrentDismissal(
  note: DashboardPledgeNote,
  current: DashboardDismissalInfo,
): boolean {
  const noteKey = String(note.dismissalKey || "").trim();
  if (noteKey) return noteKey === current.key;

  const sourceType = String(note.sourceType || "").trim();
  const sourceId = String(note.sourceId || "").trim();
  if (sourceType || sourceId) {
    return sourceType === current.sourceType && sourceId === current.sourceId;
  }

  const dismissalDate = baghdadDateKey(note.dismissalDate || note.date);
  if (!dismissalDate || dismissalDate !== current.date) return false;

  const noteType = normalizeDismissalText(note.dismissalType);
  const currentType = normalizeDismissalText(current.type);
  const typeMatches =
    !noteType ||
    noteType.includes(currentType) ||
    currentType.includes(noteType);
  if (!typeMatches) return false;

  const noteReason = normalizeDismissalText(
    note.dismissalReason || note.text,
  );
  const currentReason = normalizeDismissalText(current.reason);
  const reasonMatches =
    !noteReason ||
    noteReason.includes(currentReason) ||
    currentReason.includes(noteReason);
  if (!reasonMatches) return false;
  return Boolean(noteType || noteReason);
}

const MODULE_LABELS: Record<string, string> = {
  auth: "تسجيل الدخول",
  authentication: "تسجيل الدخول",
  students: "سجل الطلاب",
  student: "سجل الطلاب",
  "student-registry": "سجل الطلاب",
  courses: "الدورات",
  chapters: "الفصول والفرص",
  exams: "الامتحانات",
  grades: "الدرجات",
  opportunities: "إدارة الفرص",
  "follow-up": "المتابعة",
  correction: "التصحيح الإلكتروني",
  accounts: "الحسابات والصلاحيات",
  backup: "النسخ الاحتياطي",
  logs: "سجل العمليات",
  dashboard: "لوحة النظام",
  system: "النظام",
};

const ACTION_LABELS: Record<string, string> = {
  create: "إضافة سجل",
  add: "إضافة سجل",
  update: "تعديل سجل",
  edit: "تعديل سجل",
  delete: "حذف سجل",
  remove: "حذف سجل",
  save: "حفظ البيانات",
  login: "تسجيل الدخول",
  logout: "تسجيل الخروج",
  import: "استيراد البيانات",
  export: "تصدير البيانات",
  recalculate: "إعادة احتساب أكاديمي",
  repair: "إصلاح بيانات النظام",
  dismiss: "فصل طالب",
  reactivate: "إعادة تفعيل طالب",
};

function readableAuditLabel(value: unknown, kind: "module" | "action"): string {
  const raw = String(value || "").trim();
  const key = raw.toLowerCase().replace(/[\s_]+/g, "-");
  const mapped = kind === "module" ? MODULE_LABELS[key] : ACTION_LABELS[key];
  if (mapped) return mapped;
  const humanized = humanizeTeacherProText(raw.replace(/[_-]+/g, " "));
  if (/[\u0600-\u06ff]/u.test(humanized)) return humanized;
  return kind === "module" ? "النظام" : "إجراء في النظام";
}

function readableAuditSummary(value: unknown): string {
  const humanized = humanizeTeacherProText(String(value || "").trim());
  if (!humanized || /[{}\[\]"]/.test(humanized)) {
    return "تم تنفيذ العملية بنجاح.";
  }
  return humanized.replace(
    /\b(?:c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27,})\b/gi,
    "السجل المحدد",
  );
}

export function sanitizeDashboardAuditLog(
  log: {
    id: string;
    module?: string | null;
    action?: string | null;
    details?: string | null;
    userName?: string | null;
    time: Date | string;
  },
  entityLabels: AuditLogEntityLabels = {},
) {
  const display = formatAuditLogDisplay(log, entityLabels);
  return {
    id: log.id,
    module: readableAuditLabel(log.module, "module"),
    action: readableAuditLabel(log.action, "action"),
    summary: readableAuditSummary(display.summary),
    userName: log.userName || "النظام",
    time: log.time,
  };
}
