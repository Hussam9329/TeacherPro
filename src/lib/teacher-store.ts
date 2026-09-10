"use client";
import { gradeSettlementExclusion } from "./grade-settlement";
import { setOutboxOwner } from "./outbox-session";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { courseApi, courseChapterApi, gradeApi, opportunityLogApi, studentLeaveApi, studentCallApi, studentNoteApi, userApi, roleApi, logApi, authApi, loadAllFromServer, type ApiResult, type AuthApiUser } from "./api";
import { type CourseLocationConfig, type StudyTypesByProgram, getAvailablePrograms, getAvailableStudyTypes, getStudyTypesByProgram, parseJsonArray, parseJsonRecord } from "./course-config";
import { getExamEntryAvailability, isExamOnOrAfterStudentRegistration, isGradeEntered } from "./exam-utils";
import { baghdadDateKey, baghdadTodayKey, toBaghdadDateTimeLocal } from "./baghdad-time";
import { formatAppDate } from "./format";
import { isExamWithinStudentGraceWindow } from "./student-grace";
import {
  announceTeacherProSyncError,
  announceTeacherProSyncRefreshing,
  announceTeacherProSyncSettled,
  emitTeacherProDataChanged,
  emitTeacherProLogsChangedDebounced,
} from "./teacherpro-sync";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Course {
  id: string;
  name: string;
  createdAt: string;
  active: boolean;
  availablePrograms: string[];
  availableStudyTypes: string[];
  studyTypesByProgram: StudyTypesByProgram;
  locationConfig: CourseLocationConfig;
}

export interface Chapter {
  id: string;
  name: string;
  opportunities: number;
}

export interface ArchiveEntry {
  studentId: string;
  opportunities: number;
  date: string;
}

export interface CourseChapter {
  id: string;
  courseId: string;
  chapterId: string;
  active: boolean;
  archived: boolean;
  archive: ArchiveEntry[];
}

export interface Student {
  id: string;
  name: string;
  school: string;
  gender: "ذكر" | "أنثى";
  phone: string;
  parentPhone: string;
  telegram: string;
  courseProgram: "منهج كامل" | "كورسات" | "";
  courseTerm: "الكورس الأول" | "الكورس الثاني" | "";
  studyType: "إلكتروني" | "حضوري" | "مدمج" | "";
  locationScope: "بغداد" | "محافظات" | "خارج القطر" | "";
  baghdadMode: "عموم بغداد" | "بغداد - مخصص" | "";
  courseId: string;
  mainSite: string;
  subSite: string;
  code: string;
  status: "نشط" | "مفصول" | "مؤرشف";
  dismissalReason: string;
  dismissalNotes: string;
  createdAt: string;
  opportunities: number;
  baseOpportunities: number;
  accountingGraceDays: number;
  gracePeriodStartDate?: string | null;
  gracePeriodEndedAt?: string | null;
  /** Server-side snapshot used by إدارة الفرص so actions never depend on stale course-chapter cache. */
  hasActiveChapter?: boolean;
  activeChapterConflictCount?: number;
  activeChapter?: { id: string; name: string; opportunities: number } | null;
  /** Authoritative limit from the single active chapter; null means unavailable/conflicting. */
  opportunityLimit?: number | null;
  opportunitySource?: "student-record";
  opportunityLimitSource?:
    | "active-chapter"
    | "no-active-chapter"
    | "active-chapter-conflict";
  opportunityHealth?:
    | "ready"
    | "zero-limit"
    | "missing-active-chapter"
    | "active-chapter-conflict";
  isOpportunityFull?: boolean;
  isOpportunityOverLimit?: boolean;
  mutationToken?: string;
}

export type CourseTransferPolicy = "reset" | "keep";

export type StudentUpdatePayload = Partial<
  Omit<
    Student,
    "id" | "code" | "gracePeriodStartDate" | "gracePeriodEndedAt"
  >
> & {
  gracePeriodStartMode?: "registration" | "now";
  /**
   * Required only when courseId changes from one course to another.
   * - reset: treat the student as new in the target course and grant the
   *   target course active chapter opportunities.
   * - keep: move course/settings only and keep the student's current
   *   opportunities/baseOpportunities untouched.
   */
  courseTransferPolicy?: CourseTransferPolicy;
};

export interface Exam {
  examCourses?: Array<{ courseId: string; chapterId: string | null }>;
  id: string;
  name: string;
  type: "يومي" | "تراكمي" | "فاينل";
  courseIds: string[];
  mainSite: string;
  date: string;
  fullMark: number;
  passMark: number;
  discountMark: number;
  opportunitiesPenalty: number;
  dismissalGrade: number | null;
  noDiscount: boolean;
  active: boolean;
  scheduledActivateAt?: string;
  mutationToken?: string;
}

