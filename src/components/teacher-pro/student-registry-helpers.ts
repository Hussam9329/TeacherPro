import type { Student } from "@/lib/teacher-store";
import type { StudentDeleteImpactResponse } from "@/lib/api";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import {
  formatAppDate,
  sanitizePhoneInput,
  toLatinDigits,
} from "@/lib/format";
import {
  GRACE_PERIOD_EXCUSE_LABEL,
  findStudentGracePeriod,
  formatGraceDate,
  gracePeriodState,
  type GracePeriodRange,
} from "@/lib/grace-periods";
import {
  normalizeTelegramIdentifier,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import { searchAny } from "@/lib/validation";
import type { ExportColumn } from "./export-dialog";

export type RegistryViewMode = "cards" | "table";
export const ARCHIVED_STUDENT_STATUS = "مؤرشف";
export const STUDENT_REGISTRY_STATE_KEY =
  "teacherpro:student-registry-state:v1";

export function getStudentRegistryCapabilities(user?: {
  username?: string | null;
  roleId?: string | null;
  permissions?: string[] | null;
} | null) {
  const isAdmin = Boolean(
    user?.username?.trim().toLowerCase() === "admin" ||
      user?.roleId === "role_admin",
  );
  const permissions = new Set(user?.permissions || []);
  return {
    isAdmin,
    canAddStudents: isAdmin || permissions.has("students.add"),
    canEditStudents: isAdmin || permissions.has("students.edit"),
    canArchiveStudents: isAdmin || permissions.has("students.delete"),
  };
}

export function reconcileRegistryRowsAfterMutation(
  rows: readonly Student[],
  updatedStudent: Student,
  shouldRemain: boolean,
) {
  const existed = rows.some((student) => student.id === updatedStudent.id);
  const nextRows = shouldRemain
    ? existed
      ? rows.map((student) =>
          student.id === updatedStudent.id ? updatedStudent : student,
        )
      : [updatedStudent, ...rows]
    : rows.filter((student) => student.id !== updatedStudent.id);
  return {
    rows: nextRows,
    totalDelta: shouldRemain ? (existed ? 0 : 1) : existed ? -1 : 0,
  };
}

export const studentExportColumns: ExportColumn<any>[] = [
  {
    key: "sequence",
    label: "ت",
    value: (_student, index) => Number(index ?? 0) + 1,
    locked: true,
  },
  { key: "code", label: "الكود", value: (student) => student.code || "" },
  { key: "name", label: "الاسم", value: (student) => student.name || "" },
  { key: "school", label: "المدرسة", value: (student) => student.school || "" },
  { key: "gender", label: "الجنس", value: (student) => student.gender || "" },
  { key: "course", label: "الدورة", value: (student) => student.courseName || "" },
  { key: "courseProgram", label: "نوع الدورة", value: (student) => student.courseProgram || "" },
  { key: "courseTerm", label: "الكورس", value: (student) => student.courseTerm || "" },
  { key: "studyType", label: "نوع البرنامج", value: (student) => student.studyType || "" },
  { key: "locationScope", label: "نطاق الموقع", value: (student) => student.locationScope || "" },
  { key: "location", label: "الموقع", value: (student) => student.locationText || "" },
  { key: "status", label: "الحالة", value: (student) => student.status || "" },
  { key: "dismissalReason", label: "سبب الفصل", value: (student) => student.dismissalReason || "", defaultSelected: false },
  { key: "opportunities", label: "الفرص", value: (student) => student.opportunities ?? "" },
  { key: "grace", label: "فترة السماح", value: (student) => formatStudentCurrentGrace(student) },
  { key: "createdAt", label: "تاريخ التسجيل", value: (student) => formatAppDate(student.createdAt) },
  { key: "phone", label: "الهاتف", value: (student) => student.phone || "" },
  { key: "parentPhone", label: "ولي الأمر", value: (student) => student.parentPhone || "" },
  { key: "telegram", label: "التيليجرام", value: (student) => student.telegram || "" },
];

export function academicImpactKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    missing: "غير مكتملة",
    excused: "إجازة",
    "grace-period": GRACE_PERIOD_EXCUSE_LABEL,
    "before-registration": "قبل التسجيل",
    "unavailable-exam": "امتحان غير متاح",
    cheating: "غش",
    "absent-dismissal": "غياب فصل",
    "absent-deducted": "غياب مخصوم",
    discounted: "درجة مخصومة",
    "academic-accounting": "راسب غير مخصوم",
    dismissal: "درجة فصل",
    failed: "راسب",
    passed: "ناجح",
    "full-mark": "درجة كاملة",
    "no-discount-protected": "بدون خصم",
  };
  return labels[kind] || kind || "—";
}

const studentDeleteImpactLabels: Array<
  [keyof StudentDeleteImpactResponse["counts"], string]
> = [
  ["grades", "درجات"],
  ["leaves", "إجازات"],
  ["calls", "مكالمات"],
  ["notes", "ملاحظات"],
  ["opportunityLogs", "سجلات فرص"],
];

