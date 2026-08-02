import type { Student } from "@/lib/teacher-store";
import type { StudentDeleteImpactResponse } from "@/lib/api";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import {
  formatAppDate,
  sanitizePhoneInput,
  toLatinDigits,
} from "@/lib/format";
import {
  getStudentGraceWindow,
  isStudentCurrentlyInGrace as isStudentCurrentlyInGraceUnified,
} from "@/lib/student-grace";
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
  { key: "opportunities", label: "الفرص", value: (student) => student.opportunities ?? "" },
  { key: "grace", label: "فترة السماح", value: (student) => `${student.accountingGraceDays ?? 0} يوم` },
  { key: "phone", label: "الهاتف", value: (student) => student.phone || "" },
  { key: "parentPhone", label: "ولي الأمر", value: (student) => student.parentPhone || "" },
  { key: "telegram", label: "التيليجرام", value: (student) => student.telegram || "" },
];

export function academicImpactKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    missing: "غير مكتملة",
    excused: "إجازة",
    "grace-period": "ضمن السماح",
    "before-registration": "قبل التسجيل",
    "unavailable-exam": "امتحان غير متاح",
    cheating: "غش",
    "absent-dismissal": "غياب فصل",
    "absent-deducted": "غياب مخصوم",
    discounted: "درجة مخصومة",
    "academic-accounting": "محاسبة أكاديمية",
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
  ["correctionSheets", "أوراق تصحيح"],
  ["telegramSubmissions", "مستلمات بوت"],
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
  courseProgram: string;
  courseTerm: string;
  studyType: string;
  locationScope: string;
  baghdadMode: string;
  courseId: string;
  subSite: string;
  createdAt: string;
  accountingGraceDays: string;
};

export const emptyEditForm: StudentEditForm = {
  name: "",
  school: "",
  gender: "ذكر",
  phone: "",
  parentPhone: "",
  telegram: "",
  courseProgram: "",
  courseTerm: "",
  studyType: "",
  locationScope: "",
  baghdadMode: "",
  courseId: "",
  subSite: "",
  createdAt: baghdadTodayKey(),
  accountingGraceDays: "0",
};

export function getStudentEditForm(student: Student): StudentEditForm {
  return {
    name: student.name,
    school: student.school || "",
    gender: student.gender,
    phone: student.phone,
    parentPhone: student.parentPhone,
    telegram: sanitizeTelegramInput(student.telegram),
    courseProgram: student.courseProgram || "",
    courseTerm: student.courseTerm || "",
    studyType: student.studyType || "",
    locationScope: student.locationScope || "",
    baghdadMode: student.baghdadMode || "",
    courseId: student.courseId,
    subSite: student.subSite || "",
    createdAt: baghdadDateKey(student.createdAt) || baghdadTodayKey(),
    accountingGraceDays: String(student.accountingGraceDays ?? 0),
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
  return username ? `https://t.me/${encodeURIComponent(username)}` : "";
}

export function normalizeGraceDaysInput(value: string): string {
  const digits = toLatinDigits(value).replace(/\D/g, "");
  return digits ? String(Math.min(Number(digits), 30)) : "0";
}

export function isValidGraceDays(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= 30;
}

export function graceEndDate(student: Student): string {
  const graceWindow = getStudentGraceWindow(student);
  if (!graceWindow) {
    return formatAppDate(
      student.createdAt,
      String(student.createdAt || "").slice(0, 10) || "-",
    );
  }
  const end = new Date(graceWindow.endExclusive);
  end.setUTCDate(end.getUTCDate() - 1);
  return formatAppDate(end);
}

export function isStudentCurrentlyInGrace(student: Student): boolean {
  return isStudentCurrentlyInGraceUnified(student);
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