export interface Grade {
  effectiveImpactExcluded?: boolean;
  effectiveImpactExclusionReason?: string | null;
  id: string;
  studentId: string;
  examId: string;
  status: "درجة" | "غائب" | "غش" | "مجاز" | "ضمن فترة السماح" | "قبل تسجيل الطالب" | "درجة معلّقة";
  score: number | null;
  notes: string;
  academicAccountingChecked: boolean;
  academicEffectExcluded?: boolean;
  academicEffectExclusionReason?: string | null;
  academicEffectExclusionSource?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityLog {
  ledgerVersion?: number | null;
  settledGradeIds?: string | null;
  id: string;
  studentId: string;
  examId: string;
  action: string;
  amount: number;
  reason: string;
  date: string;
  chapterId: string;
  chapterNameSnapshot?: string;
}

export type StudentLeaveType = "exam" | "period";

export interface StudentLeave {
  id: string;
  studentId: string;
  examId: string;
  leaveType: StudentLeaveType;
  reason: string;
  studyType: string;
  date: string;
  dateFrom: string;
  dateTo: string;
  notes: string;
  /** Optional relation included by /api/student-leaves so the UI does not show "طالب محذوف" when the local students cache is paginated. */
  student?: Partial<Student> | null;
  exam?: Partial<Exam> | null;
}

export interface StudentCall {
  id: string;
  studentId: string;
  examId: string;
  category: string;
  target: string;
  phone: string;
  status: string;
  completed: boolean;
  completedAt: string;
  notes: string;
  createdAt: string;
}

export interface StudentNote {
  id: string;
  studentId: string;
  kind: string;
  text: string;
  date: string;
  sourceType?: string;
  sourceId?: string;
  dismissalKey?: string;
  dismissalReason?: string;
  dismissalDate?: string;
}

export interface User {
  id: string;
  username: string;
  name: string;
  roleId: string;
  role: string;
  permissions: string[];
  active: boolean;
  password?: string;
}

function userFromAuthApi(authUser: AuthApiUser): User {
  return {
    id: authUser.id,
    username: authUser.username,
    name: authUser.name,
    roleId: authUser.roleId || "",
    role: authUser.role,
    permissions: sanitizePermissionIds(authUser.permissions || []),
    active: authUser.active,
  };
}

export interface Role {
  id: string;
  name: string;
  isDefault: boolean;
  permissions: string[];
}

export interface LogEntry {
  id: string;
  user: string;
  module: string;
  action: string;
  details: string;
  time: string;
}

export interface LogClearOptions {
  scopeIds: string[];
  dateFrom?: string;
  dateTo?: string;
}

export type SectionId =
  | "dashboard"
  | "courses"
  | "chapters"
  | "student-register"
  | "student-bulk-import"
  | "student-registry"
  | "dismissed-management"
  | "exam-new"
  | "grade-entry"
  | "exam-records"
  | "grade-records"
  | "opportunities"
  | "follow-up"
  | "follow-up-calls"
  | "follow-up-leaves"
  | "accounts"
  | "logs"
  | "admin-log-reset";

// ─── Permissions Catalog ────────────────────────────────────────────────────

export interface PermissionEntry {
  id: string;
  label: string;
  category: string;
  level: "read" | "write" | "delete" | "manage";
  description: string;
}

export const PERMISSION_CATALOG: PermissionEntry[] = [
  // النظام
  {
    id: "system.dashboard",
    label: "لوحة النظام",
    category: "النظام",
    level: "read",
    description: "عرض لوحة النظام والنظرة العامة",
  },
  {
    id: "system.settings",
    label: "إعدادات النظام",
    category: "النظام",
    level: "manage",
    description: "تعديل إعدادات النظام",
  },
  {
    id: "backup.view",
    label: "تصدير النسخ الاحتياطي",
    category: "النظام",
    level: "manage",
    description: "تحميل نسخة احتياطية كاملة من بيانات النظام",
  },
  {
    id: "backup.restore",
    label: "استعادة النسخة الاحتياطية",
    category: "النظام",
    level: "manage",
    description: "استعادة بيانات النظام من نسخة احتياطية (عملية حساسة تستبدل أو تدمج البيانات)",
  },
  {
    id: "system.maintenance",
    label: "صيانة النظام الشاملة",
    category: "النظام",
    level: "manage",
    description: "تشغيل أدوات الصيانة الجماعية (إعادة الاحتساب الأكاديمي الشامل، إصلاح الفرص، ضبط السقوف)",
  },
  // الدورات
  {
    id: "courses.view",
    label: "عرض الدورات",
    category: "الدورات",
    level: "read",
    description: "عرض قائمة الدورات",
  },
  {
    id: "courses.add",
    label: "إضافة دورة",
    category: "الدورات",
    level: "write",
    description: "إنشاء دورة جديدة",
  },
  {
    id: "courses.edit",
    label: "تعديل دورة",
    category: "الدورات",
    level: "write",
    description: "تعديل بيانات دورة",
  },
  {
    id: "courses.delete",
    label: "حذف دورة",
    category: "الدورات",
    level: "delete",
    description: "حذف دورة من النظام",
  },
  // الفصول
  {
    id: "chapters.view",
    label: "عرض الفصول",
    category: "الفصول",
    level: "read",
    description: "عرض قائمة الفصول",
  },
  {
    id: "chapters.add",
    label: "إضافة فصل",
    category: "الفصول",
    level: "write",
    description: "إنشاء فصل جديد",
  },
  {
    id: "chapters.edit",
    label: "تعديل فصل",
    category: "الفصول",
    level: "write",
    description: "تعديل بيانات فصل",
  },
  {
    id: "chapters.delete",
    label: "حذف فصل",
    category: "الفصول",
    level: "delete",
    description: "حذف فصل من النظام",
  },
  // الطلاب
  {
    id: "students.view",
    label: "عرض الطلاب",
    category: "الطلاب",
    level: "read",
    description: "عرض سجل الطلاب",
  },
  {
    id: "students.add",
    label: "تسجيل طالب",
    category: "الطلاب",
    level: "write",
    description: "تسجيل طالب جديد",
  },
  {
    id: "students.edit",
    label: "تعديل بيانات طالب",
    category: "الطلاب",
    level: "write",
    description: "تعديل بيانات طالب",
  },
  {
    id: "students.delete",
    label: "حذف طالب",
    category: "الطلاب",
    level: "delete",
    description: "حذف طالب من النظام",
  },
  // الامتحانات
  {
    id: "exams.view",
    label: "عرض الامتحانات",
    category: "الامتحانات",
    level: "read",
    description: "عرض قائمة الامتحانات",
  },
  {
    id: "exams.add",
    label: "إضافة امتحان",
    category: "الامتحانات",
    level: "write",
    description: "إنشاء امتحان جديد",
  },
  {
    id: "exams.edit",
    label: "تعديل امتحان",
    category: "الامتحانات",
    level: "write",
    description: "تعديل بيانات امتحان",
  },
  {
    id: "exams.delete",
    label: "حذف امتحان",
    category: "الامتحانات",
    level: "delete",
    description: "حذف امتحان من النظام",
  },
  // الدرجات
  {
    id: "grades.view",
    label: "عرض الدرجات",
    category: "الدرجات",
    level: "read",
    description: "عرض سجل الدرجات",
  },
  {
    id: "grades.add",
    label: "إدخال درجات",
    category: "الدرجات",
    level: "write",
    description: "إدخال درجات الطلاب",
  },
  {
    id: "grades.edit",
    label: "تعديل درجة",
    category: "الدرجات",
    level: "write",
    description: "تعديل درجة طالب",
  },
  {
    id: "grades.delete",
    label: "حذف درجة",
    category: "الدرجات",
    level: "delete",
    description: "حذف درجة من السجل",
  },
  // الفرص
  {
    id: "opportunities.view",
    label: "عرض الفرص",
    category: "الفرص",
    level: "read",
    description: "عرض وإدارة فرص الطلاب",
  },
  {
    id: "opportunities.manage",
    label: "إدارة الفرص",
    category: "الفرص",
    level: "manage",
    description: "إضافة وخصم فرص الطلاب",
  },
  {
    id: "follow-up.view",
    label: "عرض المتابعة",
    category: "المتابعة",
    level: "read",
    description: "عرض الإجازات والمكالمات وملف الطالب",
  },
  {
    id: "follow-up.manage",
    label: "إدارة المتابعة",
    category: "المتابعة",
    level: "manage",
    description: "إضافة الإجازات والمكالمات والملاحظات",
  },
  {
    id: "follow-up.calls.view",
    label: "عرض المكالمات",
    category: "المتابعة / المكالمات",
    level: "read",
    description: "عرض صفحة المكالمات ومرشحي الاتصال.",
  },
  {
    id: "follow-up.calls.manage",
    label: "إدارة المكالمات",
    category: "المتابعة / المكالمات",
    level: "manage",
    description: "حفظ وتحديث حالات المكالمات.",
  },
  {
    id: "follow-up.leaves.view",
    label: "عرض الإجازات",
    category: "المتابعة / الإجازات",
    level: "read",
    description: "عرض إجازات الطلاب وتأثيرها على الدرجات.",
  },
  {
    id: "follow-up.leaves.manage",
    label: "إدارة الإجازات",
    category: "المتابعة / الإجازات",
    level: "manage",
    description: "إضافة وحذف إجازات الطلاب مع الأثر الأكاديمي.",
  },
  // الحسابات
  {
    id: "accounts.view",
    label: "عرض الحسابات",
    category: "الحسابات",
    level: "read",
    description: "عرض قائمة الحسابات",
  },
  {
    id: "accounts.manage",
    label: "إدارة الحسابات",
    category: "الحسابات",
    level: "manage",
    description: "إضافة وتعديل وحذف الحسابات",
  },
  {
    id: "accounts.users.view",
    label: "عرض المستخدمين",
    category: "إدارة الحسابات / المستخدمين",
    level: "read",
    description: "عرض حسابات المستخدمين وبياناتهم الأساسية.",
  },
  {
    id: "accounts.users.add",
    label: "إضافة مستخدم",
    category: "إدارة الحسابات / المستخدمين",
    level: "write",
    description: "إنشاء حساب مستخدم جديد مع دور وصلاحيات محددة.",
  },
  {
    id: "accounts.users.edit",
    label: "تعديل مستخدم",
    category: "إدارة الحسابات / المستخدمين",
    level: "write",
    description: "تعديل اسم المستخدم أو كلمة المرور أو حالة الحساب.",
  },
  {
    id: "accounts.users.delete",
    label: "حذف مستخدم",
    category: "إدارة الحسابات / المستخدمين",
    level: "delete",
    description: "حذف حساب مستخدم غير محمي بعد فحص الأثر.",
  },
  {
    id: "accounts.roles.view",
    label: "عرض الأدوار",
    category: "إدارة الحسابات / الأدوار",
    level: "read",
    description: "عرض الأدوار وعدد المستخدمين المرتبطين بها.",
  },
  {
    id: "accounts.roles.add",
    label: "إضافة دور",
    category: "إدارة الحسابات / الأدوار",
    level: "write",
    description: "إنشاء دور جديد وتحديد صلاحياته.",
  },
  {
    id: "accounts.roles.edit",
    label: "تعديل دور",
    category: "إدارة الحسابات / الأدوار",
    level: "write",
    description: "تعديل اسم الدور أو صلاحياته ومزامنة المستخدمين المرتبطين.",
  },
  {
    id: "accounts.roles.delete",
    label: "حذف دور",
    category: "إدارة الحسابات / الأدوار",
    level: "delete",
    description: "حذف دور غير افتراضي وغير مستخدم.",
  },
  {
    id: "accounts.permissions.view",
    label: "عرض كتالوج الصلاحيات",
    category: "إدارة الحسابات / الصلاحيات",
    level: "read",
    description: "عرض كل الصلاحيات المتاحة وتفصيلها حسب الصفحة والإجراء.",
  },
  {
    id: "accounts.permissions.assign",
    label: "منح الصلاحيات",
    category: "إدارة الحسابات / الصلاحيات",
    level: "manage",
    description: "تعديل صلاحيات المستخدمين أو الأدوار.",
  },
  {
    id: "accounts.security.view",
    label: "عرض فحص أمان الحسابات",
    category: "إدارة الحسابات / الأمان",
    level: "read",
    description: "عرض لوحة فحص الأمان ومخاطر الصلاحيات الحساسة.",
  },
  {
    id: "logs.delete",
    label: "حذف سجل مفرد",
    category: "السجلات",
    level: "delete",
    description: "حذف سجل تدقيق مفرد. يبقى محصوراً بالمدير مع تدقيق أمني.",
  },
  {
    id: "logs.clear",
    label: "تصفير السجلات",
    category: "تصفير الـ Log",
    level: "manage",
    description: "تصفير نطاقات محددة من السجلات بعد كلمة مرور الأدمن ونسخة استعادة.",
  },
  {
    id: "logs.restore",
    label: "استعادة آخر تصفير",
    category: "تصفير الـ Log",
    level: "manage",
    description: "استعادة آخر نسخة احتياطية أنشئت قبل تصفير السجلات.",
  },
  // السجلات
  {
    id: "logs.view",
    label: "عرض السجلات",
    category: "السجلات",
    level: "read",
    description: "عرض سجلات العمليات والتدقيق",
  },
];

// ─── Section-to-Permission Mapping ──────────────────────────────────────────

export const SECTION_PERMISSIONS: Record<SectionId, string> = {
  dashboard: "system.dashboard",
  courses: "courses.add",
  chapters: "chapters.view",
  "student-register": "students.add",
  "student-bulk-import": "students.add",
  "student-registry": "students.view",
  "dismissed-management": "students.view",
  "exam-new": "exams.add",
  "grade-entry": "grades.add",
  "exam-records": "exams.view",
  "grade-records": "grades.view",
  opportunities: "opportunities.view",
  "follow-up": "follow-up.view",
  "follow-up-calls": "follow-up.calls.view",
  "follow-up-leaves": "follow-up.leaves.view",
  accounts: "accounts.users.view",
  logs: "logs.view",
  "admin-log-reset": "logs.clear",
};

// توافق قراءة فقط للحسابات التي ما زالت تحمل صلاحية التبويب القديم.
// إجراءات الاسترجاع والتعديل تبقى محمية منفصلاً بـ students.edit على الخادم.
const SECTION_PERMISSION_EQUIVALENTS: Partial<Record<SectionId, string[]>> = {
  "dismissed-management": ["page.dismissed-students.view"],
};

// ─── Default Roles ──────────────────────────────────────────────────────────

const ALL_PERMISSION_IDS = Array.from(
  new Set(PERMISSION_CATALOG.map((p) => p.id)),
);
const ALL_VIEW_PERMISSION_IDS = PERMISSION_CATALOG.filter(
  (p) => p.level === "read",
).map((p) => p.id);

const ADMIN_USERNAME = "admin";
const ADMIN_ROLE_ID = "role_admin";
const ADMIN_ROLE_NAME = "مدير عام";

/**
 * Default admin password is read from TEACHERPRO_ADMIN_PASSWORD env var.
 * The constant here is only a development fallback; production requires
 * the env var to be set (see admin-seed.ts for the authoritative path).
 */
function readAdminPasswordEnv(): string {
  if (
    typeof process !== "undefined" &&
    process.env?.TEACHERPRO_ADMIN_PASSWORD
  ) {
    return process.env.TEACHERPRO_ADMIN_PASSWORD.trim();
  }
  // Development-only fallback. Never used in production.
  return "change-me-in-env";
}
const ADMIN_PASSWORD = readAdminPasswordEnv();
const ADMIN_FULL_PERMISSIONS = [...ALL_PERMISSION_IDS];
const ADMIN_ONLY_SECTIONS = new Set<SectionId>(["admin-log-reset"]);
const DEPRECATED_PERMISSION_IDS = new Set([
  "groups.view",
  "groups.add",
  "groups.edit",
  "groups.delete",
  "sites.view",
  "sites.add",
  "sites.edit",
  "sites.delete",
  "demos.view",
  "demos.manage",
  "correction.view",
  "correction.manage",
]);

function sanitizePermissionIds(permissions: string[] = []): string[] {
  return Array.from(
    new Set(
      permissions.filter(
        (permission) => !DEPRECATED_PERMISSION_IDS.has(permission),
      ),
    ),
  );
}

function isPrimaryAdminUser(user?: Pick<User, "username"> | null): boolean {
  return (
    String(user?.username || "")
      .trim()
      .toLowerCase() === ADMIN_USERNAME
  );
}

function hasFullAdminAccess(
  user?: Pick<User, "username" | "roleId"> | null,
): boolean {
  return isPrimaryAdminUser(user) || user?.roleId === ADMIN_ROLE_ID;
}

function normalizeAdminAccessUser(user: User): User {
  if (isPrimaryAdminUser(user)) {
    return {
      ...user,
      username: ADMIN_USERNAME,
      name: user.name || "مدير النظام",
      roleId: ADMIN_ROLE_ID,
      role: ADMIN_ROLE_NAME,
      permissions: [...ADMIN_FULL_PERMISSIONS],
      active: true,
      password: ADMIN_PASSWORD,
    };
  }

  if (user.roleId === ADMIN_ROLE_ID) {
    return {
      ...user,
      role: user.role || ADMIN_ROLE_NAME,
      permissions: [...ADMIN_FULL_PERMISSIONS],
    };
  }

  return {
    ...user,
    permissions: sanitizePermissionIds(user.permissions || []),
  };
}

const DEFAULT_ROLES: Role[] = [
  {
    id: "role_admin",
    name: "مدير عام",
    isDefault: true,
    permissions: [...ADMIN_FULL_PERMISSIONS],
  },
  {
    id: "role_supervisor",
    name: "مشرف",
    isDefault: true,
    permissions: ALL_PERMISSION_IDS.filter(
      (p) =>
        p !== "accounts.manage" &&
        p !== "accounts.users.add" &&
        p !== "accounts.users.edit" &&
        p !== "accounts.users.delete" &&
        p !== "accounts.roles.add" &&
        p !== "accounts.roles.edit" &&
        p !== "accounts.roles.delete" &&
        p !== "accounts.permissions.assign" &&
        p !== "logs.delete" &&
        p !== "logs.clear" &&
        p !== "logs.restore" &&
        p !== "backup.view" &&
        p !== "backup.restore" &&
        p !== "system.settings",
    ),
  },
  {
    id: "role_registrar",
    name: "مسؤول تسجيل",
    isDefault: true,
    permissions: [
      "students.view",
      "students.add",
      "students.edit",
      "students.delete",
      "courses.view",
      "chapters.view",
      "exams.view",
      "grades.view",
    ],
  },
  {
    id: "role_checker",
    name: "مصحح",
    isDefault: true,
    permissions: ["grades.view", "students.view", "exams.view"],
  },
  {
    id: "role_viewer",
    name: "مشاهدة فقط",
    isDefault: true,
    permissions: [...ALL_VIEW_PERMISSION_IDS],
  },
];

// ─── Backup Shape ───────────────────────────────────────────────────────────

export interface BackupShape {
  courses?: Course[];
  chapters?: Chapter[];
  courseChapters?: CourseChapter[];
  students?: Student[];
  exams?: Exam[];
  grades?: Grade[];
  opportunityLogs?: OpportunityLog[];
  studentLeaves?: StudentLeave[];
  studentCalls?: StudentCall[];
  studentNotes?: StudentNote[];
  users?: User[];
  roles?: Role[];
  logs?: LogEntry[];
}

// ─── Store State ────────────────────────────────────────────────────────────

interface TeacherState {
  courses: Course[];
  chapters: Chapter[];
  courseChapters: CourseChapter[];
  students: Student[];
  exams: Exam[];
  grades: Grade[];
  opportunityLogs: OpportunityLog[];
  studentLeaves: StudentLeave[];
  studentCalls: StudentCall[];
  studentNotes: StudentNote[];
  users: User[];
  roles: Role[];
  logs: LogEntry[];
  dbConnected: boolean;
  dbLoading: boolean;

