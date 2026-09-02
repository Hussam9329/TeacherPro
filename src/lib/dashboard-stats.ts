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