export function formatStudentDeleteImpact(
  impact: StudentDeleteImpactResponse | null,
): string[] {
  if (!impact) return [];
  return studentDeleteImpactLabels
    .map(([key, label]) => [Number(impact.counts?.[key] || 0), label] as const)
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${label}: ${count}`);
}

export type StudentEditForm = {
  name: string;
  school: string;
  gender: "ذكر" | "أنثى";
  phone: string;
  parentPhone: string;
  telegram: string;
  username: string;
  courseProgram: string;
  courseTerm: string;
  studyType: string;
  locationScope: string;
  baghdadMode: string;
  courseId: string;
  subSite: string;
  createdAt: string;
};

export const emptyEditForm: StudentEditForm = {
  name: "",
  school: "",
  gender: "ذكر",
  phone: "",
  parentPhone: "",
  telegram: "",
  username: "",
  courseProgram: "",
  courseTerm: "",
  studyType: "",
  locationScope: "",
  baghdadMode: "",
  courseId: "",
  subSite: "",
  createdAt: baghdadTodayKey(),
};

export function getStudentEditForm(student: Student): StudentEditForm {
  return {
    name: student.name,
    school: student.school || "",
    gender: student.gender,
    phone: student.phone,
    parentPhone: student.parentPhone,
    telegram: sanitizeTelegramInput(student.telegram),
    username: sanitizeTelegramInput(student.username || ""),
    courseProgram: student.courseProgram || "",
    courseTerm: student.courseTerm || "",
    studyType: student.studyType || "",
    locationScope: student.locationScope || "",
    baghdadMode: student.baghdadMode || "",
    courseId: student.courseId,
    subSite: student.subSite || "",
    createdAt: baghdadDateKey(student.createdAt) || baghdadTodayKey(),
  };
}

export function whatsappLink(phone: string): string {
  const sanitized = sanitizePhoneInput(phone);
  if (!sanitized) return "";
  const appPhone =
    sanitized.startsWith("07") && sanitized.length === 11
      ? `964${sanitized.slice(1)}`
      : sanitized;
  return `https://wa.me/${encodeURIComponent(appPhone)}`;
}

export function telegramLink(telegram: string): string {
  const username = normalizeTelegramIdentifier(telegram).replace(/^@+/, "");
  // المعرفات الرقمية لا تصلح لروابط تيليجرام — تفتح فقط اليوزرات الحرفية.
  if (!username || /^\d+$/.test(username)) return "";
  // فتح المحادثة داخل تطبيق تيليجرام مباشرة بدل نسخة الويب.
  return `tg://resolve?domain=${encodeURIComponent(username)}`;
}

export type TelegramHandleInfo = {
  /** اسم الحقل المعروض: «يوزر تيليجرام» أو «معرف تيليجرام». */
  label: string;
  /** القيمة المعروضة بدون @. */
  value: string;
  /** رابط tg:// يفتح التطبيق، أو "" إذا لا يوجد رابط صالح. */
  href: string;
};

/**
 * يفضّل اليوزر المستعاد (username) على المعرف الرقمي (telegram) في كل
 * بطاقات العرض؛ المعرف الرقمي يُعرض نصاً بدون رابط لأنه لا يفتح محادثة.
 */
export function describeTelegramHandle(student: {
  telegram?: string | null;
  username?: string | null;
}): TelegramHandleInfo {
  const username = String(student.username ?? "")
    .trim()
    .replace(/^@+/, "");
  const telegram = String(student.telegram ?? "")
    .trim()
    .replace(/^@+/, "");
  if (username) {
    return {
      label: "يوزر تيليجرام",
      value: username,
      href: telegramLink(username),
    };
  }
  if (telegram) {
    if (/^\d+$/.test(telegram)) {
      return { label: "معرف تيليجرام", value: telegram, href: "" };
    }
    return {
      label: "يوزر تيليجرام",
      value: telegram,
      href: telegramLink(telegram),
    };
  }
  return { label: "تيليكرام", value: "", href: "" };
}

/** Read-only: the student's grace period that covers today (Baghdad), if any. */
export function currentStudentGracePeriod(
  student: Pick<Student, "gracePeriods">,
  todayKey: string = baghdadTodayKey(),
): GracePeriodRange | null {
  const period = findStudentGracePeriod(student.gracePeriods, todayKey);
  return period && gracePeriodState(period, todayKey) === "current" ? period : null;
}

/** «ضمن فترة السماح حتى 28/09/2026» or "" when no period covers today. */
export function formatStudentCurrentGrace(
  student: Pick<Student, "gracePeriods">,
  todayKey: string = baghdadTodayKey(),
): string {
  const period = currentStudentGracePeriod(student, todayKey);
  return period ? `ضمن فترة السماح حتى ${formatGraceDate(period.endDate)}` : "";
}

export function studentMatchesRegistrySearch(
  student: Student,
  query: string,
): boolean {
  const trimmed = toLatinDigits(query).trim();
  if (!trimmed) return true;
  const telegramKey = normalizeTelegramIdentifier(trimmed);
  const studentTelegramKey = normalizeTelegramIdentifier(student.telegram || "");
  const queryCode = trimmed.toLocaleLowerCase("ar-IQ");
  const studentCode = String(student.code || "")
    .trim()
    .toLocaleLowerCase("ar-IQ");
  const compact = sanitizePhoneInput(trimmed);
  const phoneValues = [student.phone, student.parentPhone].map((value) =>
    sanitizePhoneInput(String(value || "")),
  );

  return (
    searchAny(trimmed, [student.name, student.school]) ||
    Boolean(studentCode && studentCode.startsWith(queryCode)) ||
    Boolean(
      telegramKey &&
        studentTelegramKey &&
        studentTelegramKey.startsWith(telegramKey),
    ) ||
    phoneValues.some(
      (value) =>
        Boolean(compact && value.startsWith(compact)) ||
        (compact.length >= 7 && value.includes(compact)),
    )
  );
}