  currentSection: SectionId;
  sidebarOpen: boolean;
  theme: "light" | "dark";
  studentPageSize: number;
  gradePageSize: number;
  currentUserId: string;
  isAuthenticated: boolean;

  loadFromServer: () => Promise<boolean>;
  loadSectionDataFromServer: (section: SectionId) => Promise<void>;
  restoreSession: () => Promise<boolean>;
  mergeStudentsCache: (students: Student[]) => void;
  mergeGradesCache: (grades: Grade[]) => void;

  setSection: (section: SectionId) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleTheme: () => void;

  currentUser: () => User | null;
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; message: string }>;
  canAccess: (section: SectionId | string) => boolean;
  logout: () => void;

  courseName: (id: string) => string;
  chapterName: (id: string) => string;
  studentName: (id: string) => string;
  userName: (id: string) => string;
  activeChapterForCourse: (courseId: string) => Chapter | null;
  classification: (
    grade: Grade | undefined,
    exam: Exam,
    student?: Student,
  ) => { text: string; type: string; kind: string };

  addUser: (user: Omit<User, "id">) => void;
  updateUser: (id: string, updates: Partial<Omit<User, "id">>) => void;
  toggleUser: (id: string) => void;
  updateUserPermissions: (id: string, permissions: string[]) => void;
  deleteUser: (id: string) => boolean;

  addRole: (role: Omit<Role, "id">) => void;
  updateRole: (id: string, updates: Partial<Omit<Role, "id">>) => void;
  deleteRole: (id: string) => boolean;

  logAction: (module: string, action: string, details?: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO(): string {
  return baghdadTodayKey();
}

function normalizeDateTimeValue(value: unknown): string {
  if (!value) return "";
  return toBaghdadDateTimeLocal(value as string | Date);
}

function nowText(): string {
  const d = new Date();
  const date = formatAppDate(d);
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time}`;
}

function mergeRecordsById<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  if (incoming.length === 0) return current;
  const byId = new Map<string, T>();
  current.forEach((item) => byId.set(item.id, item));
  incoming.forEach((item) => {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? { ...existing, ...item } : item);
  });
  return Array.from(byId.values());
}

function gradeIdentityKey(grade: Pick<Grade, "studentId" | "examId">): string {
  return `${grade.studentId}:${grade.examId}`;
}

function mergeGradesByIdentity(current: Grade[], incoming: Grade[]): Grade[] {
  if (incoming.length === 0) return current;
  const byIdentity = new Map<string, Grade>();
  current.forEach((grade) => byIdentity.set(gradeIdentityKey(grade), grade));
  incoming.forEach((grade) => {
    const key = gradeIdentityKey(grade);
    const existing = byIdentity.get(key);
    // Prefer incoming/server IDs. This prevents duplicate local temporary IDs after
    // the server rejects client-provided IDs and creates its own primary key.
    byIdentity.set(
      key,
      existing ? { ...existing, ...grade, id: grade.id || existing.id } : grade,
    );
  });
  return Array.from(byIdentity.values());
}

function normalizeStudentRecord(st: Record<string, unknown>): Student {
  const { groupId: _groupId, ...studentData } = st;
  void _groupId;
  return {
    ...(studentData as Record<string, unknown>),
    school: String(st.school || ""),
    opportunities: Number(st.opportunities || 0),
    baseOpportunities: Number(st.baseOpportunities || 0),
    opportunityLimit:
      Object.prototype.hasOwnProperty.call(st, "opportunityLimit")
        ? st.opportunityLimit === null
          ? null
          : Number(st.opportunityLimit || 0)
        : undefined,
    opportunitySource:
      st.opportunitySource === "student-record" ? "student-record" : undefined,
    opportunityLimitSource:
      st.opportunityLimitSource === "active-chapter" ||
      st.opportunityLimitSource === "no-active-chapter" ||
      st.opportunityLimitSource === "active-chapter-conflict"
        ? st.opportunityLimitSource
        : undefined,
    opportunityHealth:
      st.opportunityHealth === "ready" ||
      st.opportunityHealth === "zero-limit" ||
      st.opportunityHealth === "missing-active-chapter" ||
      st.opportunityHealth === "active-chapter-conflict"
        ? st.opportunityHealth
        : undefined,
    hasActiveChapter:
      st.hasActiveChapter === undefined
        ? undefined
        : Boolean(st.hasActiveChapter),
    activeChapterConflictCount:
      st.activeChapterConflictCount === undefined
        ? undefined
        : Number(st.activeChapterConflictCount || 0),
    activeChapter:
      Object.prototype.hasOwnProperty.call(st, "activeChapter")
        ? (st.activeChapter as Student["activeChapter"])
        : undefined,
    isOpportunityFull:
      st.isOpportunityFull === undefined
        ? undefined
        : Boolean(st.isOpportunityFull),
    isOpportunityOverLimit:
      st.isOpportunityOverLimit === undefined
        ? undefined
        : Boolean(st.isOpportunityOverLimit),
    accountingGraceDays: normalizeGraceDaysValue(st.accountingGraceDays),
    gracePeriodStartDate: st.gracePeriodStartDate
      ? baghdadDateKey(st.gracePeriodStartDate as string | Date)
      : null,
    gracePeriodEndedAt: st.gracePeriodEndedAt
      ? String(st.gracePeriodEndedAt)
      : null,
    dismissalNotes: String(st.dismissalNotes || ""),
    createdAt: st.createdAt
      ? baghdadDateKey(st.createdAt as string | Date) || todayISO()
      : todayISO(),
    courseProgram: String(st.courseProgram || ""),
    courseTerm: String(st.courseTerm || ""),
    studyType: String(st.studyType || ""),
    locationScope: String(st.locationScope || ""),
    baghdadMode: String(st.baghdadMode || ""),
  } as Student;
}

function normalizeGradeRecord(g: Record<string, unknown>): Grade {
  const preserveGradeTimestamp = (value: unknown): string => {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : todayISO();
    }
    const text = String(value || "").trim();
    return text || todayISO();
  };
  return {
    ...(g as Record<string, unknown>),
    status: sanitizeGradeStatus(g.status),
    score: g.score === null || g.score === undefined ? null : Number(g.score),
    academicAccountingChecked: Boolean(g.academicAccountingChecked),
    academicEffectExcluded: Boolean(g.academicEffectExcluded),
    effectiveImpactExcluded: Boolean(g.effectiveImpactExcluded),
    effectiveImpactExclusionReason: g.effectiveImpactExclusionReason ? String(g.effectiveImpactExclusionReason) : null,
    academicEffectExclusionReason: String(g.academicEffectExclusionReason || "") || null,
    academicEffectExclusionSource: String(g.academicEffectExclusionSource || "") || null,
    // Keep the complete server timestamp. Optimistic concurrency compares
    // updatedAt exactly; reducing it to a Baghdad date makes every edit look
    // stale and causes a permanent 409 even immediately after loading.
    createdAt: preserveGradeTimestamp(g.createdAt),
    updatedAt: preserveGradeTimestamp(g.updatedAt),
  } as Grade;
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

// ─── Default Courses ─────────────────────────────────────────────────────────

const DEFAULT_COURSES: Course[] = [];

function seedData() {
  const roles: Role[] = DEFAULT_ROLES.map((r) => ({
    ...r,
    permissions: [...r.permissions],
  }));

  const users: User[] = [
    {
      id: "u_admin",
      username: ADMIN_USERNAME,
      name: "مدير النظام",
      roleId: ADMIN_ROLE_ID,
      role: ADMIN_ROLE_NAME,
      permissions: [...ADMIN_FULL_PERMISSIONS],
      active: true,
      password: ADMIN_PASSWORD,
    },
  ];

  return {
    courses: [...DEFAULT_COURSES] as Course[],
    chapters: [] as Chapter[],
    courseChapters: [] as CourseChapter[],
    students: [] as Student[],
    exams: [] as Exam[],
    grades: [] as Grade[],
    opportunityLogs: [] as OpportunityLog[],
    studentLeaves: [] as StudentLeave[],
    studentCalls: [] as StudentCall[],
    studentNotes: [] as StudentNote[],
    users,
    roles,
    logs: [] as LogEntry[],
  };
}

function parseArrayField<T = unknown>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mergeDefaultCourses(courses: Course[]): Course[] {
  const existingIds = new Set(courses.map((course) => course.id));
  return [
    ...courses,
    ...DEFAULT_COURSES.filter((course) => !existingIds.has(course.id)).map(
      (course) => ({ ...course }),
    ),
  ];
}

function mergeDefaultRoles(roles: Role[]): Role[] {
  const normalizedRoles = roles.map((role) => {
    const defaultRole = DEFAULT_ROLES.find((item) => item.id === role.id);
    if (!defaultRole) {
      return {
        ...role,
        permissions: sanitizePermissionIds(role.permissions || []),
      };
    }
    if (role.id === ADMIN_ROLE_ID) {
      return {
        ...role,
        name: ADMIN_ROLE_NAME,
        isDefault: true,
        permissions: [...ADMIN_FULL_PERMISSIONS],
      };
    }
    return {
      ...role,
      name: role.name || defaultRole.name,
      isDefault: role.isDefault || defaultRole.isDefault,
      permissions: sanitizePermissionIds([
        ...(defaultRole.permissions || []),
        ...(role.permissions || []),
      ]),
    };
  });

  const existingIds = new Set(normalizedRoles.map((role) => role.id));
  return [
    ...normalizedRoles,
    ...DEFAULT_ROLES.filter((role) => !existingIds.has(role.id)).map(
      (role) => ({
        ...role,
        permissions: sanitizePermissionIds(role.permissions),
      }),
    ),
  ];
}

function normalizeGraceDaysValue(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(30, Math.max(0, Math.trunc(numeric)));
}

function sanitizeGradeStatus(value: unknown): Grade["status"] {
  if (value === "غش") return "غش";
  if (value === "غائب" || value === "مجاز") return value;
  if (value === "ضمن فترة السماح") return "ضمن فترة السماح";
  if (value === "قبل تسجيل الطالب") return "قبل تسجيل الطالب";
  return "درجة";
}

function isExamWithinStudentGracePeriod(
  student: Pick<
    Student,
    | "createdAt"
    | "accountingGraceDays"
    | "gracePeriodStartDate"
    | "gracePeriodEndedAt"
  >,
  exam: Pick<Exam, "date">,
): boolean {
  return isExamWithinStudentGraceWindow(student, exam);
}

function dayKey(value: string | Date | null | undefined): string {
  return baghdadDateKey(value);
}

function normalizeLeaveType(value: unknown): StudentLeaveType {
  return value === "period" ? "period" : "exam";
}

function normalizeStudentLeave(
  leaveInput: Partial<StudentLeave> | Record<string, unknown>,
): StudentLeave {
  const leave = leaveInput as Partial<StudentLeave> & Record<string, unknown>;
  const leaveType = normalizeLeaveType(leave.leaveType);
  const date = dayKey(leave.date) || todayISO();
  const dateFrom = dayKey(leave.dateFrom) || date;
  const dateTo = dayKey(leave.dateTo) || dateFrom;
  const relatedStudent =
    leave.student && typeof leave.student === "object"
      ? (leave.student as Partial<Student>)
      : null;
  const relatedExam =
    leave.exam && typeof leave.exam === "object"
      ? (leave.exam as Partial<Exam>)
      : null;
  return {
    id: String(leave.id || ""),
    studentId: String(leave.studentId || relatedStudent?.id || ""),
    examId: String(leave.examId || relatedExam?.id || ""),
    leaveType,
    reason: String(leave.reason || ""),
    studyType: String(leave.studyType || relatedStudent?.studyType || ""),
    date,
    dateFrom: dateFrom <= dateTo ? dateFrom : dateTo,
    dateTo: dateFrom <= dateTo ? dateTo : dateFrom,
    notes: String(leave.notes || ""),
    student: relatedStudent,
    exam: relatedExam,
  };
}

function studentLeaveAppliesToExam(
  leave: StudentLeave,
  studentId: string,
  exam: Exam | undefined,
): boolean {
  if (!exam || leave.studentId !== studentId) return false;
  const normalized = normalizeStudentLeave(leave);
  if (normalized.leaveType === "period") {
    const examDate = dayKey(exam.date);
    return Boolean(
      examDate &&
      examDate >= normalized.dateFrom &&
      examDate <= normalized.dateTo,
    );
  }
  return normalized.examId === exam.id;
}

const syncFailureNoticeTimestamps = new Map<string, number>();

function getSyncErrorMessage(error: unknown): string {
  if (isFailedApiResult(error) && error.error?.trim()) return error.error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "تعذر حفظ التغيير في النظام. سيتم الاحتفاظ بالتغيير محلياً ومحاولة مزامنته لاحقاً.";
}

function notifySyncFailure(
  _getState: () => TeacherState,
  description: string,
  error: unknown,
): void {
  const message = getSyncErrorMessage(error);
  // لا نسجل كتحذير إلا للأخطاء غير العابرة. الأخطاء العابرة (شبكة، 5xx، 429)
  // تُطوى في outbox وتُعاد محاولتها تلقائياً، فلا داعي لإزعاج المستخدم ولا
  // لطباعتها بصوت عالٍ — هذا كان يخلي المستخدم يفكر الصفحة "تفصل".
  if (!isTransientSyncFailure(error)) {
    console.warn("[Store] Server sync failed:", description, error);
  }
  if (typeof window !== "undefined") {
    const now = Date.now();
    const transient = isTransientSyncFailure(error);
    // الأخطاء العابرة: نرفع الفاصل إلى 60 ثانية بدلاً من 15 ثانية. السبب:
    // المستخدم يدخل عشرات الدرجات بسرعة، وأي خطأ شبكي مؤقت كان يطلع toast
    // كل 15 ثانية ويوحي بأن الصفحة معطلة، بينما الدرجات محفوظة محلياً وستُزامن.
    // لذلك نكتم الأخطاء العابرة قدر الإمكان ونظهر فقط تكراراً نادراً جداً.
    const noticeKey = transient
      ? "__transient_sync__"
      : `${description}:${message}`;
    const minGapMs = transient ? 60000 : 4000;
    if (now - (syncFailureNoticeTimestamps.get(noticeKey) || 0) < minGapMs)
      return;
    syncFailureNoticeTimestamps.set(noticeKey, now);
    // للأخطاء العابرة، نرسل الحدث لكن برسالة أكثر هدوءاً حتى لا يظن المستخدم
    // أن شيئاً خطيراً حصل. الدرجات محفوظة محلياً وستُزامن تلقائياً.
    const displayMessage = transient
      ? description
        ? `${description}: تم تأجيل المزامنة، ستُعاد تلقائياً.`
        : "تم تأجيل المزامنة، ستُعاد تلقائياً."
      : description
        ? `${description}: ${message}`
        : message;
    window.dispatchEvent(
      new CustomEvent("teacherpro:server-sync-error", {
        detail: { message: displayMessage, transient },
      }),
    );
  }
}

function isFailedApiResult(
  result: unknown,
): result is ApiResult & { ok: false } {
  return Boolean(
    result &&
    typeof result === "object" &&
    "ok" in result &&
    (result as { ok?: unknown }).ok === false,
  );
}

function isTransientSyncFailure(error: unknown): boolean {
  if (isFailedApiResult(error)) return Boolean(error.transient);
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("failed to fetch") ||
      message.includes("تعذر الاتصال")
    );
  }
  return false;
}

function isQueuedResult(error: unknown): boolean {
  return isFailedApiResult(error) && Boolean((error as ApiResult).queued);
}

/**
 * Modules that are entirely server-only — the client may log them
 * locally for UI feedback but must NOT send them to POST /api/logs
 * (the server rejects them with 403).
 */
const SERVER_ONLY_LOG_MODULES = new Set([
  "أمان الحسابات",
  "النظام",
  "تصفير الlog",
  "الحسابات",
  "الصلاحيات",
  "الطلاب",
  "إدارة الفرص",
  "النسخ الاحتياطي",
]);

/**
 * Specific (module, action) pairs that are server-only even if the
 * module has some client-allowed actions.
 */
const SERVER_ONLY_LOG_ACTIONS = new Set([
  // Deletes
  "حذف دورة",
  "رفض حذف دورة",
  "حذف فصل",
  "رفض حذف فصل",
  "حذف ربط فصل بدورة",
  "تفعيل فصل ومنح فرص جديدة",
  "تفعيل فصل واسترجاع أرشيف الفرص",
  "إلغاء تفعيل فصل",
  "حذف طالب مع سجلاته التابعة",
  "رفض تعديل طالب مكرر",
  "رفض تسجيل طالب مكرر",
  "تراجع تسجيل طالب",
  "حذف امتحان مع سجلاته وإعادة احتساب التأثيرات",
  "حذف درجة",
  "رفض إدخال درجة لطالب مجاز",
  "حذف إجازة",
  // Large/sensitive actions
  "إضافة فرص جماعية",
  "خصم فرص جماعي",
  "تعديل فرص طالب",
  "إعادة تعيين فرص طالب",
  // Security
  "محاولة دخول مرفوضة",
  // Backup
  "تصدير نسخة احتياطية",
  "استيراد نسخة احتياطية",
]);

function isServerOnlyLogEntry(module: string, action: string): boolean {
  const m = module.trim();
  const a = action.trim();
  if (SERVER_ONLY_LOG_MODULES.has(m)) return true;
  if (SERVER_ONLY_LOG_ACTIONS.has(a)) return true;
  return false;
}

function syncToServer(
  getState: () => TeacherState,
  action: () => unknown,
  options: {
    description?: string;
    rollback?: () => void;
    onSuccess?: (result: unknown) => void;
    notify?: boolean;
    scopes?: string | string[];
  } = {},
): void {
  void Promise.resolve()
    .then(action)
    .then((result) => {
      if (isFailedApiResult(result)) {
        throw result;
      }
      options.onSuccess?.(result);
      if (options.notify !== false) {
        const resultScopes =
          result &&
          typeof result === "object" &&
          Array.isArray((result as ApiResult).syncScopes)
            ? (result as ApiResult).syncScopes
            : undefined;
        emitTeacherProDataChanged({
          source: "local-mutation",
          reason: options.description || "تحديث بيانات",
          scopes: options.scopes || resultScopes || "all",
        });
      }
    })
    .catch((error) => {
      // إذا كان الطلب مؤجلاً في outbox (queued)، لا نعرض خطأ ولا نرجع الحالة.
      // سيتم إعادة المحاولة تلقائياً عند عودة الشبكة.
      if (isQueuedResult(error)) return;

      // لا نرجع الحالة القديمة بسبب انقطاع شبكة/ضغط خادم مؤقت؛
      // الرجوع العشوائي كان يمسح درجات أُدخلت بعد الطلب الفاشل.
      if (!isTransientSyncFailure(error)) options.rollback?.();
      notifySyncFailure(getState, options.description || "", error);
    });
}

const PENDING_GRADE_SAVES_KEY = "teacherpro-pending-grade-saves-v1";
const MAX_PENDING_GRADE_SAVES = 5000;

type PendingGradeSave = Pick<
  Grade,
  | "id"
  | "studentId"
  | "examId"
  | "status"
  | "score"
  | "notes"
  | "academicAccountingChecked"
  | "createdAt"
  | "updatedAt"
> & { queuedAt: number };

let pendingGradeFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingGradeFlushInFlight = false;
let pendingGradeLastWarningAt = 0;

function pendingGradeKey(grade: Pick<Grade, "studentId" | "examId">): string {
  return `${grade.studentId}:${grade.examId}`;
}

function canUseGradeOutbox(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function normalizePendingGradeSave(item: unknown): PendingGradeSave | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const id = String(record.id || "").trim();
  const studentId = String(record.studentId || "").trim();
  const examId = String(record.examId || "").trim();
  const status = String(record.status || "درجة") as Grade["status"];
  if (!id || !studentId || !examId || !["درجة", "غائب", "غش"].includes(status))
    return null;

  const score =
    record.score === null || record.score === undefined || record.score === ""
      ? null
      : Number(record.score);

  return {
    id,
    studentId,
    examId,
    status,
    score:
      status === "درجة" && typeof score === "number" && Number.isFinite(score)
        ? score
        : null,
    notes: String(record.notes || ""),
    academicAccountingChecked: Boolean(record.academicAccountingChecked),
    createdAt: String(record.createdAt || todayISO()),
    updatedAt: String(record.updatedAt || todayISO()),
    queuedAt: Number(record.queuedAt || Date.now()),
  };
}

function readPendingGradeSaves(): PendingGradeSave[] {
  if (!canUseGradeOutbox()) return [];
  try {
    const raw = window.localStorage.getItem(PENDING_GRADE_SAVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePendingGradeSave)
      .filter((item): item is PendingGradeSave => Boolean(item));
  } catch (error) {
    console.warn("[Store] Failed to read pending grade saves:", error);
    return [];
  }
}

function writePendingGradeSaves(items: PendingGradeSave[]): void {
  if (!canUseGradeOutbox()) return;
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(PENDING_GRADE_SAVES_KEY);
      return;
    }
    window.localStorage.setItem(
      PENDING_GRADE_SAVES_KEY,
      JSON.stringify(items.slice(-MAX_PENDING_GRADE_SAVES)),
    );
  } catch (error) {
    console.warn("[Store] Failed to write pending grade saves:", error);
  }
}

function discardLegacyPendingGradeSaves(): void {
  if (!canUseGradeOutbox()) return;
  try {
    // هذا الطابور القديم لا يحمل CAS أو idempotency، لذلك لا يجوز إعادة
    // بثه فوق درجات أحدث. مصدر الحقيقة الوحيد من الآن هو الخادم.
    window.localStorage.removeItem(PENDING_GRADE_SAVES_KEY);
  } catch (error) {
    console.warn("[Store] Failed to discard legacy pending grade saves:", error);
  }
}

function gradeSaveForApi(item: PendingGradeSave): Record<string, unknown> {
  return {
    clientId: item.id,
    studentId: item.studentId,
    examId: item.examId,
    status: item.status,
    score: item.score,
    notes: item.notes,
    academicAccountingChecked: item.academicAccountingChecked,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function removeFlushedPendingGradeSaves(sent: PendingGradeSave[]): void {
  const sentByKey = new Map(
    sent.map((item) => [pendingGradeKey(item), item.queuedAt]),
  );
  const remaining = readPendingGradeSaves().filter(
    (item) => sentByKey.get(pendingGradeKey(item)) !== item.queuedAt,
  );
  writePendingGradeSaves(remaining);
}

function notifyPendingGradeSyncIssue(
  getState: () => TeacherState,
  result: ApiResult,
): void {
  const now = Date.now();
  if (now - pendingGradeLastWarningAt < 15000) return;
  pendingGradeLastWarningAt = now;
  notifySyncFailure(
    getState,
    "مزامنة الدرجات المؤجلة",
    result.error ||
      "تعذر الاتصال بالشبكة. الدرجات محفوظة مؤقتاً وستُعاد المحاولة تلقائياً.",
  );
}

async function flushPendingGradeSaves(
  getState: () => TeacherState,
): Promise<void> {
  if (!canUseGradeOutbox()) return;
  if (pendingGradeFlushInFlight) return;

  const pending = readPendingGradeSaves();
  if (pending.length === 0) return;

  pendingGradeFlushInFlight = true;
  try {
    const chunk = pending.slice(0, 25);
    const flushed: PendingGradeSave[] = [];
    // الدرجات اللي فشلت بـ 400 (permanent) — لازم تنحذف من الـ outbox
    // لأنها ما راح تنجح أبداً (مثلاً: طالب مفصول).
    const permanentlyFailed: PendingGradeSave[] = [];
    let lastTransientFailure: ApiResult | null = null;

    for (const item of chunk) {
      const result = await gradeApi.add(gradeSaveForApi(item));
      if (!result.ok) {
        if (result.transient) {
          // خطأ عابر (شبكة/5xx/429) — أعد المحاولة لاحقاً
          lastTransientFailure = result;
          break;
        } else {
          // خطأ دائم (400/403/404) — احذف الدرجة من الـ outbox لأنها
          // ما راح تنجح أبداً. مثلاً: "الطالب مفصول ولا يمكن إدخال درجات له"
          permanentlyFailed.push(item);
          continue;
        }
      }
      flushed.push(item);
    }

    if (flushed.length > 0) {
      removeFlushedPendingGradeSaves(flushed);
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: `مزامنة ${flushed.length} درجة مؤجلة`,
        scopes: ["grades", "students", "opportunities", "dashboard"],
      });
    }
    if (permanentlyFailed.length > 0) {
      removeFlushedPendingGradeSaves(permanentlyFailed);
      // أظهر toast مرة وحدة لإعلام المستخدم
      if (typeof window !== "undefined") {
        const names = permanentlyFailed
          .map((p) => {
            const st = getState().students.find((s) => s.id === p.studentId);
            return st?.name || p.studentId;
          })
          .slice(0, 3);
        console.warn(
          "[grade-outbox] تم حذف درجات مؤجلة فشلت بشكل دائم (طالب مفصول أو غيره):",
          names.join("، ") +
            (permanentlyFailed.length > 3
              ? ` (+${permanentlyFailed.length - 3})`
              : ""),
        );
      }
    }

    const remaining = readPendingGradeSaves();
    if (!lastTransientFailure) {
      if (remaining.length > 0) schedulePendingGradeFlush(getState, 300);
      return;
    }

    notifyPendingGradeSyncIssue(getState, lastTransientFailure);
    if (remaining.length > 0) schedulePendingGradeFlush(getState, 5000);
  } finally {
    pendingGradeFlushInFlight = false;
  }
}

function schedulePendingGradeFlush(
  getState: () => TeacherState,
  delayMs = 700,
): void {
  if (!canUseGradeOutbox()) return;
  if (pendingGradeFlushTimer) clearTimeout(pendingGradeFlushTimer);
  pendingGradeFlushTimer = setTimeout(() => {
    pendingGradeFlushTimer = null;
    void flushPendingGradeSaves(getState);
  }, delayMs);
}

type PersistedUiSnapshot = Pick<
  TeacherState,
  | "theme"
  | "studentPageSize"
  | "gradePageSize"
  | "currentUserId"
  | "currentSection"
>;

function toPersistedUiSnapshot(
  state: Partial<TeacherState> | Record<string, unknown>,
): PersistedUiSnapshot {
  const theme = state.theme === "dark" ? "dark" : "light";
  const studentPageSize = Number(state.studentPageSize || 10);
  const gradePageSize = Number(state.gradePageSize || 10);
  const currentUserId =
    typeof state.currentUserId === "string" && state.currentUserId.trim()
      ? state.currentUserId
      : "u_admin";
  const persistedSection =
    state.currentSection === "dismissed-students" ||
    state.currentSection === "follow-up-pledges"
      ? "dismissed-management"
      : state.currentSection;
  const currentSection =
    typeof persistedSection === "string" &&
    Object.prototype.hasOwnProperty.call(
      SECTION_PERMISSIONS,
      persistedSection,
    )
      ? (persistedSection as SectionId)
      : "dashboard";

  return {
    theme,
    studentPageSize:
      Number.isFinite(studentPageSize) && studentPageSize > 0
        ? studentPageSize
        : 10,
    gradePageSize:
      Number.isFinite(gradePageSize) && gradePageSize > 0 ? gradePageSize : 10,
    currentUserId,
    currentSection,
  };
}

// Latest-request-wins guards. A slower request that started before a newer
// sync must never overwrite the newer server state.
let loadAllRequestSequence = 0;
const sectionLoadRequestSequence = new Map<SectionId, number>();

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTeacherStore = create<TeacherState>()(
  persist(
    (set, get) => ({
      ...seedData(),

      currentSection: "dashboard" as SectionId,
      sidebarOpen: false,
      theme: "light" as "light" | "dark",
      studentPageSize: 10,
      gradePageSize: 10,
      currentUserId: "u_admin",
      isAuthenticated: false,
      dbConnected: false,
      dbLoading: false,

      mergeStudentsCache: (incomingStudents) => {
        const normalized = incomingStudents.map((student) =>
          normalizeStudentRecord(student as unknown as Record<string, unknown>),
        );
        set((s) => ({ students: mergeRecordsById(s.students, normalized) }));
      },

      mergeGradesCache: (incomingGrades) => {
        const normalized = incomingGrades.map((grade) =>
          normalizeGradeRecord(grade as unknown as Record<string, unknown>),
        );
        set((s) => ({ grades: mergeGradesByIdentity(s.grades, normalized) }));
      },

      loadFromServer: async () => {
        discardLegacyPendingGradeSaves();
        const requestSequence = ++loadAllRequestSequence;
        const isInitialLoad = !get().dbConnected;
        if (isInitialLoad) {
          set({ dbLoading: true });
        } else {
          announceTeacherProSyncRefreshing(["core"]);
        }
        try {
          const serverData = await loadAllFromServer();
          if (requestSequence !== loadAllRequestSequence) return false;
          if (!serverData) {
            if (requestSequence === loadAllRequestSequence) {
              set({ dbLoading: false, dbConnected: false });
              if (!isInitialLoad) {
                announceTeacherProSyncError("تعذر تحديث البيانات في الخلفية");
              }
            }
            return false;
          }

          const serverCourses = (serverData.courses || []).map(
            (c: Record<string, unknown>) => ({
              ...c,
              createdAt: c.createdAt
                ? baghdadDateKey(c.createdAt as string | Date) || todayISO()
                : todayISO(),
              active: c.active !== undefined ? Boolean(c.active) : true,
              availablePrograms: parseJsonArray<string>(c.availablePrograms),
              availableStudyTypes: getAvailableStudyTypes(c),
              studyTypesByProgram: getStudyTypesByProgram(c),
              locationConfig: parseJsonRecord<CourseLocationConfig>(
                c.locationConfig,
                {},
              ),
            }),
          ) as Course[];
          const courses = mergeDefaultCourses(serverCourses);

          const chapters = (serverData.chapters || []).map(
            (ch: Record<string, unknown>) => ({
              ...ch,
              opportunities: Number(ch.opportunities || 0),
            }),
          ) as Chapter[];

          const courseChapters = serverData.courseChapters
            ? (serverData.courseChapters.map((cc: Record<string, unknown>) => ({
                ...cc,
                active: Boolean(cc.active),
                archived: Boolean(cc.archived),
                archive: parseArrayField<ArchiveEntry>(cc.archive),
              })) as CourseChapter[])
            : get().courseChapters;

          const students = serverData.students
            ? serverData.students.map((st: Record<string, unknown>) =>
                normalizeStudentRecord(st),
              )
            : get().students;

          const exams = (serverData.exams || []).map(
            (ex: Record<string, unknown>) => {
              const { groupId: _groupId, ...examData } = ex;
              void _groupId;
              return {
                ...examData,
                courseIds: parseArrayField<string>(ex.courseIds),
                examCourses: ex.examCourses as Exam["examCourses"],
                mainSite: ex.mainSite ? String(ex.mainSite) : "",
                fullMark: Number(ex.fullMark || 100),
                passMark: Number(ex.passMark || 50),
                discountMark: Number(ex.discountMark || 0),
                opportunitiesPenalty: Number(ex.opportunitiesPenalty || 0),
                dismissalGrade:
                  ex.dismissalGrade === null || ex.dismissalGrade === undefined
                    ? null
                    : Number(ex.dismissalGrade),
                noDiscount: Boolean(ex.noDiscount),
                active: Boolean(ex.active),
                scheduledActivateAt: normalizeDateTimeValue(
                  ex.scheduledActivateAt,
                ),
                date: ex.date
                  ? baghdadDateKey(ex.date as string | Date) || todayISO()
                  : todayISO(),
              };
            },
          ) as Exam[];

          // بيانات الخادم هي المرجع. لا ندمج outbox الدرجات القديم فوقها؛
          // ذلك كان يعرض مسودة محلية كأنها درجة محفوظة ثم تختفي لاحقاً.
          const grades = serverData.grades
            ? serverData.grades.map((g: Record<string, unknown>) =>
                normalizeGradeRecord(g),
              )
            : get().grades;

          const opportunityLogs = serverData.opportunityLogs
            ? (serverData.opportunityLogs.map(
                (ol: Record<string, unknown>) => ({
                  ...ol,
                  amount: Number(ol.amount || 0),
                  date: ol.date
                    ? new Date(ol.date as string).toISOString()
                    : todayISO(),
                }),
              ) as OpportunityLog[])
            : get().opportunityLogs;

          const studentLeaves = serverData.studentLeaves
            ? serverData.studentLeaves.map((leave: Record<string, unknown>) =>
                normalizeStudentLeave({
                  ...leave,
                  date: leave.date
                    ? baghdadDateKey(leave.date as string | Date) || todayISO()
                    : todayISO(),
                  dateFrom: leave.dateFrom
                    ? baghdadDateKey(leave.dateFrom as string | Date) || todayISO()
                    : leave.date
                      ? baghdadDateKey(leave.date as string | Date) || todayISO()
                      : todayISO(),
                  dateTo: leave.dateTo
                    ? baghdadDateKey(leave.dateTo as string | Date) || todayISO()
                    : leave.date
                      ? baghdadDateKey(leave.date as string | Date) || todayISO()
                      : todayISO(),
                }),
              )
            : get().studentLeaves;

          const studentCalls = serverData.studentCalls
            ? (serverData.studentCalls.map((call: Record<string, unknown>) => ({
                ...call,
                examId: String(call.examId || ""),
                status: String(
                  call.status || (call.completed ? "تم الاتصال" : "لم يرد"),
                ),
                completed: Boolean(call.completed),
                completedAt: call.completedAt ? String(call.completedAt) : "",
                createdAt: call.createdAt
                  ? baghdadDateKey(call.createdAt as string | Date) || todayISO()
                  : todayISO(),
                notes: String(call.notes || ""),
              })) as StudentCall[])
            : get().studentCalls;

          const studentNotes = serverData.studentNotes
            ? (serverData.studentNotes.map((note: Record<string, unknown>) => ({
                ...note,
                kind: String(note.kind || ""),
                text: String(note.text || ""),
                sourceType: String(note.sourceType || ""),
                sourceId: String(note.sourceId || ""),
                dismissalKey: String(note.dismissalKey || ""),
                dismissalReason: String(note.dismissalReason || ""),
                dismissalDate: note.dismissalDate
                  ? baghdadDateKey(note.dismissalDate as string | Date)
                  : "",
                date: note.date
                  ? baghdadDateKey(note.date as string | Date) || todayISO()
                  : todayISO(),
              })) as StudentNote[])
            : get().studentNotes;

          const parsedUsers = (serverData.users || []).map(
            (u: Record<string, unknown>) => ({
              ...u,
              // Passwords are no longer returned by the API. Keep this field empty
              // in client state unless the user explicitly enters a new password.
              password: undefined,
              permissions: sanitizePermissionIds(
                parseArrayField<string>(u.permissions),
              ),
              active: u.active !== undefined ? Boolean(u.active) : true,
            }),
          ) as User[];
          const seedUsers = seedData().users;
          const adminSeed = seedUsers.find(
            (u: User) => u.username === ADMIN_USERNAME,
          )!;
          const previousSessionUser = get().users.find(
            (u) => u.id === get().currentUserId,
          );
          const keepAdminSession =
            get().isAuthenticated && hasFullAdminAccess(previousSessionUser);

          let users = serverData.users ? parsedUsers : get().users;
          if (!users.length) users = seedUsers;
          const hasPrimaryAdmin = users.some((u: User) =>
            isPrimaryAdminUser(u),
          );
          users = hasPrimaryAdmin
            ? users.map((u: User) => normalizeAdminAccessUser(u))
            : [...users, { ...adminSeed }];
          users = users.map((u: User) => normalizeAdminAccessUser(u));

          const parsedRoles = (serverData.roles || []).map(
            (r: Record<string, unknown>) => ({
              ...r,
              permissions: sanitizePermissionIds(
                parseArrayField<string>(r.permissions),
              ),
              isDefault: Boolean(r.isDefault),
            }),
          ) as Role[];
          const roles = serverData.roles ? mergeDefaultRoles(parsedRoles) : get().roles;
          const loadedAdmin =
            users.find((u) => isPrimaryAdminUser(u) && u.active) ||
            users.find((u) => u.roleId === ADMIN_ROLE_ID && u.active);
          const currentUserStillExists = users.some(
            (u) => u.id === get().currentUserId && u.active,
          );
          const nextCurrentUserId =
            keepAdminSession && loadedAdmin
              ? loadedAdmin.id
              : currentUserStillExists
                ? get().currentUserId
                : get().isAuthenticated && loadedAdmin
                  ? loadedAdmin.id
                  : get().currentUserId;

          const logs = serverData.logs
            ? (serverData.logs.map((l: Record<string, unknown>) => ({
                id: String(l.id || uid("log")),
                user: String(l.user || l.userName || "مدير النظام"),
                module: String(l.module || ""),
                action: String(l.action || ""),
                details: String(l.details || ""),
                time: l.time ? String(l.time) : nowText(),
              })) as LogEntry[])
            : get().logs;

          if (requestSequence !== loadAllRequestSequence) return false;
          set({
            courses,
            chapters,
            courseChapters,
            students,
            exams,
            grades,
            opportunityLogs,
            studentLeaves,
            studentCalls,
            studentNotes,
            users,
            roles,
            logs,
            currentUserId: nextCurrentUserId,
            dbConnected: true,
            dbLoading: false,
          });
          if (!isInitialLoad) announceTeacherProSyncSettled(["core"]);

          // Note: we no longer auto-sync the admin user's role/permissions
          // on every load. That update required accounts.manage permission
          // which non-admin users (like supervisors) don't have, causing
          // 403 errors on every page load for them. The admin role is
          // managed via env vars + the accounts UI, not auto-overwritten.
          return true;
        } catch (e) {
          console.warn("[Store] Failed to load from server:", e);
          if (requestSequence === loadAllRequestSequence) {
            set({ dbLoading: false, dbConnected: false });
            if (!isInitialLoad) {
              announceTeacherProSyncError("تعذر تحديث البيانات في الخلفية");
            }
          }
          return false;
        }
      },

      loadSectionDataFromServer: async (section) => {
        if (!get().isAuthenticated) return;

        const requestSequence =
          (sectionLoadRequestSequence.get(section) || 0) + 1;
        sectionLoadRequestSequence.set(section, requestSequence);
        const nextState: Partial<TeacherState> = {};

        try {
          if (section === "courses") {
            const data = await courseApi.list();
            if (data?.courses) {
              const serverCourses = data.courses.map((c: Record<string, unknown>) => ({
                ...c,
                createdAt: c.createdAt
                  ? baghdadDateKey(c.createdAt as string | Date) || todayISO()
                  : todayISO(),
                active: c.active !== undefined ? Boolean(c.active) : true,
                availablePrograms: parseJsonArray<string>(c.availablePrograms),
                availableStudyTypes: getAvailableStudyTypes(c),
                studyTypesByProgram: getStudyTypesByProgram(c),
                locationConfig: parseJsonRecord<CourseLocationConfig>(c.locationConfig, {}),
              })) as Course[];
              nextState.courses = mergeDefaultCourses(serverCourses);
            }
          }

          if (
            [
              "courses",
              "chapters",
              "exam-new",
              "exam-records",
              "grade-entry",
              "student-register",
              "student-bulk-import",
              "student-registry",
              "opportunities",
              "follow-up",
              "follow-up-calls",
              "follow-up-leaves",
            ].includes(section)
          ) {
            const data = await courseChapterApi.list();
            if (data?.courseChapters) {
              nextState.courseChapters = data.courseChapters.map(
                (cc: Record<string, unknown>) => ({
                  ...cc,
                  active: Boolean(cc.active),
                  archived: Boolean(cc.archived),
                  archive: parseArrayField<ArchiveEntry>(cc.archive),
                }),
              ) as CourseChapter[];
            }
          }

          if (section === "opportunities") {
            const data = await opportunityLogApi.list();
            if (data?.opportunityLogs) {
              nextState.opportunityLogs = data.opportunityLogs.map(
                (ol: Record<string, unknown>) => ({
                  ...ol,
                  amount: Number(ol.amount || 0),
                  date: ol.date
                    ? new Date(ol.date as string).toISOString()
                    : todayISO(),
                }),
              ) as OpportunityLog[];
            }
          }

          if (
            [
              "follow-up",
              "follow-up-calls",
              "follow-up-leaves",
            ].includes(section)
          ) {
            const [leavesData, callsData, notesData] = await Promise.all([
              studentLeaveApi.list(),
              studentCallApi.list(),
              studentNoteApi.list(),
            ]);
            if (leavesData?.studentLeaves) {
              nextState.studentLeaves = leavesData.studentLeaves.map(
                (leave: Record<string, unknown>) =>
                  normalizeStudentLeave({
                    ...leave,
                    date: leave.date
                      ? baghdadDateKey(leave.date as string | Date) || todayISO()
                      : todayISO(),
                    dateFrom: leave.dateFrom
                      ? baghdadDateKey(leave.dateFrom as string | Date) || todayISO()
                      : leave.date
                        ? baghdadDateKey(leave.date as string | Date) || todayISO()
                        : todayISO(),
                    dateTo: leave.dateTo
                      ? baghdadDateKey(leave.dateTo as string | Date) || todayISO()
                      : leave.date
                        ? baghdadDateKey(leave.date as string | Date) || todayISO()
                        : todayISO(),
                  }),
              );
            }
            if (callsData?.studentCalls) {
              nextState.studentCalls = callsData.studentCalls.map(
                (call: Record<string, unknown>) => ({
                  ...call,
                  examId: String(call.examId || ""),
                  status: String(
                    call.status || (call.completed ? "تم الاتصال" : "لم يرد"),
                  ),
                  completed: Boolean(call.completed),
                  completedAt: call.completedAt ? String(call.completedAt) : "",
                  createdAt: call.createdAt
                    ? baghdadDateKey(call.createdAt as string | Date) || todayISO()
                    : todayISO(),
                  notes: String(call.notes || ""),
                }),
              ) as StudentCall[];
            }
            if (notesData?.studentNotes) {
              nextState.studentNotes = notesData.studentNotes.map(
                (note: Record<string, unknown>) => ({
                  ...note,
                  kind: String(note.kind || ""),
                  text: String(note.text || ""),
                  sourceType: String(note.sourceType || ""),
                  sourceId: String(note.sourceId || ""),
                  dismissalKey: String(note.dismissalKey || ""),
                    dismissalReason: String(note.dismissalReason || ""),
                  dismissalDate: note.dismissalDate
                    ? baghdadDateKey(note.dismissalDate as string | Date)
                    : "",
                  date: note.date
                    ? baghdadDateKey(note.date as string | Date) || todayISO()
                    : todayISO(),
                }),
              ) as StudentNote[];
            }
          }

          if (section === "logs" || section === "admin-log-reset") {
            const data = await logApi.list();
            if (data?.logs) {
              nextState.logs = data.logs.map((l: Record<string, unknown>) => ({
                id: String(l.id || uid("log")),
                user: String(l.user || l.userName || "مدير النظام"),
                module: String(l.module || ""),
                action: String(l.action || ""),
                details: String(l.details || ""),
                time: l.time ? String(l.time) : nowText(),
              })) as LogEntry[];
            }
          }

          if (
            sectionLoadRequestSequence.get(section) === requestSequence &&
            Object.keys(nextState).length > 0
          ) {
            set(nextState);
          }
        } catch (error) {
          console.warn(
            "[Store] Failed to lazy-load section data:",
            section,
            error,
          );
        }
      },

      setSection: (section) => {
        const state = get();
        if (!state.canAccess(section)) {
          state.logAction("الصلاحيات", "محاولة دخول مرفوضة", section);
          return;
        }
        if (state.currentSection === section && !state.sidebarOpen) return;
        set({ currentSection: section, sidebarOpen: false });
      },
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === "dark" ? "light" : "dark";
          if (typeof document !== "undefined") {
            document.documentElement.classList.toggle("dark", next === "dark");
          }
          return { theme: next };
        }),

      currentUser: () => {
        const state = get();
        const user =
          state.users.find((u) => u.id === state.currentUserId && u.active) ||
          (state.isAuthenticated
            ? state.users.find((u) => isPrimaryAdminUser(u) && u.active)
            : undefined) ||
          null;
        return user ? normalizeAdminAccessUser(user) : null;
      },
      restoreSession: async () => {
        const wasAuthenticated = get().isAuthenticated;
        const authResult = await authApi.session();

        // Do not force logout an already-open session because of a temporary
        // network/server/database error. Only an explicit empty session means
        // the cookie is missing/expired and the user should return to login.
        if (!authResult.ok) {
          console.warn(
            "[Store] Session check failed:",
            authResult.error || authResult.status || "unknown error",
          );
          if (wasAuthenticated) return true;
          setOutboxOwner(null);
          set({ isAuthenticated: false });
          return false;
        }

        if (!authResult.user) {
          setOutboxOwner(null);
          set({ isAuthenticated: false });
          return false;
        }

        const sessionUser = normalizeAdminAccessUser(
          userFromAuthApi(authResult.user),
        );
        setOutboxOwner(sessionUser.id);
        const previousUserId = get().currentUserId;
        set((s) => ({
          users: s.users.some((u) => u.id === sessionUser.id)
            ? s.users.map((u) =>
                u.id === sessionUser.id
                  ? { ...u, ...sessionUser }
                  : normalizeAdminAccessUser(u),
              )
            : [...s.users.map((u) => normalizeAdminAccessUser(u)), sessionUser],
          roles: mergeDefaultRoles(s.roles),
          currentUserId: sessionUser.id,
          isAuthenticated: true,
          students: previousUserId !== sessionUser.id ? [] : s.students,
          grades: previousUserId !== sessionUser.id ? [] : s.grades,
        }));
        return true;
      },
      login: async (username, password) => {
        const authResult = await authApi.login(username, password);
        if (!authResult.ok || !authResult.user) {
          return {
            ok: false,
            message:
              authResult.error || "اسم المستخدم أو كلمة المرور غير صحيحة",
          };
        }

        const sessionUser = normalizeAdminAccessUser(
          userFromAuthApi(authResult.user),
        );
        setOutboxOwner(sessionUser.id);
        set((s) => ({
          users: s.users.some((u) => u.id === sessionUser.id)
            ? s.users.map((u) =>
                u.id === sessionUser.id
                  ? { ...u, ...sessionUser }
                  : normalizeAdminAccessUser(u),
              )
            : [...s.users.map((u) => normalizeAdminAccessUser(u)), sessionUser],
          roles: mergeDefaultRoles(s.roles),
          currentUserId: sessionUser.id,
          isAuthenticated: true,
          currentSection: "dashboard",
          students: [],
          grades: [],
        }));

        // loadFromServer() is handled by the layout's useEffect when isAuthenticated becomes true.
        // Calling it here too causes a double-load that triggers React #185 infinite re-render.
        get().logAction("تسجيل الدخول", "دخول للنظام", sessionUser.name);
        if (authResult.passwordWeak) {
          window.dispatchEvent(new CustomEvent("teacherpro:weak-password"));
        }
        return { ok: true, message: "تم تسجيل الدخول بنجاح" };
      },
      canAccess: (section) => {
        if (!get().isAuthenticated) return false;
        const user = get().currentUser();
        if (!user) return false;
        if (ADMIN_ONLY_SECTIONS.has(section as SectionId))
          return hasFullAdminAccess(user);
        // Admin user always has full access to every section and tab.
        if (hasFullAdminAccess(user)) return true;
        // Check if user has the required permission for this section
        const requiredPermission = SECTION_PERMISSIONS[section as SectionId];
        if (!requiredPermission) return false;
        if (user.permissions.includes(requiredPermission)) return true;
        return (SECTION_PERMISSION_EQUIVALENTS[section as SectionId] || []).some(
          (permission) => user.permissions.includes(permission),
        );
      },
      logout: () => {
        setOutboxOwner(null);
        void authApi.logout();
        const admin =
          get().users.find((u) => isPrimaryAdminUser(u) && u.active) ||
          get().users.find((u) => u.roleId === ADMIN_ROLE_ID && u.active);
        set({
          currentUserId: admin?.id || "u_admin",
          currentSection: "dashboard",
          isAuthenticated: false,
          students: [],
          grades: [],
        });
        get().logAction("تسجيل الدخول", "تسجيل خروج", "إغلاق جلسة المستخدم");
      },

      courseName: (id) =>
        get().courses.find((c) => c.id === id)?.name || "غير محدد",
      chapterName: (id) =>
        get().chapters.find((c) => c.id === id)?.name || "غير محدد",
      studentName: (id) =>
        get().students.find((s) => s.id === id)?.name || "غير محدد",
      userName: (id) =>
        get().users.find((u) => u.id === id)?.name || id || "غير محدد",
      activeChapterForCourse: (courseId) => {
        const cc = get().courseChapters.find(
          (x) => x.courseId === courseId && x.active && !x.archived,
        );
        return cc
          ? get().chapters.find((c) => c.id === cc.chapterId) || null
          : null;
      },
      classification: (grade, exam, student) => {
        if (grade?.academicEffectExcluded || grade?.effectiveImpactExcluded || (grade && gradeSettlementExclusion(grade, exam, get().opportunityLogs, student ? get().activeChapterForCourse(student.courseId)?.id : undefined, student?.courseId)))
          return {
            text: "توثيق فقط - بلا أثر أكاديمي",
            type: "info",
            kind: "academic-effect-excluded",
          };
        if (
          student &&
          get().studentLeaves.some((leave) =>
            studentLeaveAppliesToExam(leave, student.id, exam),
          )
        )
          return { text: "مجاز", type: "info", kind: "excused" };
        // ROOT-CAUSE FIX (الإصلاح الرابع): if the grade itself carries
        // status="مجاز", classify it as "مجاز" regardless of whether a
        // matching StudentLeave record is loaded in the store. Previously,
        // a grade with status="مجاز" but no StudentLeave in the store
        // would fall through to the score-based checks. For a final exam
        // (type="فاينل") with score=null→0, this would incorrectly return
        // "فصل" — exactly the bug reported for روان ياسر عبدالاله علوان
        // (BIO-2401) on 2026-08-20.
        //
        // This also defends against any historical row where status="مجاز"
        // was set without creating a StudentLeave record (e.g., the
        // 20260820110000 migration converted غائب→مجاز but did not create
        // the corresponding StudentLeave rows).
        if (grade?.status === "مجاز")
          return { text: "مجاز", type: "info", kind: "excused" };
        if (!grade || !isGradeEntered(grade, exam))
          return { text: "غير مسجل", type: "neutral", kind: "missing" };
        if (student && !isExamOnOrAfterStudentRegistration(student, exam))
          return { text: "قبل التسجيل", type: "info", kind: "before-registration" };
        if (!getExamEntryAvailability(exam).available)
          return { text: "غير محتسب", type: "info", kind: "unavailable-exam" };
        if (student && isExamWithinStudentGracePeriod(student, exam))
          return { text: "ضمن السماح", type: "info", kind: "grace" };
        // Same defensive guard for "ضمن فترة السماح" and "قبل تسجيل الطالب"
        // — these are server-set marker statuses and should never fall
        // through to the score-based checks.
        if (grade.status === "ضمن فترة السماح")
          return { text: "ضمن السماح", type: "info", kind: "grace" };
        if (grade.status === "قبل تسجيل الطالب")
          return { text: "قبل التسجيل", type: "info", kind: "before-registration" };
        if (grade.status === "غش")
          return { text: "غش", type: "danger", kind: "cheat" };
        if (exam.noDiscount) {
          if (
            grade.status === "درجة" &&
            Number(grade.score || 0) >= exam.passMark
          )
            return { text: "ناجح", type: "ok", kind: "pass" };
          return { text: "بدون خصم", type: "info", kind: "no-discount" };
        }
        if (grade.status === "غائب") {
          if (exam.type === "فاينل")
            return { text: "فصل", type: "danger", kind: "dismissal" };
          return { text: "مخصوم", type: "danger", kind: "deducted" };
        }
        const score = Number(grade.score) || 0;
        if (exam.type === "فاينل") {
          if (
            score === 0 ||
            (exam.dismissalGrade !== null && score <= exam.dismissalGrade)
          )
            return { text: "فصل", type: "danger", kind: "dismissal" };
          if (score >= exam.passMark)
            return { text: "ناجح", type: "ok", kind: "pass" };
          return { text: "راسب", type: "danger", kind: "fail" };
        }
        if (score >= exam.passMark)
          return { text: "ناجح", type: "ok", kind: "pass" };
        if (score > exam.discountMark && score < exam.passMark)
          return {
            text: "محاسبة رسوب",
            type: "warn",
            kind: "academic-accounting",
          };
        return { text: "مخصوم", type: "danger", kind: "deducted" };
      },

      logAction: (module, action, details = "") => {
        const currentUser = get().currentUser();
        const user = currentUser?.name || "مدير النظام";
        const log: LogEntry = {
          id: uid("log"),
          user,
          module,
          action,
          details,
          time: nowText(),
        };
        set((s) => ({ logs: [log, ...s.logs] }));

        // لا نحاول إرسال السجل قبل تسجيل الدخول؛ هذا يمنع أخطاء 401 المتكررة
        // عند فتح الصفحة أو بعد تسجيل الخروج، مع إبقاء السجل محفوظاً محلياً.
        if (!get().isAuthenticated || !currentUser?.id) return;

        // تخطّي إرسال السجلات server-only للخادم؛ النظام يرفضها بـ 403
        // (لأنها حساسة ويجب أن تُكتب من الـ server handler فقط).
        // نبقيها محلية للـ UI feedback فقط.
        if (isServerOnlyLogEntry(module, action)) return;

        syncToServer(
          get,
          () => logApi.add({ ...log, userName: user, userId: currentUser.id }),
          {
            notify: false,
            onSuccess: () =>
              emitTeacherProLogsChangedDebounced("تحديث السجلات"),
          },
        );
      },

      addUser: (userData) => {
        const user: User = {
          ...userData,
          id: uid("u"),
          password: userData.password || "123456",
        };
        set((s) => ({ users: [...s.users, user] }));
        get().logAction("الحسابات", "إضافة مستخدم", user.name);
        syncToServer(get, () =>
          userApi.add({ ...user, permissions: user.permissions }),
        );
      },
      updateUser: (id, updates) => {
        const existingUser = get().users.find((u) => u.id === id);
        const safeUpdates =
          existingUser && isPrimaryAdminUser(existingUser)
            ? {
                ...updates,
                active: true,
                roleId: ADMIN_ROLE_ID,
                role: ADMIN_ROLE_NAME,
                permissions: ADMIN_FULL_PERMISSIONS,
              }
            : updates;
        set((s) => ({
          users: s.users.map((u) =>
            u.id === id
              ? normalizeAdminAccessUser({ ...u, ...safeUpdates })
              : u,
          ),
        }));
        get().logAction("الحسابات", "تعديل مستخدم", get().userName(id));
        syncToServer(get, () =>
          userApi.update(id, safeUpdates as Record<string, unknown>),
        );
      },
      toggleUser: (id) => {
        const user = get().users.find((u) => u.id === id);
        if (!user || isPrimaryAdminUser(user)) {
          get().logAction("الحسابات", "منع تعطيل المدير", user?.name || id);
          return;
        }
        set((s) => ({
          users: s.users.map((u) =>
            u.id === id ? { ...u, active: !u.active } : u,
          ),
        }));
        get().logAction(
          "الحسابات",
          user.active ? "تعطيل مستخدم" : "تفعيل مستخدم",
          user.name || id,
        );
        syncToServer(get, () => userApi.update(id, { active: !user.active }));
      },
      updateUserPermissions: (id, permissions) => {
        const user = get().users.find((u) => u.id === id);
        const nextPermissions =
          user && hasFullAdminAccess(user)
            ? [...ADMIN_FULL_PERMISSIONS]
            : sanitizePermissionIds(permissions);
        set((s) => ({
          users: s.users.map((u) =>
            u.id === id
              ? normalizeAdminAccessUser({ ...u, permissions: nextPermissions })
              : u,
          ),
        }));
        get().logAction("الحسابات", "تحديث صلاحيات", get().userName(id));
        syncToServer(get, () =>
          userApi.update(id, { permissions: nextPermissions }),
        );
      },
      deleteUser: (id) => {
        const state = get();
        const user = state.users.find((u) => u.id === id);
        if (!user || user.roleId === "role_admin" || state.currentUserId === id)
          return false;
        set((s) => ({ users: s.users.filter((u) => u.id !== id) }));
        get().logAction("الحسابات", "حذف مستخدم", user.name);
        syncToServer(get, () => userApi.remove(id));
        return true;
      },

      addRole: (roleData) => {
        const role: Role = { ...roleData, id: uid("role") };
        set((s) => ({ roles: [...s.roles, role] }));
        get().logAction("الحسابات", "إضافة دور", role.name);
        syncToServer(get, () =>
          roleApi.add(role as unknown as Record<string, unknown>),
        );
      },
      updateRole: (id, updates) => {
        const safeUpdates =
          id === ADMIN_ROLE_ID
            ? {
                ...updates,
                name: ADMIN_ROLE_NAME,
                isDefault: true,
                permissions: ADMIN_FULL_PERMISSIONS,
              }
            : updates;
        set((s) => ({
          roles: mergeDefaultRoles(
            s.roles.map((r) => (r.id === id ? { ...r, ...safeUpdates } : r)),
          ),
        }));
        get().logAction("الحسابات", "تعديل دور", id);
        syncToServer(get, () =>
          roleApi.update(id, safeUpdates as Record<string, unknown>),
        );
      },
      deleteRole: (id) => {
        const state = get();
        const role = state.roles.find((r) => r.id === id);
        if (!role || role.isDefault) return false;
        // Reassign users with this role to viewer
        const users = state.users.map((u) =>
          u.roleId === id
            ? {
                ...u,
                roleId: "role_viewer",
                role: "مشاهدة فقط",
                permissions: [...ALL_VIEW_PERMISSION_IDS],
              }
            : u,
        );
        set((s) => ({ roles: s.roles.filter((r) => r.id !== id), users }));
        get().logAction("الحسابات", "حذف دور", role.name);
        // Sync updated users to DB
        users
          .filter(
            (u) =>
              u.roleId === "role_viewer" &&
              state.users.find((su) => su.id === u.id && su.roleId === id),
          )
          .forEach((u) =>
            syncToServer(get, () =>
              userApi.update(u.id, {
                roleId: "role_viewer",
                permissions: u.permissions,
              }),
            ),
          );
        syncToServer(get, () => roleApi.remove(id));
        return true;
      },
    }),
    {
      name: "teacher-pro-store-v4",
      version: 14,
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Record<string, unknown>;

        // Migration v14: stop storing the full school database in localStorage.
        // Persisting thousands of students/grades/logs on every click or state change
        // blocks the main thread and causes Chrome [Violation] pointer/message warnings.
        if (version < 14) return toPersistedUiSnapshot(state);

        const nextState: Record<string, unknown> = { ...state };

        // Migration v3 → v4: Replace all courses with the new default courses
        if (version < 4) {
          nextState.courses = DEFAULT_COURSES.map((c) => ({ ...c }));
        }

        if (version < 6 && Array.isArray(nextState.courses)) {
          nextState.courses = nextState.courses.map((course) => {
            const c = course as Record<string, unknown>;
            return {
              ...c,
              availablePrograms: getAvailablePrograms(c),
              availableStudyTypes: getAvailableStudyTypes(c),
              studyTypesByProgram: getStudyTypesByProgram(c),
            };
          });
        }

        const stripKeys = (item: unknown, keys: string[]) => {
          const copy = { ...(item as Record<string, unknown>) };
          keys.forEach((key) => delete copy[key]);
          return copy;
        };

        // Migration v6 → v7: remove obsolete financial, installment, attendance, and accounting-review fields from local snapshots.
        if (version < 7) {
          if (Array.isArray(nextState.students)) {
            nextState.students = nextState.students.map((student) =>
              stripKeys(student, [
                "receiptNo",
                "codeSequence",
                "totalAmount",
                "paidAmount",
                "installments",
                "accountingStart",
              ]),
            );
          }
          if (Array.isArray(nextState.exams)) {
            nextState.exams = nextState.exams.map((exam) =>
              stripKeys(exam, ["attendance", "attendanceClosed"]),
            );
          }
          if (Array.isArray(nextState.grades)) {
            nextState.grades = nextState.grades.map((grade) =>
              stripKeys(grade, ["accountingChecked"]),
            );
          }
        }

        // Migration v7 → v8: remove obsolete electronic groups and their links from local snapshots.
        if (version < 8) {
          delete nextState.groups;
          if (Array.isArray(nextState.students)) {
            nextState.students = nextState.students.map((student) =>
              stripKeys(student, ["groupId"]),
            );
          }
          if (Array.isArray(nextState.exams)) {
            nextState.exams = nextState.exams.map((exam) =>
              stripKeys(exam, ["groupId"]),
            );
          }
          if (Array.isArray(nextState.users)) {
            nextState.users = nextState.users.map((user) => ({
              ...(user as Record<string, unknown>),
              permissions: sanitizePermissionIds(
                parseArrayField<string>(
                  (user as Record<string, unknown>).permissions,
                ),
              ),
            }));
          }
          if (Array.isArray(nextState.roles)) {
            nextState.roles = nextState.roles.map((role) => ({
              ...(role as Record<string, unknown>),
              permissions: sanitizePermissionIds(
                parseArrayField<string>(
                  (role as Record<string, unknown>).permissions,
                ),
              ),
            }));
          }
        }

        // Migration v8 → v9: preserve student grace days as an academic-protection field.
        if (version < 9 && Array.isArray(nextState.students)) {
          nextState.students = nextState.students.map((student) => ({
            ...(student as Record<string, unknown>),
            accountingGraceDays: normalizeGraceDaysValue(
              (student as Record<string, unknown>).accountingGraceDays,
            ),
          }));
        }

        // Migration v9 → v10: add per-student dismissal notes.
        if (version < 10 && Array.isArray(nextState.students)) {
          nextState.students = nextState.students.map((student) => ({
            ...(student as Record<string, unknown>),
            dismissalNotes: String(
              (student as Record<string, unknown>).dismissalNotes || "",
            ),
          }));
        }

        // Migration v10 → v11: remove the old leave/excused grade status from local snapshots.
        if (version < 11 && Array.isArray(nextState.grades)) {
          nextState.grades = nextState.grades.map((grade) => ({
            ...(grade as Record<string, unknown>),
            status: sanitizeGradeStatus(
              (grade as Record<string, unknown>).status,
            ),
          }));
        }

        // Migration v11 → v12: remove deleted Demo Copies and legacy Sites Management snapshots.
        if (version < 12) {
          delete nextState.sites;
          delete nextState.demoCopies;
          delete nextState.activeDemoId;
          delete nextState.mainSnapshotBeforeDemo;
          if (Array.isArray(nextState.users)) {
            nextState.users = nextState.users.map((user) => ({
              ...(user as Record<string, unknown>),
              permissions: sanitizePermissionIds(
                parseArrayField<string>(
                  (user as Record<string, unknown>).permissions,
                ),
              ),
            }));
          }
          if (Array.isArray(nextState.roles)) {
            nextState.roles = nextState.roles.map((role) => ({
              ...(role as Record<string, unknown>),
              permissions: sanitizePermissionIds(
                parseArrayField<string>(
                  (role as Record<string, unknown>).permissions,
                ),
              ),
            }));
          }
        }

        // Migration v12 → v13: add leave scope fields for exam/period leave records.
        if (version < 13 && Array.isArray(nextState.studentLeaves)) {
          nextState.studentLeaves = nextState.studentLeaves.map((leave) =>
            normalizeStudentLeave(leave as Record<string, unknown>),
          );
        }

        return nextState;
      },
      partialize: (state) => toPersistedUiSnapshot(state),
    },
  ),
);
