'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  courseApi, chapterApi, courseChapterApi,
  studentApi, examApi, gradeApi, opportunityLogApi, studentLeaveApi, studentCallApi, studentNoteApi, correctionSheetApi,
  userApi, roleApi, logApi, authApi,
  loadAllFromServer, type ApiResult, type AuthApiUser, type ServerData,
} from './api';
import { getStudentDuplicateMessage, sanitizeTelegramInput } from './student-utils';
import {
  type CourseLocationConfig,
  type StudyTypesByProgram,
  getAvailablePrograms,
  getAvailableStudyTypes,
  getAvailableStudyTypesForProgram,
  getStudyTypesByProgram,
  parseJsonArray,
  parseJsonRecord,
} from './course-config';
import { formatGradeScore, isExamAvailableForEntry, isExamOnOrAfterStudentRegistration, isGradeEntered } from './exam-utils';
import { toBaghdadDateTimeLocal } from './baghdad-time';
import { formatAppDate, toLatinDigits } from './format';

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
  gender: 'ذكر' | 'أنثى';
  phone: string;
  parentPhone: string;
  telegram: string;
  courseProgram: 'منهج كامل' | 'كورسات' | '';
  courseTerm: 'الكورس الأول' | 'الكورس الثاني' | '';
  studyType: 'إلكتروني' | 'حضوري' | 'مدمج' | '';
  locationScope: 'بغداد' | 'محافظات' | 'خارج القطر' | '';
  baghdadMode: 'عموم بغداد' | 'بغداد - مخصص' | '';
  courseId: string;
  mainSite: string;
  subSite: string;
  code: string;
  status: 'نشط' | 'مفصول';
  dismissalType: string;
  dismissalReason: string;
  dismissalNotes: string;
  createdAt: string;
  opportunities: number;
  baseOpportunities: number;
  accountingGraceDays: number;
}

export interface Exam {
  id: string;
  name: string;
  type: 'يومي' | 'تراكمي' | 'فاينل';
  courseIds: string[];
  mainSite: string;
  date: string;
  fullMark: number;
  passMark: number;
  discountMark: number;
  opportunitiesPenalty: number | 'فصل مؤقت';
  dismissalGrade: number | null;
  noDiscount: boolean;
  active: boolean;
  scheduledActivateAt?: string;
  scheduledDeactivateAt?: string;
}

export interface Grade {
  id: string;
  studentId: string;
  examId: string;
  status: 'درجة' | 'غائب' | 'غش';
  score: number | null;
  notes: string;
  academicAccountingChecked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityLog {
  id: string;
  studentId: string;
  examId: string;
  action: string;
  amount: number;
  reason: string;
  date: string;
  chapterId: string;
}

export type StudentLeaveType = 'exam' | 'period';

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
  dismissalType?: string;
  dismissalReason?: string;
  dismissalDate?: string;
}

export interface CorrectionSheet {
  id: string;
  studentId: string;
  examId: string;
  correctorId: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  correctionErrors: number;
  sumErrors: number;
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
    roleId: authUser.roleId || '',
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

const LOG_CLEAR_SCOPE_MODULES: Record<string, string[] | 'all-audit' | 'opportunity'> = {
  'audit-all': 'all-audit',
  'audit-grades': ['الدرجات'],
  'audit-students': ['تسجيل الطلاب', 'سجل الطلاب', 'الطلاب'],
  'audit-exams': ['الامتحانات', 'الدورات', 'الفصول والفرص'],
  'audit-followup': ['المتابعة'],
  'audit-correction': ['التصحيح الإلكتروني'],
  'audit-accounts': ['الحسابات', 'أمان الحسابات', 'تسجيل الدخول', 'الصلاحيات'],
  'audit-exports': ['تصدير', 'النسخ الاحتياطي'],
  'opportunity-logs': 'opportunity',
};

function parseLooseDateForClear(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = toLatinDigits(String(value)).trim().replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function valueIsWithinClearRange(value: string | undefined, dateFrom?: string, dateTo?: string): boolean {
  const valueTime = parseLooseDateForClear(value);
  if (valueTime === null) return true;
  const fromTime = parseLooseDateForClear(dateFrom);
  const toTime = parseLooseDateForClear(dateTo);
  if (fromTime !== null && valueTime < fromTime) return false;
  if (toTime !== null && valueTime > toTime) return false;
  return true;
}

function shouldClearAuditLogLocally(log: LogEntry, options: LogClearOptions): boolean {
  if (!valueIsWithinClearRange(log.time, options.dateFrom, options.dateTo)) return false;
  const scopes = new Set(options.scopeIds || []);
  if (scopes.has('audit-all')) return true;
  return [...scopes].some((scope) => {
    const modules = LOG_CLEAR_SCOPE_MODULES[scope];
    return Array.isArray(modules) && modules.includes(log.module);
  });
}

function shouldClearOpportunityLogLocally(log: OpportunityLog, options: LogClearOptions): boolean {
  if (!(options.scopeIds || []).includes('opportunity-logs')) return false;
  return valueIsWithinClearRange(log.date, options.dateFrom, options.dateTo);
}


export interface LeaderboardSettings {
  correctionErrorPenalty: number;
  sumErrorPenalty: number;
  excludedExamIds: string[];
}

export type SectionId =
  | 'dashboard'
  | 'missing-students-notes'
  | 'courses'
  | 'chapters'
  | 'student-register'
  | 'student-bulk-import'
  | 'student-registry'
  | 'dismissed-students'
  | 'exam-new'
  | 'grade-entry'
  | 'grade-bulk-import'
  | 'exam-records'
  | 'grade-records'
  | 'opportunities'
  | 'follow-up'
  | 'follow-up-calls'
  | 'follow-up-leaves'
  | 'follow-up-pledges'
  | 'e-correction'
  | 'accounts'
  | 'logs'
  | 'admin-log-reset';

// ─── Permissions Catalog ────────────────────────────────────────────────────

export interface PermissionEntry {
  id: string;
  label: string;
  category: string;
  level: 'read' | 'write' | 'delete' | 'manage';
  description: string;
}

export const PERMISSION_CATALOG: PermissionEntry[] = [
  // النظام
  { id: 'system.dashboard', label: 'لوحة النظام', category: 'النظام', level: 'read', description: 'عرض لوحة النظام والنظرة العامة' },
  { id: 'system.settings', label: 'إعدادات النظام', category: 'النظام', level: 'manage', description: 'تعديل إعدادات النظام' },
  { id: 'backup.view', label: 'تصدير النسخ الاحتياطي', category: 'النظام', level: 'manage', description: 'تحميل نسخة احتياطية كاملة من بيانات النظام' },
  // الدورات
  { id: 'courses.view', label: 'عرض الدورات', category: 'الدورات', level: 'read', description: 'عرض قائمة الدورات' },
  { id: 'courses.add', label: 'إضافة دورة', category: 'الدورات', level: 'write', description: 'إنشاء دورة جديدة' },
  { id: 'courses.edit', label: 'تعديل دورة', category: 'الدورات', level: 'write', description: 'تعديل بيانات دورة' },
  { id: 'courses.delete', label: 'حذف دورة', category: 'الدورات', level: 'delete', description: 'حذف دورة من النظام' },
  // الفصول
  { id: 'chapters.view', label: 'عرض الفصول', category: 'الفصول', level: 'read', description: 'عرض قائمة الفصول' },
  { id: 'chapters.add', label: 'إضافة فصل', category: 'الفصول', level: 'write', description: 'إنشاء فصل جديد' },
  { id: 'chapters.edit', label: 'تعديل فصل', category: 'الفصول', level: 'write', description: 'تعديل بيانات فصل' },
  { id: 'chapters.delete', label: 'حذف فصل', category: 'الفصول', level: 'delete', description: 'حذف فصل من النظام' },
  // الطلاب
  { id: 'students.view', label: 'عرض الطلاب', category: 'الطلاب', level: 'read', description: 'عرض سجل الطلاب' },
  { id: 'students.add', label: 'تسجيل طالب', category: 'الطلاب', level: 'write', description: 'تسجيل طالب جديد' },
  { id: 'students.edit', label: 'تعديل بيانات طالب', category: 'الطلاب', level: 'write', description: 'تعديل بيانات طالب' },
  { id: 'students.delete', label: 'حذف طالب', category: 'الطلاب', level: 'delete', description: 'حذف طالب من النظام' },
  // الامتحانات
  { id: 'exams.view', label: 'عرض الامتحانات', category: 'الامتحانات', level: 'read', description: 'عرض قائمة الامتحانات' },
  { id: 'exams.add', label: 'إضافة امتحان', category: 'الامتحانات', level: 'write', description: 'إنشاء امتحان جديد' },
  { id: 'exams.edit', label: 'تعديل امتحان', category: 'الامتحانات', level: 'write', description: 'تعديل بيانات امتحان' },
  { id: 'exams.delete', label: 'حذف امتحان', category: 'الامتحانات', level: 'delete', description: 'حذف امتحان من النظام' },
  // الدرجات
  { id: 'grades.view', label: 'عرض الدرجات', category: 'الدرجات', level: 'read', description: 'عرض سجل الدرجات' },
  { id: 'grades.add', label: 'إدخال درجات', category: 'الدرجات', level: 'write', description: 'إدخال درجات الطلاب' },
  { id: 'grades.edit', label: 'تعديل درجة', category: 'الدرجات', level: 'write', description: 'تعديل درجة طالب' },
  { id: 'grades.delete', label: 'حذف درجة', category: 'الدرجات', level: 'delete', description: 'حذف درجة من السجل' },
  // الفرص
  { id: 'opportunities.view', label: 'عرض الفرص', category: 'الفرص', level: 'read', description: 'عرض وإدارة فرص الطلاب' },
  { id: 'opportunities.manage', label: 'إدارة الفرص', category: 'الفرص', level: 'manage', description: 'إضافة وخصم فرص الطلاب' },
  { id: 'follow-up.view', label: 'عرض المتابعة', category: 'المتابعة', level: 'read', description: 'عرض الإجازات والمكالمات وملف الطالب' },
  { id: 'follow-up.manage', label: 'إدارة المتابعة', category: 'المتابعة', level: 'manage', description: 'إضافة الإجازات والمكالمات والملاحظات' },
  // التصحيح
  { id: 'correction.view', label: 'عرض التصحيح', category: 'التصحيح', level: 'read', description: 'عرض لوحة التصحيح الإلكتروني' },
  { id: 'correction.manage', label: 'إدارة التصحيح', category: 'التصحيح', level: 'manage', description: 'إضافة وتعديل أوراق التصحيح' },
  // الحسابات
  { id: 'accounts.view', label: 'عرض الحسابات', category: 'الحسابات', level: 'read', description: 'عرض قائمة الحسابات' },
  { id: 'accounts.manage', label: 'إدارة الحسابات', category: 'الحسابات', level: 'manage', description: 'إضافة وتعديل وحذف الحسابات' },
  // السجلات
  { id: 'logs.view', label: 'عرض السجلات', category: 'السجلات', level: 'read', description: 'عرض سجلات العمليات والتدقيق' },
];

// ─── Section-to-Permission Mapping ──────────────────────────────────────────

export const SECTION_PERMISSIONS: Record<SectionId, string> = {
  'dashboard': 'system.dashboard',
  'missing-students-notes': 'grades.view',
  'courses': 'courses.add',
  'chapters': 'chapters.view',
  'student-register': 'students.add',
  'student-bulk-import': 'students.add',
  'student-registry': 'students.view',
  'dismissed-students': 'students.view',
  'exam-new': 'exams.add',
  'grade-entry': 'grades.add',
  'grade-bulk-import': 'grades.add',
  'exam-records': 'exams.view',
  'grade-records': 'grades.view',
  'opportunities': 'opportunities.view',
  'follow-up': 'follow-up.view',
  'follow-up-calls': 'follow-up.view',
  'follow-up-leaves': 'follow-up.view',
  'follow-up-pledges': 'follow-up.view',
  'e-correction': 'correction.view',
  'accounts': 'accounts.view',
  'logs': 'logs.view',
  'admin-log-reset': '__admin_only__',
};

// ─── Default Roles ──────────────────────────────────────────────────────────

const ALL_PERMISSION_IDS = Array.from(new Set(PERMISSION_CATALOG.map(p => p.id)));
const ALL_VIEW_PERMISSION_IDS = PERMISSION_CATALOG.filter(p => p.level === 'read').map(p => p.id);

const ADMIN_USERNAME = 'admin';
const ADMIN_ROLE_ID = 'role_admin';
const ADMIN_ROLE_NAME = 'مدير عام';

/**
 * Default admin password is read from TEACHERPRO_ADMIN_PASSWORD env var.
 * The constant here is only a development fallback; production requires
 * the env var to be set (see admin-seed.ts for the authoritative path).
 */
function readAdminPasswordEnv(): string {
  if (typeof process !== 'undefined' && process.env?.TEACHERPRO_ADMIN_PASSWORD) {
    return process.env.TEACHERPRO_ADMIN_PASSWORD.trim();
  }
  // Development-only fallback. Never used in production.
  return 'change-me-in-env';
}
const ADMIN_PASSWORD = readAdminPasswordEnv();
const ADMIN_FULL_PERMISSIONS = [...ALL_PERMISSION_IDS];
const ADMIN_ONLY_SECTIONS = new Set<SectionId>(['admin-log-reset']);
const DEPRECATED_PERMISSION_IDS = new Set(['groups.view', 'groups.add', 'groups.edit', 'groups.delete', 'sites.view', 'sites.add', 'sites.edit', 'sites.delete', 'demos.view', 'demos.manage']);

function sanitizePermissionIds(permissions: string[] = []): string[] {
  return Array.from(new Set(permissions.filter((permission) => !DEPRECATED_PERMISSION_IDS.has(permission))));
}

function isPrimaryAdminUser(user?: Pick<User, 'username'> | null): boolean {
  return String(user?.username || '').trim().toLowerCase() === ADMIN_USERNAME;
}

function hasFullAdminAccess(user?: Pick<User, 'username' | 'roleId'> | null): boolean {
  return isPrimaryAdminUser(user) || user?.roleId === ADMIN_ROLE_ID;
}

function normalizeAdminAccessUser(user: User): User {
  if (isPrimaryAdminUser(user)) {
    return {
      ...user,
      username: ADMIN_USERNAME,
      name: user.name || 'مدير النظام',
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

  return { ...user, permissions: sanitizePermissionIds(user.permissions || []) };
}

const DEFAULT_ROLES: Role[] = [
  {
    id: 'role_admin',
    name: 'مدير عام',
    isDefault: true,
    permissions: [...ADMIN_FULL_PERMISSIONS],
  },
  {
    id: 'role_supervisor',
    name: 'مشرف',
    isDefault: true,
    permissions: ALL_PERMISSION_IDS.filter(p => p !== 'accounts.manage' && p !== 'system.settings'),
  },
  {
    id: 'role_registrar',
    name: 'مسؤول تسجيل',
    isDefault: true,
    permissions: [
      'students.view', 'students.add', 'students.edit', 'students.delete',
      'courses.view', 'chapters.view',
      'exams.view', 'grades.view',
    ],
  },
  {
    id: 'role_checker',
    name: 'مصحح',
    isDefault: true,
    permissions: [
      'correction.view', 'correction.manage',
      'grades.view', 'students.view', 'exams.view',
    ],
  },
  {
    id: 'role_viewer',
    name: 'مشاهدة فقط',
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
  correctionSheets?: CorrectionSheet[];
  users?: User[];
  roles?: Role[];
  logs?: LogEntry[];
  leaderboardSettings?: LeaderboardSettings;
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
  correctionSheets: CorrectionSheet[];
  users: User[];
  roles: Role[];
  logs: LogEntry[];
  leaderboardSettings: LeaderboardSettings;
  dbConnected: boolean;
  dbLoading: boolean;

  currentSection: SectionId;
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  studentPageSize: number;
  gradePageSize: number;
  currentUserId: string;
  isAuthenticated: boolean;

  loadFromServer: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;

  setSection: (section: SectionId) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleTheme: () => void;

  currentUser: () => User | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; message: string }>;
  canAccess: (section: SectionId | string) => boolean;
  logout: () => void;

  courseName: (id: string) => string;
  chapterName: (id: string) => string;
  studentName: (id: string) => string;
  userName: (id: string) => string;
  activeChapterForCourse: (courseId: string) => Chapter | null;
  classification: (grade: Grade | undefined, exam: Exam, student?: Student) => { text: string; type: string; kind: string };

  addCourse: (course: Omit<Course, 'id' | 'createdAt' | 'active'>) => void;
  updateCourse: (id: string, updates: Partial<Omit<Course, 'id' | 'createdAt'>>) => { ok: boolean; message: string };
  toggleCourse: (id: string) => void;
  deleteCourse: (id: string) => boolean;


  addChapter: (name: string, opportunities: number) => void;
  updateChapter: (id: string, updates: Partial<Omit<Chapter, 'id'>>) => void;
  deleteChapter: (id: string) => boolean;
  attachChapter: (courseId: string, chapterId: string) => void;
  toggleChapter: (courseChapterId: string, force?: boolean) => void;
  deleteCourseChapter: (courseChapterId: string) => boolean;

  addStudent: (student: Omit<Student, 'id' | 'code'>) => { ok: boolean; message: string };
  updateStudent: (id: string, updates: Partial<Omit<Student, 'id' | 'code'>>) => { ok: boolean; message: string };
  deleteStudent: (id: string) => boolean;
  dismissStudent: (studentId: string, type: string, reason: string, notes?: string) => void;
  reactivateStudent: (studentId: string) => void;

  addExam: (exam: Omit<Exam, 'id'>) => void;
  updateExam: (id: string, updates: Partial<Omit<Exam, 'id'>>) => void;
  toggleExam: (id: string) => void;
  deleteExam: (id: string) => boolean;

  addGrade: (grade: Omit<Grade, 'id' | 'createdAt' | 'updatedAt' | 'academicAccountingChecked'> & { academicAccountingChecked?: boolean }) => void;
  bulkAddGrades: (grades: Array<Omit<Grade, 'id' | 'createdAt' | 'updatedAt' | 'academicAccountingChecked'> & { academicAccountingChecked?: boolean }>) => { added: number; updated: number };
  updateGrade: (id: string, updates: Partial<Grade>) => void;
  deleteGrade: (id: string) => boolean;
  clearAbsentGradesForExam: (examId: string) => number;
  recalculateAcademicEffects: (studentIds?: string | string[]) => void;

  adjustOpportunities: (studentId: string, amount: number, reason: string) => void;
  bulkAdjustOpportunities: (
    studentIds: string[],
    amount: number,
    reason: string,
    options?: { reactivateDismissedOnAdd?: boolean },
  ) => { affected: number; skipped: number };
  resetOpportunities: (studentId: string) => void;
  undoOpportunityLog: (logId: string) => boolean;

  addStudentLeave: (leave: Omit<StudentLeave, 'id'>) => void;
  deleteStudentLeave: (id: string) => void;
  addStudentCall: (call: Omit<StudentCall, 'id' | 'createdAt'>) => void;
  updateStudentCall: (id: string, updates: Partial<StudentCall>) => void;
  addStudentNote: (note: Omit<StudentNote, 'id'>) => void;
  deleteStudentNote: (id: string) => void;

  addCorrectionSheet: (sheet: Omit<CorrectionSheet, 'id'>) => void;
  updateCorrectionSheet: (id: string, updates: Partial<CorrectionSheet>) => void;
  deleteCorrectionSheet: (id: string) => boolean;

  addUser: (user: Omit<User, 'id'>) => void;
  updateUser: (id: string, updates: Partial<Omit<User, 'id'>>) => void;
  toggleUser: (id: string) => void;
  updateUserPermissions: (id: string, permissions: string[]) => void;
  deleteUser: (id: string) => boolean;

  addRole: (role: Omit<Role, 'id'>) => void;
  updateRole: (id: string, updates: Partial<Omit<Role, 'id'>>) => void;
  deleteRole: (id: string) => boolean;


  logAction: (module: string, action: string, details?: string) => void;
  clearLogs: (password: string, options: LogClearOptions) => Promise<{ ok: boolean; message: string }>;
  restoreLastLogClear: (password: string) => Promise<{ ok: boolean; message: string }>;
  exportBackup: () => string;
  importBackup: (jsonText: string) => { ok: boolean; message: string };
  exportMonthlyReport: (month?: string) => string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDateTimeValue(value: unknown): string {
  if (!value) return '';
  return toBaghdadDateTimeLocal(value as string | Date);
}

function nowText(): string {
  const d = new Date();
  const date = formatAppDate(d);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

function firstAvailableSection(user: User | undefined, roles: Role[]): SectionId {
  if (!user) return 'dashboard';
  const role = roles.find(r => r.id === user.roleId);
  const perms = user.permissions.length > 0 ? user.permissions : (role?.permissions || []);
  // Map permissions back to section IDs
  for (const perm of perms) {
    for (const [sectionId, permId] of Object.entries(SECTION_PERMISSIONS)) {
      if (permId === perm) return sectionId as SectionId;
    }
  }
  // Fallback: if user has old-style section IDs in permissions
  const first = perms?.[0] as SectionId | undefined;
  if (first && first in SECTION_PERMISSIONS) return first;
  return 'dashboard';
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

// ─── Default Courses ─────────────────────────────────────────────────────────

const DEFAULT_COURSES: Course[] = [];

function seedData() {
  const roles: Role[] = DEFAULT_ROLES.map(r => ({ ...r, permissions: [...r.permissions] }));

  const users: User[] = [
    { id: 'u_admin', username: ADMIN_USERNAME, name: 'مدير النظام', roleId: ADMIN_ROLE_ID, role: ADMIN_ROLE_NAME, permissions: [...ADMIN_FULL_PERMISSIONS], active: true, password: ADMIN_PASSWORD },
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
    correctionSheets: [] as CorrectionSheet[],
    users,
    roles,
    logs: [] as LogEntry[],
    leaderboardSettings: { correctionErrorPenalty: 3, sumErrorPenalty: 1, excludedExamIds: [] as string[] },
  };
}

const DATA_KEYS: (keyof BackupShape)[] = [
  'courses', 'chapters', 'courseChapters', 'students', 'exams', 'grades',
  'opportunityLogs', 'studentLeaves', 'studentCalls', 'studentNotes', 'correctionSheets',
  'users', 'roles', 'logs', 'leaderboardSettings',
];


// ─── Migrate old users (no roleId) ──────────────────────────────────────────

function migrateOldUser(user: Record<string, unknown>, defaultRoles: Role[]): Record<string, unknown> {
  if (user.roleId) return user; // already migrated
  const oldRole = user.role as string;
  let roleId = 'role_viewer';
  let roleName = 'مشاهدة فقط';
  if (oldRole === 'مدير') {
    roleId = 'role_admin';
    roleName = 'مدير عام';
  } else if (oldRole === 'مصحح') {
    roleId = 'role_checker';
    roleName = 'مصحح';
  } else if (oldRole === 'مشرف') {
    roleId = 'role_supervisor';
    roleName = 'مشرف';
  }
  const role = defaultRoles.find(r => r.id === roleId);
  return {
    ...user,
    roleId,
    role: roleName,
    permissions: role ? [...role.permissions] : [...ALL_VIEW_PERMISSION_IDS],
  };
}

function parseArrayField<T = unknown>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed as T[] : [];
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
    ...DEFAULT_COURSES.filter((course) => !existingIds.has(course.id)).map((course) => ({ ...course })),
  ];
}

function mergeDefaultRoles(roles: Role[]): Role[] {
  const normalizedRoles = roles.map((role) => {
    const defaultRole = DEFAULT_ROLES.find((item) => item.id === role.id);
    if (!defaultRole) {
      return { ...role, permissions: sanitizePermissionIds(role.permissions || []) };
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
      permissions: sanitizePermissionIds([...(defaultRole.permissions || []), ...(role.permissions || [])]),
    };
  });

  const existingIds = new Set(normalizedRoles.map((role) => role.id));
  return [
    ...normalizedRoles,
    ...DEFAULT_ROLES.filter((role) => !existingIds.has(role.id)).map((role) => ({ ...role, permissions: sanitizePermissionIds(role.permissions) })),
  ];
}


function isRuleManagedDismissal(student: Student): boolean {
  const reason = student.dismissalReason || '';
  return [
    'غياب امتحان',
    'غياب ضمن درجة الفصل',
    'أول حالة غش',
    'غش متكرر',
    'درجة فصل',
    'درجة صفر',
    'انتهاء الفرص',
    'غياب امتحان',
    'فصل امتحان',
  ].some((part) => reason.includes(part));
}

function examPenaltyValue(exam: Exam): number {
  if (exam.noDiscount) return 0;
  return typeof exam.opportunitiesPenalty === 'number'
    ? exam.opportunitiesPenalty
    : Number(exam.opportunitiesPenalty) || 1;
}

function normalizeGraceDaysValue(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(30, Math.max(0, Math.trunc(numeric)));
}

function sanitizeGradeStatus(value: unknown): Grade['status'] {
  if (value === 'غش') return 'غش';
  if (value === 'غائب' || value === 'مجاز') return 'غائب';
  return 'درجة';
}

function parseDateOnly(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isExamWithinStudentGracePeriod(student: Pick<Student, 'createdAt' | 'accountingGraceDays'>, exam: Pick<Exam, 'date'>): boolean {
  const graceDays = normalizeGraceDaysValue(student.accountingGraceDays);
  if (graceDays <= 0) return false;
  const start = parseDateOnly(student.createdAt);
  const examDate = parseDateOnly(exam.date);
  if (!start || !examDate) return false;
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + graceDays);
  return examDate >= start && examDate < endExclusive;
}


function isAutomaticOpportunityLog(log: OpportunityLog): boolean {
  return log.action === 'خصم تلقائي' || log.action === 'فصل تلقائي' || String(log.reason || '').startsWith('تلقائي:');
}

function automaticOpportunityLogId(studentId: string, examId: string, sourceId: string, action: string, reason: string): string {
  const slug = `${action}-${reason}`
    .replace(/[^A-Za-z0-9\u0600-\u06FF]+/g, '-')
    .slice(0, 32);
  return `auto_${studentId}_${examId}_${sourceId || 'exam'}_${slug}`;
}

const ACADEMIC_REACTIVATION_LINK_PREFIX = '[academic-reactivation-link:';
const ACADEMIC_REACTIVATION_LINK_SUFFIX = ']';

interface AcademicReactivationLink {
  sourceGradeId: string;
  sourceExamId: string;
  sourceAutomaticLogId: string;
  reactivationMode: string;
}

function encodeAcademicReactivationLink(link: Partial<AcademicReactivationLink>): string {
  const params = new URLSearchParams();
  if (link.sourceGradeId) params.set('sourceGradeId', link.sourceGradeId);
  if (link.sourceExamId) params.set('sourceExamId', link.sourceExamId);
  if (link.sourceAutomaticLogId) params.set('sourceAutomaticLogId', link.sourceAutomaticLogId);
  params.set('reactivationMode', link.reactivationMode || 'بسبب إجراء تلقائي');
  return `${ACADEMIC_REACTIVATION_LINK_PREFIX}${params.toString()}${ACADEMIC_REACTIVATION_LINK_SUFFIX}`;
}

function parseAcademicReactivationLink(reason: string | null | undefined): AcademicReactivationLink | null {
  const text = String(reason || '');
  const start = text.indexOf(ACADEMIC_REACTIVATION_LINK_PREFIX);
  if (start < 0) return null;
  const valueStart = start + ACADEMIC_REACTIVATION_LINK_PREFIX.length;
  const end = text.indexOf(ACADEMIC_REACTIVATION_LINK_SUFFIX, valueStart);
  if (end < 0) return null;
  const params = new URLSearchParams(text.slice(valueStart, end));
  return {
    sourceGradeId: params.get('sourceGradeId') || '',
    sourceExamId: params.get('sourceExamId') || '',
    sourceAutomaticLogId: params.get('sourceAutomaticLogId') || '',
    reactivationMode: params.get('reactivationMode') || 'بسبب إجراء تلقائي',
  };
}

function isLinkedAcademicReactivationLog(log: OpportunityLog): boolean {
  return Boolean(parseAcademicReactivationLink(log.reason));
}

function isSystemAcademicReactivationLog(log: OpportunityLog): boolean {
  const reason = String(log.reason || '');
  return (
    (isReactivationOpportunityLog(log) || isFinalChanceOpportunityLog(log))
    && (
      reason.includes('تثبيت إعادة التفعيل')
      || reason.includes('إرجاع الطالب بعد إعادة التفعيل')
      || reason.includes('بفرصة واحدة')
    )
  );
}

function academicReactivationLinkMatchesExam(link: AcademicReactivationLink | null, examId: string): boolean {
  return Boolean(link && link.sourceExamId && link.sourceExamId === examId);
}

function opportunityLogBelongsToExam(log: OpportunityLog, examId: string): boolean {
  if (log.examId === examId) return true;
  return academicReactivationLinkMatchesExam(parseAcademicReactivationLink(log.reason), examId);
}

function academicReactivationSourceKey(link: AcademicReactivationLink | null): string {
  if (!link) return '';
  if (link.sourceGradeId) return `grade:${link.sourceGradeId}`;
  if (link.sourceExamId) return `exam:${link.sourceExamId}`;
  if (link.sourceAutomaticLogId) return `log:${link.sourceAutomaticLogId}`;
  return '';
}

function gradeMatchesAcademicReactivationLink(grade: Grade, link: AcademicReactivationLink | null): boolean {
  if (!link) return false;
  if (link.sourceGradeId && grade.id === link.sourceGradeId) return true;
  if (link.sourceExamId && grade.examId === link.sourceExamId) return true;
  return false;
}

function automaticLogMatchesAcademicReactivationLink(log: OpportunityLog, link: AcademicReactivationLink | null, grades: Grade[]): boolean {
  if (!link) return false;
  if (link.sourceAutomaticLogId && log.id === link.sourceAutomaticLogId) return true;
  if (link.sourceExamId && log.examId === link.sourceExamId) {
    if (!link.sourceGradeId) return true;
    return grades.some((grade) => grade.id === link.sourceGradeId && grade.studentId === log.studentId && grade.examId === log.examId);
  }
  return false;
}

function findAcademicReactivationSourceForStudent(
  state: Pick<TeacherState, 'grades' | 'exams' | 'opportunityLogs' | 'studentLeaves'>,
  student: Student,
): Partial<AcademicReactivationLink> | null {
  if (!isRuleManagedDismissal(student)) return null;
  return findLatestAcademicReactivationSourceForStudent(state, student);
}

function gradeHasAcademicEffect(grade: Grade, exam: Exam): boolean {
  if (!isExamAvailableForEntry(exam)) return false;
  if (!isGradeEntered(grade, exam)) return false;
  if (grade.status === 'غش') return true;
  if (exam.noDiscount) return false;

  // الغياب ليس حالة معلوماتية فقط؛ هو دائماً حالة محاسبة أكاديمية
  // ويعامل كأقل درجة ضمن الخصم في أي امتحان فعّال فيه خصم،
  // مع استثناءات الحماية العامة فقط مثل الإجازة أو فترة السماح.
  if (grade.status === 'غائب') return true;

  if (grade.status !== 'درجة' || grade.score === null) return false;
  const score = Number(grade.score);
  if (exam.type === 'فاينل') {
    return score === 0 || (exam.dismissalGrade !== null && score <= exam.dismissalGrade);
  }
  return score <= exam.discountMark;
}


function shouldAbsentGradeConsumeDiscount(
  state: Pick<TeacherState, 'studentLeaves'>,
  grade: Grade,
  exam: Exam,
  student: Student | undefined,
): boolean {
  if (!student) return false;
  if (grade.status !== 'غائب') return false;
  if (!gradeHasAcademicEffect(grade, exam)) return false;
  if (!isExamOnOrAfterStudentRegistration(student, exam)) return false;
  if (isExamWithinStudentGracePeriod(student, exam)) return false;
  return !(state.studentLeaves || [])
    .map((leave) => normalizeStudentLeave(leave))
    .some((leave) => studentLeaveAppliesToExam(leave, student.id, exam));
}

function findAbsentDiscountRepairStudentIds(
  state: Pick<TeacherState, 'students' | 'grades' | 'exams' | 'studentLeaves'>,
): string[] {
  const studentsById = new Map(state.students.map((student) => [student.id, student]));
  const examsById = new Map(state.exams.map((exam) => [exam.id, exam]));
  const affected = new Set<string>();

  for (const grade of state.grades) {
    if (grade.status !== 'غائب') continue;
    const exam = examsById.get(grade.examId);
    if (!exam) continue;
    const student = studentsById.get(grade.studentId);
    if (shouldAbsentGradeConsumeDiscount(state, grade, exam, student)) {
      affected.add(grade.studentId);
    }
  }

  return Array.from(affected);
}

function repairAbsentDiscountAccountingIfNeeded(getState: () => TeacherState): void {
  const state = getState();
  const affectedStudentIds = findAbsentDiscountRepairStudentIds(state);
  if (!affectedStudentIds.length) return;

  // هذا يعالج البيانات القديمة التي تم حفظ الغياب فيها بدون خصم فرص.
  // إعادة الاحتساب scoped على الطلاب المتأثرين فقط وتستثني فترة السماح والإجازات.
  state.recalculateAcademicEffects(affectedStudentIds);
}

function gradeCausesDismissalGradeEffect(grade: Grade, exam: Exam): boolean {
  if (!gradeHasAcademicEffect(grade, exam)) return false;
  if (grade.status === 'غش') return true;
  if (grade.status === 'غائب') return exam.type === 'فاينل';
  if (grade.status !== 'درجة' || grade.score === null) return false;
  const score = Number(grade.score);
  if (exam.type === 'فاينل') {
    return score === 0 || (exam.dismissalGrade !== null && score <= exam.dismissalGrade);
  }
  return false;
}

function findLatestAcademicReactivationSourceForStudent(
  state: Pick<TeacherState, 'grades' | 'exams' | 'opportunityLogs' | 'studentLeaves'>,
  student: Student,
): Partial<AcademicReactivationLink> | null {
  const examsById = new Map(state.exams.map((exam) => [exam.id, exam]));
  const normalizedLeaves = (state.studentLeaves || []).map((leave) => normalizeStudentLeave(leave));

  const studentAutomaticLogs = state.opportunityLogs
    .filter((log) => log.studentId === student.id && isAutomaticOpportunityLog(log))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const dismissalLog = studentAutomaticLogs.find((log) => log.action === 'فصل تلقائي') || studentAutomaticLogs[0];
  if (dismissalLog) {
    const sourceGrade = state.grades.find((grade) => grade.studentId === student.id && grade.examId === dismissalLog.examId);
    return {
      sourceGradeId: sourceGrade?.id || '',
      sourceExamId: dismissalLog.examId || sourceGrade?.examId || '',
      sourceAutomaticLogId: dismissalLog.id,
      reactivationMode: 'بسبب إجراء تلقائي',
    };
  }

  const fallbackGrade = state.grades
    .filter((grade) => grade.studentId === student.id)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .find((grade) => {
      const exam = examsById.get(grade.examId);
      if (!exam) return false;
      if (!isExamAvailableForEntry(exam)) return false;
      if (!isGradeEntered(grade, exam)) return false;
      if (!isExamOnOrAfterStudentRegistration(student, exam)) return false;
      if (normalizedLeaves.some((leave) => studentLeaveAppliesToExam(leave, student.id, exam))) return false;
      if (isExamWithinStudentGracePeriod(student, exam)) return false;
      return gradeCausesDismissalGradeEffect(grade, exam);
    });

  if (!fallbackGrade) return null;
  return {
    sourceGradeId: fallbackGrade.id,
    sourceExamId: fallbackGrade.examId,
    sourceAutomaticLogId: '',
    reactivationMode: 'بسبب إجراء تلقائي',
  };
}

function resolveAcademicReactivationLinkForLog(
  log: OpportunityLog,
  state: Pick<TeacherState, 'grades' | 'exams' | 'opportunityLogs' | 'studentLeaves'>,
  student: Student,
): AcademicReactivationLink | null {
  const parsed = parseAcademicReactivationLink(log.reason);
  if (parsed) return parsed;
  if (!isSystemAcademicReactivationLog(log)) return null;
  const inferred = findLatestAcademicReactivationSourceForStudent(state, student);
  if (!inferred) return null;
  return {
    sourceGradeId: inferred.sourceGradeId || '',
    sourceExamId: inferred.sourceExamId || '',
    sourceAutomaticLogId: inferred.sourceAutomaticLogId || '',
    reactivationMode: inferred.reactivationMode || 'بسبب إجراء تلقائي',
  };
}

function isAcademicallyManagedOpportunityLog(log: OpportunityLog): boolean {
  return isAutomaticOpportunityLog(log) || isLinkedAcademicReactivationLog(log) || isSystemAcademicReactivationLog(log);
}

function isReactivationOpportunityLog(log: OpportunityLog): boolean {
  return log.action === 'إعادة تفعيل' || String(log.reason || '').includes('تثبيت إعادة التفعيل');
}

function isFinalChanceOpportunityLog(log: OpportunityLog): boolean {
  return log.action === 'فرصة أخيرة بعد تعهد' || String(log.reason || '').includes('فرصة أخيرة');
}

function latestStudentLogDate(logs: OpportunityLog[], predicate: (log: OpportunityLog) => boolean): string {
  const dates = logs
    .filter(predicate)
    .map((log) => String(log.date || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : '';
}

function hasFinalChanceForStudent(logs: OpportunityLog[], studentId: string): boolean {
  return logs.some((log) => log.studentId === studentId && isFinalChanceOpportunityLog(log));
}

function latestManualDismissalDateForStudent(
  state: Pick<TeacherState, 'opportunityLogs' | 'studentNotes'>,
  studentId: string,
): string {
  const logDates = state.opportunityLogs
    .filter((log) => log.studentId === studentId && log.action === 'خصم' && String(log.reason || '').startsWith('فصل الطالب'))
    .map((log) => dayKey(log.date))
    .filter(Boolean);
  const noteDates = (state.studentNotes || [])
    .filter((note) => note.studentId === studentId && note.kind === 'إجراء' && String(note.text || '').startsWith('فصل الطالب'))
    .map((note) => dayKey(note.date))
    .filter(Boolean);
  const dates = [...logDates, ...noteDates].sort();
  return dates.length ? dates[dates.length - 1] : '';
}

function dayKey(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  return String(value || '').slice(0, 10);
}

function normalizeLeaveType(value: unknown): StudentLeaveType {
  return value === 'period' ? 'period' : 'exam';
}

function normalizeStudentLeave(leaveInput: Partial<StudentLeave> | Record<string, unknown>): StudentLeave {
  const leave = leaveInput as Partial<StudentLeave>;
  const leaveType = normalizeLeaveType(leave.leaveType);
  const date = dayKey(leave.date) || todayISO();
  const dateFrom = dayKey(leave.dateFrom) || date;
  const dateTo = dayKey(leave.dateTo) || dateFrom;
  return {
    id: String(leave.id || ''),
    studentId: String(leave.studentId || ''),
    examId: String(leave.examId || ''),
    leaveType,
    reason: String(leave.reason || ''),
    studyType: String(leave.studyType || ''),
    date,
    dateFrom: dateFrom <= dateTo ? dateFrom : dateTo,
    dateTo: dateFrom <= dateTo ? dateTo : dateFrom,
    notes: String(leave.notes || ''),
  };
}

function studentLeaveAppliesToExam(leave: StudentLeave, studentId: string, exam: Exam | undefined): boolean {
  if (!exam || leave.studentId !== studentId) return false;
  const normalized = normalizeStudentLeave(leave);
  if (normalized.leaveType === 'period') {
    const examDate = dayKey(exam.date);
    return Boolean(examDate && examDate >= normalized.dateFrom && examDate <= normalized.dateTo);
  }
  return normalized.examId === exam.id;
}

function isStudentExcusedForExam(
  state: Pick<TeacherState, 'studentLeaves' | 'exams'>,
  studentId: string,
  examId: string,
): boolean {
  const exam = state.exams.find((item) => item.id === examId);
  return state.studentLeaves.some((leave) => studentLeaveAppliesToExam(leave, studentId, exam));
}

function affectedExamIdsForLeave(leave: StudentLeave, state: Pick<TeacherState, 'exams'>): string[] {
  const normalized = normalizeStudentLeave(leave);
  if (normalized.leaveType === 'exam') return normalized.examId ? [normalized.examId] : [];
  return state.exams
    .filter((exam) => studentLeaveAppliesToExam(normalized, normalized.studentId, exam))
    .map((exam) => exam.id);
}

function recalculateStudentsFromAcademicRules(
  state: Pick<TeacherState, 'students' | 'grades' | 'exams' | 'courseChapters' | 'chapters' | 'opportunityLogs' | 'studentLeaves' | 'studentNotes'>,
  targetStudentIds?: Set<string>,
): { students: Student[]; opportunityLogs: OpportunityLog[] } {
  const examsById = new Map(state.exams.map((exam) => [exam.id, exam]));
  const activeCourseChapterByCourse = new Map(
    state.courseChapters
      .filter((link) => link.active && !link.archived)
      .map((link) => [link.courseId, link]),
  );
  const manualLogs = state.opportunityLogs.filter((log) => !isAutomaticOpportunityLog(log));
  const previousAutomaticLogs = state.opportunityLogs.filter(isAutomaticOpportunityLog);
  const hasScopedRecalculation = Boolean(targetStudentIds?.size);
  const automaticLogs: OpportunityLog[] = [];
  const normalizedLeaves = (state.studentLeaves || []).map((leave) => normalizeStudentLeave(leave));
  const activeLinkedSourcesByStudent = new Map<string, AcademicReactivationLink[]>();
  const resolvedAcademicLinksByOpportunityLogId = new Map<string, AcademicReactivationLink>();

  const students = state.students.map((student) => {
    const isTargetStudent = !hasScopedRecalculation || targetStudentIds?.has(student.id);
    if (!isTargetStudent) return student;

    const manualDismissal = student.status === 'مفصول' && !isRuleManagedDismissal(student);
    const manualDismissalDate = manualDismissal ? latestManualDismissalDateForStudent(state, student.id) : '';
    let hasAcademicEventAfterManualDismissal = false;

    const allStudentManualLogs = manualLogs
      .filter((log) => log.studentId === student.id)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    // إعادة التفعيل الإدارية المستقلة تبقى قراراً يدوياً لا نعيد كتابته بالحساب الجماعي.
    // أما إعادة التفعيل التي أنشأها النظام بعد فصل أكاديمي فتعامل كأثر أكاديمي حتى لو كانت سجلات قديمة بلا رابط.
    const hasIndependentManualReactivation = student.status === 'نشط' && allStudentManualLogs.some((log) => {
      return isReactivationOpportunityLog(log) && !isLinkedAcademicReactivationLog(log) && !isSystemAcademicReactivationLog(log);
    });
    if (!hasScopedRecalculation && hasIndependentManualReactivation) return student;

    const activeCourseChapter = activeCourseChapterByCourse.get(student.courseId);
    const activeChapter = activeCourseChapter ? state.chapters.find((chapter) => chapter.id === activeCourseChapter.chapterId) : null;
    const studentGrades = state.grades
      .filter((grade) => grade.studentId === student.id)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    const resolvedAcademicLinksByLogId = new Map<string, AcademicReactivationLink>();
    const linkedSourceLinks = allStudentManualLogs
      .map((log) => {
        const link = resolveAcademicReactivationLinkForLog(log, state, student);
        if (link && academicReactivationSourceKey(link)) resolvedAcademicLinksByLogId.set(log.id, link);
        return link;
      })
      .filter((link): link is AcademicReactivationLink => Boolean(link && academicReactivationSourceKey(link)));
    resolvedAcademicLinksByLogId.forEach((link, logId) => resolvedAcademicLinksByOpportunityLogId.set(logId, link));
    const activeLinkedSources = linkedSourceLinks.filter((link, index, links) => {
      const key = academicReactivationSourceKey(link);
      if (links.findIndex((item) => academicReactivationSourceKey(item) === key) !== index) return false;
      return studentGrades.some((grade) => {
        if (!gradeMatchesAcademicReactivationLink(grade, link)) return false;
        const exam = examsById.get(grade.examId);
        if (!exam) return false;
        if (!isExamOnOrAfterStudentRegistration(student, exam)) return false;
        if (normalizedLeaves.some((leave) => studentLeaveAppliesToExam(leave, student.id, exam))) return false;
        if (isExamWithinStudentGracePeriod(student, exam)) return false;
        return gradeHasAcademicEffect(grade, exam);
      });
    });
    if (activeLinkedSources.length > 0) activeLinkedSourcesByStudent.set(student.id, activeLinkedSources);

    const studentManualLogs = allStudentManualLogs.filter((log) => {
      const link = parseAcademicReactivationLink(log.reason) || resolvedAcademicLinksByLogId.get(log.id) || null;
      if (!link) return !isSystemAcademicReactivationLog(log);
      const key = academicReactivationSourceKey(link);
      return Boolean(key && activeLinkedSources.some((activeLink) => academicReactivationSourceKey(activeLink) === key));
    });

    let opportunities = Number(student.baseOpportunities || activeChapter?.opportunities || 0);
    let dismissalType = '';
    let dismissalReason = '';
    let dismissalPriority = -1;
    let cheatCount = 0;

    const hasFinalChancePledge = studentManualLogs.some(isFinalChanceOpportunityLog);
    let hasPriorDismissalEvent = manualDismissal || hasFinalChancePledge;
    const finalChanceStartDate = latestStudentLogDate(studentManualLogs, isFinalChanceOpportunityLog);
    studentManualLogs.forEach((log) => {
      if (finalChanceStartDate && !isFinalChanceOpportunityLog(log) && String(log.date || '').slice(0, 10) < finalChanceStartDate) return;
      const amount = Math.abs(Number(log.amount || 0));
      if (!amount && !isFinalChanceOpportunityLog(log)) return;
      if (isFinalChanceOpportunityLog(log)) opportunities = amount || 1;
      else if (log.action === 'إضافة') opportunities += amount;
      if (log.action === 'خصم') opportunities -= amount;
      if (log.action === 'إعادة تعيين') opportunities = Number(student.baseOpportunities || activeChapter?.opportunities || 0);
    });

    const addAutomaticLog = (exam: Exam, sourceId: string, action: string, amount: number, reason: string) => {
      if (amount <= 0 && action === 'خصم تلقائي') return;
      automaticLogs.push({
        id: automaticOpportunityLogId(student.id, exam.id, sourceId, action, reason),
        studentId: student.id,
        examId: exam.id,
        action,
        amount: Math.max(0, Math.trunc(amount)),
        reason: `تلقائي: ${reason}`,
        date: exam.date || todayISO(),
        chapterId: activeChapter?.id || activeCourseChapter?.chapterId || '',
      });
    };

    const consumeAllRemainingOpportunities = (exam: Exam, sourceId: string, reason: string) => {
      const deducted = Math.max(0, Math.trunc(opportunities));
      if (deducted > 0) {
        addAutomaticLog(exam, sourceId || exam.id, 'خصم تلقائي', deducted, `${reason} - خصم جميع الفرص بسبب الفصل`);
      }
      opportunities = 0;
    };

    const setDismissal = (type: string, reason: string, priority: number, exam?: Exam, sourceId?: string) => {
      const finalChanceViolation = hasFinalChancePledge && type === 'فصل مؤقت';
      const secondDismissalViolation = hasPriorDismissalEvent && type === 'فصل مؤقت';
      const shouldBeFinal = finalChanceViolation || secondDismissalViolation;
      const effectiveType = shouldBeFinal ? 'فصل نهائي' : type;
      const effectiveReason = finalChanceViolation
        ? `عدم الالتزام بالتعهد السابق - ${reason}`
        : secondDismissalViolation
          ? `الفصل الثاني للطالب - ${reason}`
          : reason;
      const effectivePriority = shouldBeFinal ? Math.max(priority, 90) : priority;
      if (effectivePriority >= dismissalPriority) {
        dismissalType = effectiveType;
        dismissalReason = effectiveReason;
        dismissalPriority = effectivePriority;
      }
      if (exam) {
        consumeAllRemainingOpportunities(exam, sourceId || exam.id, effectiveReason);
        addAutomaticLog(exam, sourceId || exam.id, 'فصل تلقائي', 0, effectiveReason);
      }
      hasPriorDismissalEvent = true;
    };

    const isProtectedLinkedSourceGrade = (grade: Grade): boolean => {
      return activeLinkedSources.some((link) => gradeMatchesAcademicReactivationLink(grade, link));
    };

    for (const grade of studentGrades) {
      const exam = examsById.get(grade.examId);
      if (!exam) continue;
      if (!isExamAvailableForEntry(exam)) continue;
      if (!isGradeEntered(grade, exam)) continue;
      const gradeEventDate = String(grade.updatedAt || grade.createdAt || exam.date || '').slice(0, 10);
      if (finalChanceStartDate && gradeEventDate < finalChanceStartDate) continue;
      if (manualDismissal && manualDismissalDate && gradeEventDate && gradeEventDate < manualDismissalDate) continue;
      if (!isExamOnOrAfterStudentRegistration(student, exam)) continue;
      if (normalizedLeaves.some((leave) => studentLeaveAppliesToExam(leave, student.id, exam))) continue;
      if (isExamWithinStudentGracePeriod(student, exam)) continue;
      const gradeHasEffect = gradeHasAcademicEffect(grade, exam);
      if (isProtectedLinkedSourceGrade(grade) && gradeHasEffect) continue;
      if (manualDismissal && gradeHasEffect) hasAcademicEventAfterManualDismissal = true;

      if (grade.status === 'غش') {
        cheatCount += 1;
        if (cheatCount === 1) {
          const deducted = Math.max(0, opportunities);
          if (deducted > 0) addAutomaticLog(exam, grade.id, 'خصم تلقائي', deducted, `غش أول في امتحان: ${exam.name} - خصم جميع الفرص`);
          opportunities = 0;
          setDismissal('فصل مؤقت', `أول حالة غش في امتحان: ${exam.name}`, 80, exam, grade.id);
        } else {
          setDismissal('فصل نهائي', `غش متكرر في امتحان: ${exam.name}`, 100, exam, grade.id);
        }
        continue;
      }

      if (exam.noDiscount) {
        continue;
      }

      if (grade.status === 'غائب') {
        if (exam.type === 'فاينل') {
          setDismissal('فصل مؤقت', `غياب ضمن درجة الفصل في امتحان ${exam.type}: ${exam.name}`, 75, exam, grade.id);
        } else {
          const penalty = examPenaltyValue(exam);
          opportunities -= penalty;
          addAutomaticLog(exam, grade.id, 'خصم تلقائي', penalty, `غياب في امتحان ${exam.type}: ${exam.name}`);
          if (hasPriorDismissalEvent) {
            setDismissal('فصل مؤقت', `غياب في امتحان ${exam.type} بعد فصل سابق: ${exam.name}`, 85, exam, grade.id);
          } else if (opportunities <= 0) {
            setDismissal('فصل مؤقت', `انتهاء الفرص بعد غياب في امتحان ${exam.type}: ${exam.name}`, 60, exam, grade.id);
          }
        }
        continue;
      }

      if (grade.status === 'درجة' && grade.score !== null) {
        const score = Number(grade.score);
        if (exam.type === 'فاينل') {
          if (score === 0) {
            setDismissal('فصل مؤقت', `درجة صفر في امتحان ${exam.type}: ${exam.name}`, 76, exam, grade.id);
          } else if (exam.dismissalGrade !== null && score <= exam.dismissalGrade) {
            setDismissal('فصل مؤقت', `درجة فصل (${score}): ${exam.name}`, 75, exam, grade.id);
          }
          continue;
        }
        if (score <= exam.discountMark) {
          const penalty = examPenaltyValue(exam);
          opportunities -= penalty;
          addAutomaticLog(exam, grade.id, 'خصم تلقائي', penalty, `درجة ${score} ضمن الخصم في امتحان: ${exam.name}`);
          if (hasPriorDismissalEvent) {
            setDismissal('فصل مؤقت', `درجة خصم (${score}) بعد فصل سابق في امتحان ${exam.type}: ${exam.name}`, 85, exam, grade.id);
          } else if (opportunities <= 0) {
            setDismissal('فصل مؤقت', `انتهاء الفرص بعد درجة خصم (${score}) في امتحان: ${exam.name}`, 60, exam, grade.id);
          }
        }
      }
    }

    if (manualDismissal && !hasAcademicEventAfterManualDismissal) return student;

    opportunities = Math.max(0, opportunities);
    if (opportunities === 0 && Number(student.baseOpportunities || activeChapter?.opportunities || 0) > 0 && !dismissalType) {
      setDismissal(
        hasFinalChancePledge ? 'فصل نهائي' : 'فصل مؤقت',
        hasFinalChancePledge ? 'عدم الالتزام بالتعهد السابق - انتهاء الفرصة الأخيرة' : 'انتهاء الفرص',
        hasFinalChancePledge ? 90 : 60,
      );
    }

    return {
      ...student,
      opportunities,
      status: (dismissalType ? 'مفصول' : 'نشط') as Student['status'],
      dismissalType,
      dismissalReason,
    };
  });

  const keptAutomaticLogs = previousAutomaticLogs.filter((log) => {
    if (hasScopedRecalculation && !targetStudentIds?.has(log.studentId)) return true;
    const activeLinks = activeLinkedSourcesByStudent.get(log.studentId) || [];
    return activeLinks.some((link) => automaticLogMatchesAcademicReactivationLink(log, link, state.grades));
  });

  const keptManualLogs = manualLogs.filter((log) => {
    if (hasScopedRecalculation && !targetStudentIds?.has(log.studentId)) return true;
    const link = parseAcademicReactivationLink(log.reason) || resolvedAcademicLinksByOpportunityLogId.get(log.id) || null;
    if (!link) return !isSystemAcademicReactivationLog(log);
    const key = academicReactivationSourceKey(link);
    const activeLinks = activeLinkedSourcesByStudent.get(log.studentId) || [];
    return Boolean(key && activeLinks.some((activeLink) => academicReactivationSourceKey(activeLink) === key));
  });

  return { students, opportunityLogs: [...automaticLogs, ...keptAutomaticLogs, ...keptManualLogs] };
}

const syncFailureNoticeTimestamps = new Map<string, number>();

function getSyncErrorMessage(error: unknown): string {
  if (isFailedApiResult(error) && error.error?.trim()) return error.error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'تعذر حفظ التغيير في الخادم. سيتم الاحتفاظ بالتغيير محلياً ومحاولة مزامنته لاحقاً.';
}

function notifySyncFailure(_getState: () => TeacherState, description: string, error: unknown): void {
  const message = getSyncErrorMessage(error);
  console.warn('[Store] Server sync failed:', description, error);
  if (typeof window !== 'undefined') {
    const now = Date.now();
    const transient = isTransientSyncFailure(error);
    const noticeKey = transient ? '__transient_sync__' : `${description}:${message}`;
    const minGapMs = transient ? 15000 : 4000;
    if (now - (syncFailureNoticeTimestamps.get(noticeKey) || 0) < minGapMs) return;
    syncFailureNoticeTimestamps.set(noticeKey, now);
    window.dispatchEvent(new CustomEvent('teacherpro:server-sync-error', {
      detail: { message: description ? `${description}: ${message}` : message },
    }));
  }
}

function isFailedApiResult(result: unknown): result is ApiResult & { ok: false } {
  return Boolean(result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false);
}

function isTransientSyncFailure(error: unknown): boolean {
  if (isFailedApiResult(error)) return Boolean(error.transient);
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('network') || message.includes('failed to fetch') || message.includes('تعذر الاتصال');
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
  'أمان الحسابات',
  'النظام',
  'تصفير الlog',
  'الحسابات',
  'الصلاحيات',
  'الطلاب',
  'إدارة الفرص',
  'النسخ الاحتياطي',
]);

/**
 * Specific (module, action) pairs that are server-only even if the
 * module has some client-allowed actions.
 */
const SERVER_ONLY_LOG_ACTIONS = new Set([
  // Deletes
  'حذف دورة', 'رفض حذف دورة',
  'حذف فصل', 'رفض حذف فصل', 'حذف ربط فصل بدورة',
  'تفعيل فصل ومنح فرص جديدة', 'تفعيل فصل واسترجاع أرشيف الفرص',
  'إلغاء تفعيل فصل',
  'حذف طالب مع سجلاته التابعة', 'رفض تعديل طالب مكرر',
  'رفض تسجيل طالب مكرر', 'تراجع تسجيل طالب',
  'حذف امتحان مع سجلاته وإعادة احتساب التأثيرات',
  'حذف درجة', 'رفض إدخال درجة لطالب مجاز',
  'حذف إجازة',
  // Bulk
  'إضافة درجات جماعية', 'إلغاء حالة غائب جماعي', 'تسجيل الصفحة كغائب',
  'إضافة فرص جماعية', 'خصم فرص جماعي', 'تعديل فرص طالب', 'إعادة تعيين فرص طالب',
  // Security
  'محاولة دخول مرفوضة',
  // Backup
  'تصدير نسخة احتياطية', 'استيراد نسخة احتياطية',
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
  options: { description?: string; rollback?: () => void } = {},
): void {
  void Promise.resolve()
    .then(action)
    .then((result) => {
      if (isFailedApiResult(result)) {
        throw result;
      }
    })
    .catch((error) => {
      // إذا كان الطلب مؤجلاً في outbox (queued)، لا نعرض خطأ ولا نرجع الحالة.
      // سيتم إعادة المحاولة تلقائياً عند عودة الشبكة.
      if (isQueuedResult(error)) return;

      // لا نرجع الحالة القديمة بسبب انقطاع شبكة/ضغط خادم مؤقت؛
      // الرجوع العشوائي كان يمسح درجات أُدخلت بعد الطلب الفاشل.
      if (!isTransientSyncFailure(error)) options.rollback?.();
      notifySyncFailure(getState, options.description || '', error);
    });
}

const PENDING_GRADE_SAVES_KEY = 'teacherpro-pending-grade-saves-v1';
const MAX_PENDING_GRADE_SAVES = 5000;

type PendingGradeSave = Pick<
  Grade,
  'id' | 'studentId' | 'examId' | 'status' | 'score' | 'notes' | 'academicAccountingChecked' | 'createdAt' | 'updatedAt'
> & { queuedAt: number };

let pendingGradeFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingGradeFlushInFlight = false;
let pendingGradeLastWarningAt = 0;
let pendingGradeBrowserEventsAttached = false;

function pendingGradeKey(grade: Pick<Grade, 'studentId' | 'examId'>): string {
  return `${grade.studentId}:${grade.examId}`;
}

function canUseGradeOutbox(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function normalizePendingGradeSave(item: unknown): PendingGradeSave | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const studentId = String(record.studentId || '').trim();
  const examId = String(record.examId || '').trim();
  const status = String(record.status || 'درجة') as Grade['status'];
  if (!id || !studentId || !examId || !['درجة', 'غائب', 'غش'].includes(status)) return null;

  const score = record.score === null || record.score === undefined || record.score === ''
    ? null
    : Number(record.score);

  return {
    id,
    studentId,
    examId,
    status,
    score: status === 'درجة' && typeof score === 'number' && Number.isFinite(score) ? score : null,
    notes: String(record.notes || ''),
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
    console.warn('[Store] Failed to read pending grade saves:', error);
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
    window.localStorage.setItem(PENDING_GRADE_SAVES_KEY, JSON.stringify(items.slice(-MAX_PENDING_GRADE_SAVES)));
  } catch (error) {
    console.warn('[Store] Failed to write pending grade saves:', error);
  }
}

function gradeSaveForApi(item: PendingGradeSave): Record<string, unknown> {
  return {
    id: item.id,
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

function mergePendingGradeSavesIntoGrades(grades: Grade[]): Grade[] {
  const pending = readPendingGradeSaves();
  if (pending.length === 0) return grades;
  const byKey = new Map<string, Grade>();
  grades.forEach((grade) => byKey.set(pendingGradeKey(grade), grade));
  pending.forEach((item) => {
    const { queuedAt: _queuedAt, ...grade } = item;
    void _queuedAt;
    byKey.set(pendingGradeKey(item), grade as Grade);
  });
  return Array.from(byKey.values());
}

function mergePendingGradeSaves(items: Grade[]): PendingGradeSave[] {
  const byKey = new Map<string, PendingGradeSave>();
  readPendingGradeSaves().forEach((item) => byKey.set(pendingGradeKey(item), item));
  const queuedAt = Date.now();
  items.forEach((grade) => {
    byKey.set(pendingGradeKey(grade), {
      id: grade.id,
      studentId: grade.studentId,
      examId: grade.examId,
      status: grade.status,
      score: grade.status === 'درجة' ? grade.score : null,
      notes: grade.notes || '',
      academicAccountingChecked: Boolean(grade.academicAccountingChecked),
      createdAt: grade.createdAt || todayISO(),
      updatedAt: grade.updatedAt || todayISO(),
      queuedAt,
    });
  });
  const next = Array.from(byKey.values()).sort((a, b) => a.queuedAt - b.queuedAt);
  writePendingGradeSaves(next);
  return next;
}

function removeFlushedPendingGradeSaves(sent: PendingGradeSave[]): void {
  const sentByKey = new Map(sent.map((item) => [pendingGradeKey(item), item.queuedAt]));
  const remaining = readPendingGradeSaves().filter((item) => sentByKey.get(pendingGradeKey(item)) !== item.queuedAt);
  writePendingGradeSaves(remaining);
}

function notifyPendingGradeSyncIssue(getState: () => TeacherState, result: ApiResult): void {
  const now = Date.now();
  if (now - pendingGradeLastWarningAt < 15000) return;
  pendingGradeLastWarningAt = now;
  notifySyncFailure(
    getState,
    'مزامنة الدرجات المؤجلة',
    result.error || 'تعذر الاتصال بالشبكة. الدرجات محفوظة مؤقتاً وستُعاد المحاولة تلقائياً.',
  );
}

async function flushPendingGradeSaves(getState: () => TeacherState): Promise<void> {
  if (!canUseGradeOutbox()) return;
  if (pendingGradeFlushInFlight) return;

  const pending = readPendingGradeSaves();
  if (pending.length === 0) return;

  pendingGradeFlushInFlight = true;
  try {
    const chunk = pending.slice(0, 100);
    const result = await gradeApi.bulkAdd(chunk.map(gradeSaveForApi));

    if (result.ok) {
      removeFlushedPendingGradeSaves(chunk);
      const remaining = readPendingGradeSaves();
      if (remaining.length > 0) schedulePendingGradeFlush(getState, 300);
      return;
    }

    notifyPendingGradeSyncIssue(getState, result);
    schedulePendingGradeFlush(getState, result.transient ? 5000 : 15000);
  } finally {
    pendingGradeFlushInFlight = false;
  }
}

function schedulePendingGradeFlush(getState: () => TeacherState, delayMs = 700): void {
  if (!canUseGradeOutbox()) return;
  if (pendingGradeFlushTimer) clearTimeout(pendingGradeFlushTimer);
  pendingGradeFlushTimer = setTimeout(() => {
    pendingGradeFlushTimer = null;
    void flushPendingGradeSaves(getState);
  }, delayMs);
}

function attachPendingGradeBrowserEvents(getState: () => TeacherState): void {
  if (!canUseGradeOutbox() || pendingGradeBrowserEventsAttached) return;
  pendingGradeBrowserEventsAttached = true;
  window.addEventListener('online', () => schedulePendingGradeFlush(getState, 250));
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedulePendingGradeFlush(getState, 250);
  });
}

function queueGradeSaves(getState: () => TeacherState, grades: Grade[]): void {
  if (grades.length === 0) return;
  attachPendingGradeBrowserEvents(getState);
  mergePendingGradeSaves(grades);
  schedulePendingGradeFlush(getState);
}

type PersistedUiSnapshot = Pick<
  TeacherState,
  'theme' | 'studentPageSize' | 'gradePageSize' | 'currentUserId' | 'currentSection'
>;

function toPersistedUiSnapshot(state: Partial<TeacherState> | Record<string, unknown>): PersistedUiSnapshot {
  const theme = state.theme === 'dark' ? 'dark' : 'light';
  const studentPageSize = Number(state.studentPageSize || 10);
  const gradePageSize = Number(state.gradePageSize || 10);
  const currentUserId = typeof state.currentUserId === 'string' && state.currentUserId.trim()
    ? state.currentUserId
    : 'u_admin';
  const currentSection =
    typeof state.currentSection === 'string' &&
    Object.prototype.hasOwnProperty.call(SECTION_PERMISSIONS, state.currentSection)
      ? (state.currentSection as SectionId)
      : 'dashboard';

  return {
    theme,
    studentPageSize: Number.isFinite(studentPageSize) && studentPageSize > 0 ? studentPageSize : 10,
    gradePageSize: Number.isFinite(gradePageSize) && gradePageSize > 0 ? gradePageSize : 10,
    currentUserId,
    currentSection,
  };
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTeacherStore = create<TeacherState>()(
  persist(
    (set, get) => ({
      ...seedData(),

      currentSection: 'dashboard' as SectionId,
      sidebarOpen: false,
      theme: 'light' as 'light' | 'dark',
      studentPageSize: 10,
      gradePageSize: 10,
      currentUserId: 'u_admin',
      isAuthenticated: false,
      dbConnected: false,
      dbLoading: false,

      loadFromServer: async () => {
        set({ dbLoading: true });
        try {
          const serverData = await loadAllFromServer();
          if (!serverData) {
            set({ dbLoading: false, dbConnected: false });
            return false;
          }

          const serverCourses = (serverData.courses || []).map((c: Record<string, unknown>) => ({
            ...c,
            createdAt: c.createdAt ? String(c.createdAt).slice(0, 10) : todayISO(),
            active: c.active !== undefined ? Boolean(c.active) : true,
            availablePrograms: parseJsonArray<string>(c.availablePrograms),
            availableStudyTypes: getAvailableStudyTypes(c),
            studyTypesByProgram: getStudyTypesByProgram(c),
            locationConfig: parseJsonRecord<CourseLocationConfig>(c.locationConfig, {}),
          })) as Course[];
          const courses = mergeDefaultCourses(serverCourses);


          const chapters = (serverData.chapters || []).map((ch: Record<string, unknown>) => ({
            ...ch, opportunities: Number(ch.opportunities || 0),
          })) as Chapter[];

          const courseChapters = (serverData.courseChapters || []).map((cc: Record<string, unknown>) => ({
            ...cc, active: Boolean(cc.active), archived: Boolean(cc.archived),
            archive: parseArrayField<ArchiveEntry>(cc.archive),
          })) as CourseChapter[];

          const students = (serverData.students || []).map((st: Record<string, unknown>) => {
            const { groupId: _groupId, ...studentData } = st;
            void _groupId;
            return {
            ...studentData,
            school: String(st.school || ''),
            opportunities: Number(st.opportunities || 0),
            baseOpportunities: Number(st.baseOpportunities || 0),
            accountingGraceDays: normalizeGraceDaysValue(st.accountingGraceDays),
            dismissalNotes: String(st.dismissalNotes || ''),
            createdAt: st.createdAt ? String(st.createdAt).slice(0, 10) : todayISO(),
            courseProgram: String(st.courseProgram || ''),
            courseTerm: String(st.courseTerm || ''),
            studyType: String(st.studyType || ''),
            locationScope: String(st.locationScope || ''),
            baghdadMode: String(st.baghdadMode || ''),
          };
          }) as Student[];

          const exams = (serverData.exams || []).map((ex: Record<string, unknown>) => {
            const { groupId: _groupId, ...examData } = ex;
            void _groupId;
            return {
            ...examData,
            courseIds: parseArrayField<string>(ex.courseIds),
            mainSite: ex.mainSite ? String(ex.mainSite) : '',
            fullMark: Number(ex.fullMark || 100),
            passMark: Number(ex.passMark || 50),
            discountMark: Number(ex.discountMark || 0),
            opportunitiesPenalty: ex.opportunitiesPenalty === 'فصل مؤقت' ? 'فصل مؤقت' as const : Number(ex.opportunitiesPenalty || 1),
            dismissalGrade: ex.dismissalGrade === null || ex.dismissalGrade === undefined ? null : Number(ex.dismissalGrade),
            noDiscount: Boolean(ex.noDiscount),
            active: Boolean(ex.active),
            scheduledActivateAt: normalizeDateTimeValue(ex.scheduledActivateAt),
            scheduledDeactivateAt: normalizeDateTimeValue(ex.scheduledDeactivateAt),
            date: ex.date ? String(ex.date).slice(0, 10) : todayISO(),
          };
          }) as Exam[];

          const grades = mergePendingGradeSavesIntoGrades((serverData.grades || []).map((g: Record<string, unknown>) => ({
            ...g,
            status: sanitizeGradeStatus(g.status),
            score: g.score === null || g.score === undefined ? null : Number(g.score),
            academicAccountingChecked: Boolean(g.academicAccountingChecked),
            createdAt: g.createdAt ? String(g.createdAt).slice(0, 10) : todayISO(),
            updatedAt: g.updatedAt ? String(g.updatedAt).slice(0, 10) : todayISO(),
          })) as Grade[]);

          const opportunityLogs = (serverData.opportunityLogs || []).map((ol: Record<string, unknown>) => ({
            ...ol,
            amount: Number(ol.amount || 0),
            date: ol.date ? String(ol.date).slice(0, 10) : todayISO(),
          })) as OpportunityLog[];

          const studentLeaves = (serverData.studentLeaves || []).map((leave: Record<string, unknown>) => normalizeStudentLeave({
            ...leave,
            date: leave.date ? String(leave.date).slice(0, 10) : todayISO(),
            dateFrom: leave.dateFrom ? String(leave.dateFrom).slice(0, 10) : (leave.date ? String(leave.date).slice(0, 10) : todayISO()),
            dateTo: leave.dateTo ? String(leave.dateTo).slice(0, 10) : (leave.date ? String(leave.date).slice(0, 10) : todayISO()),
          }));

          const studentCalls = (serverData.studentCalls || []).map((call: Record<string, unknown>) => ({
            ...call,
            examId: String(call.examId || ''),
            status: String(call.status || (call.completed ? 'تم الاتصال' : 'لم يرد')),
            completed: Boolean(call.completed),
            completedAt: call.completedAt ? String(call.completedAt) : '',
            createdAt: call.createdAt ? String(call.createdAt).slice(0, 10) : todayISO(),
            notes: String(call.notes || ''),
          })) as StudentCall[];

          const studentNotes = (serverData.studentNotes || []).map((note: Record<string, unknown>) => ({
            ...note,
            kind: String(note.kind || ''),
            text: String(note.text || ''),
            sourceType: String(note.sourceType || ''),
            sourceId: String(note.sourceId || ''),
            dismissalKey: String(note.dismissalKey || ''),
            dismissalType: String(note.dismissalType || ''),
            dismissalReason: String(note.dismissalReason || ''),
            dismissalDate: note.dismissalDate ? String(note.dismissalDate).slice(0, 10) : '',
            date: note.date ? String(note.date).slice(0, 10) : todayISO(),
          })) as StudentNote[];

          const correctionSheets = (serverData.correctionSheets || []).map((cs: Record<string, unknown>) => ({
            ...cs,
            correctionErrors: Number(cs.correctionErrors || 0),
            sumErrors: Number(cs.sumErrors || 0),
          })) as CorrectionSheet[];

          const parsedUsers = (serverData.users || []).map((u: Record<string, unknown>) => ({
            ...u,
            // Passwords are no longer returned by the API. Keep this field empty
            // in client state unless the user explicitly enters a new password.
            password: undefined,
            permissions: sanitizePermissionIds(parseArrayField<string>(u.permissions)),
            active: u.active !== undefined ? Boolean(u.active) : true,
          })) as User[];
          const seedUsers = seedData().users;
          const adminSeed = seedUsers.find((u: User) => u.username === ADMIN_USERNAME)!;
          const previousSessionUser = get().users.find((u) => u.id === get().currentUserId);
          const keepAdminSession = get().isAuthenticated && hasFullAdminAccess(previousSessionUser);

          let users = parsedUsers.length > 0 ? parsedUsers : seedUsers;
          const hasPrimaryAdmin = users.some((u: User) => isPrimaryAdminUser(u));
          users = hasPrimaryAdmin
            ? users.map((u: User) => normalizeAdminAccessUser(u))
            : [...users, { ...adminSeed }];
          users = users.map((u: User) => normalizeAdminAccessUser(u));

          const parsedRoles = (serverData.roles || []).map((r: Record<string, unknown>) => ({
            ...r,
            permissions: sanitizePermissionIds(parseArrayField<string>(r.permissions)),
            isDefault: Boolean(r.isDefault),
          })) as Role[];
          const roles = mergeDefaultRoles(parsedRoles);
          const loadedAdmin = users.find((u) => isPrimaryAdminUser(u) && u.active) || users.find((u) => u.roleId === ADMIN_ROLE_ID && u.active);
          const currentUserStillExists = users.some((u) => u.id === get().currentUserId && u.active);
          const nextCurrentUserId = keepAdminSession && loadedAdmin
            ? loadedAdmin.id
            : currentUserStillExists
              ? get().currentUserId
              : get().isAuthenticated && loadedAdmin
                ? loadedAdmin.id
                : get().currentUserId;

          const logs = (serverData.logs || []).map((l: Record<string, unknown>) => ({
            id: String(l.id || uid('log')),
            user: String(l.user || l.userName || 'مدير النظام'),
            module: String(l.module || ''),
            action: String(l.action || ''),
            details: String(l.details || ''),
            time: l.time ? String(l.time) : nowText(),
          })) as LogEntry[];

          set({
            courses, chapters, courseChapters, students,
            exams, grades, opportunityLogs, studentLeaves, studentCalls, studentNotes, correctionSheets, users,
            roles, logs, currentUserId: nextCurrentUserId, dbConnected: true, dbLoading: false,
          });
          attachPendingGradeBrowserEvents(get);
          schedulePendingGradeFlush(get, 900);
          repairAbsentDiscountAccountingIfNeeded(get);

          // Note: we no longer auto-sync the admin user's role/permissions
          // on every load. That update required accounts.manage permission
          // which non-admin users (like supervisors) don't have, causing
          // 403 errors on every page load for them. The admin role is
          // managed via env vars + the accounts UI, not auto-overwritten.
          return true;
        } catch (e) {
          console.warn('[Store] Failed to load from server:', e);
          set({ dbLoading: false, dbConnected: false });
          return false;
        }
      },

      setSection: (section) => {
        const state = get();
        if (!state.canAccess(section)) {
          state.logAction('الصلاحيات', 'محاولة دخول مرفوضة', section);
          return;
        }
        if (state.currentSection === section && !state.sidebarOpen) return;
        set({ currentSection: section, sidebarOpen: false });
      },
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleTheme: () => set((s) => {
        const next = s.theme === 'dark' ? 'light' : 'dark';
        if (typeof document !== 'undefined') {
          document.documentElement.classList.toggle('dark', next === 'dark');
        }
        return { theme: next };
      }),

      currentUser: () => {
        const state = get();
        const user = state.users.find((u) => u.id === state.currentUserId && u.active)
          || (state.isAuthenticated ? state.users.find((u) => isPrimaryAdminUser(u) && u.active) : undefined)
          || null;
        return user ? normalizeAdminAccessUser(user) : null;
      },
      restoreSession: async () => {
        const wasAuthenticated = get().isAuthenticated;
        const authResult = await authApi.session();

        // Do not force logout an already-open session because of a temporary
        // network/server/database error. Only an explicit empty session means
        // the cookie is missing/expired and the user should return to login.
        if (!authResult.ok) {
          console.warn('[Store] Session check failed:', authResult.error || authResult.status || 'unknown error');
          if (wasAuthenticated) return true;
          set({ isAuthenticated: false });
          return false;
        }

        if (!authResult.user) {
          set({ isAuthenticated: false });
          return false;
        }

        const sessionUser = normalizeAdminAccessUser(userFromAuthApi(authResult.user));
        set((s) => ({
          users: s.users.some((u) => u.id === sessionUser.id)
            ? s.users.map((u) => u.id === sessionUser.id ? { ...u, ...sessionUser } : normalizeAdminAccessUser(u))
            : [...s.users.map((u) => normalizeAdminAccessUser(u)), sessionUser],
          roles: mergeDefaultRoles(s.roles),
          currentUserId: sessionUser.id,
          isAuthenticated: true,
        }));
        return true;
      },
      login: async (username, password) => {
        const authResult = await authApi.login(username, password);
        if (!authResult.ok || !authResult.user) {
          return { ok: false, message: authResult.error || 'اسم المستخدم أو كلمة المرور غير صحيحة' };
        }

        const sessionUser = normalizeAdminAccessUser(userFromAuthApi(authResult.user));
        set((s) => ({
          users: s.users.some((u) => u.id === sessionUser.id)
            ? s.users.map((u) => u.id === sessionUser.id ? { ...u, ...sessionUser } : normalizeAdminAccessUser(u))
            : [...s.users.map((u) => normalizeAdminAccessUser(u)), sessionUser],
          roles: mergeDefaultRoles(s.roles),
          currentUserId: sessionUser.id,
          isAuthenticated: true,
          currentSection: 'dashboard',
        }));

        // loadFromServer() is handled by the layout's useEffect when isAuthenticated becomes true.
        // Calling it here too causes a double-load that triggers React #185 infinite re-render.
        get().logAction('تسجيل الدخول', 'دخول للنظام', sessionUser.name);
        return { ok: true, message: 'تم تسجيل الدخول بنجاح' };
      },
      canAccess: (section) => {
        if (!get().isAuthenticated) return false;
        const user = get().currentUser();
        if (!user) return false;
        if (ADMIN_ONLY_SECTIONS.has(section as SectionId)) return hasFullAdminAccess(user);
        // Admin user always has full access to every section and tab.
        if (hasFullAdminAccess(user)) return true;
        // Check if user has the required permission for this section
        const requiredPermission = SECTION_PERMISSIONS[section as SectionId];
        if (!requiredPermission) return false;
        return user.permissions.includes(requiredPermission);
      },
      logout: () => {
        void authApi.logout();
        const admin = get().users.find((u) => isPrimaryAdminUser(u) && u.active) || get().users.find((u) => u.roleId === ADMIN_ROLE_ID && u.active);
        set({ currentUserId: admin?.id || 'u_admin', currentSection: 'dashboard', isAuthenticated: false });
        get().logAction('تسجيل الدخول', 'تسجيل خروج', 'إغلاق جلسة المستخدم');
      },

      courseName: (id) => get().courses.find((c) => c.id === id)?.name || 'غير محدد',
      chapterName: (id) => get().chapters.find((c) => c.id === id)?.name || 'غير محدد',
      studentName: (id) => get().students.find((s) => s.id === id)?.name || 'غير محدد',
      userName: (id) => get().users.find((u) => u.id === id)?.name || id || 'غير محدد',
      activeChapterForCourse: (courseId) => {
        const cc = get().courseChapters.find((x) => x.courseId === courseId && x.active && !x.archived);
        return cc ? get().chapters.find((c) => c.id === cc.chapterId) || null : null;
      },
      classification: (grade, exam, student) => {
        if (student && get().studentLeaves.some((leave) => studentLeaveAppliesToExam(leave, student.id, exam))) return { text: 'مجاز', type: 'info', kind: 'excused' };
        if (!grade || !isGradeEntered(grade, exam)) return { text: 'غير مسجل', type: 'neutral', kind: 'missing' };
        if (student && isExamWithinStudentGracePeriod(student, exam)) return { text: 'ضمن السماح', type: 'info', kind: 'grace' };
        if (student && !isExamOnOrAfterStudentRegistration(student, exam)) return { text: 'غير محتسب', type: 'info', kind: 'grace' };
        if (grade.status === 'غش') return { text: 'غش', type: 'danger', kind: 'cheat' };
        if (exam.noDiscount) {
          if (grade.status === 'درجة' && Number(grade.score || 0) >= exam.passMark) return { text: 'ناجح', type: 'ok', kind: 'pass' };
          return { text: 'بدون خصم', type: 'info', kind: 'no-discount' };
        }
        if (grade.status === 'غائب') {
          if (exam.type === 'فاينل') return { text: 'فصل', type: 'danger', kind: 'dismissal' };
          return { text: 'مخصوم', type: 'danger', kind: 'deducted' };
        }
        const score = Number(grade.score) || 0;
        if (exam.type === 'فاينل') {
          if (score === 0 || (exam.dismissalGrade !== null && score <= exam.dismissalGrade)) return { text: 'فصل', type: 'danger', kind: 'dismissal' };
          if (score >= exam.passMark) return { text: 'ناجح', type: 'ok', kind: 'pass' };
          return { text: 'راسب', type: 'danger', kind: 'fail' };
        }
        if (score >= exam.passMark) return { text: 'ناجح', type: 'ok', kind: 'pass' };
        if (score > exam.discountMark && score < exam.passMark) return { text: 'محاسبة رسوب', type: 'warn', kind: 'academic-accounting' };
        return { text: 'مخصوم', type: 'danger', kind: 'deducted' };
      },

      logAction: (module, action, details = '') => {
        const currentUser = get().currentUser();
        const user = currentUser?.name || 'مدير النظام';
        const log: LogEntry = { id: uid('log'), user, module, action, details, time: nowText() };
        set((s) => ({ logs: [log, ...s.logs] }));

        // لا نحاول إرسال السجل قبل تسجيل الدخول؛ هذا يمنع أخطاء 401 المتكررة
        // عند فتح الصفحة أو بعد تسجيل الخروج، مع إبقاء السجل محفوظاً محلياً.
        if (!get().isAuthenticated || !currentUser?.id) return;

        // تخطّي إرسال السجلات server-only للخادم؛ الخادم يرفضها بـ 403
        // (لأنها حساسة ويجب أن تُكتب من الـ server handler فقط).
        // نبقيها محلية للـ UI feedback فقط.
        if (isServerOnlyLogEntry(module, action)) return;

        syncToServer(get, () => logApi.add({ ...log, userName: user, userId: currentUser.id }));
      },

      clearLogs: async (password, options) => {
        const currentUser = get().currentUser();
        if (!currentUser || !hasFullAdminAccess(currentUser)) {
          return { ok: false, message: 'هذه العملية متاحة لمدير النظام فقط' };
        }
        if (!options?.scopeIds?.length) {
          return { ok: false, message: 'اختر نوعاً واحداً على الأقل من السجلات المراد تصفيرها' };
        }
        const result = await logApi.clear(password, options as unknown as Record<string, unknown>);
        if (!result.ok) {
          return { ok: false, message: result.error || 'تعذر تصفير السجلات' };
        }
        set((s) => ({
          logs: s.logs.filter((log) => !shouldClearAuditLogLocally(log, options)),
          opportunityLogs: s.opportunityLogs.filter((log) => !shouldClearOpportunityLogLocally(log, options)),
        }));
        return { ok: true, message: 'تم تصفير السجلات المحددة حسب الاختيارات والفترة الزمنية، وتم حفظ نسخة استعادة احتياطية' };
      },

      restoreLastLogClear: async (password) => {
        const currentUser = get().currentUser();
        if (!currentUser || !hasFullAdminAccess(currentUser)) {
          return { ok: false, message: 'هذه العملية متاحة لمدير النظام فقط' };
        }
        const result = await logApi.restoreLastClear(password);
        if (!result.ok) {
          return { ok: false, message: result.error || 'تعذر استعادة آخر تصفير' };
        }
        await get().loadFromServer();
        return { ok: true, message: 'تمت استعادة آخر عملية تصفير للسجلات بنجاح' };
      },

      addCourse: (courseInput) => {
        const nextCourse: Course = {
          id: uid('c'),
          createdAt: todayISO(),
          active: true,
          ...courseInput,
          availableStudyTypes: getAvailableStudyTypes(courseInput),
          studyTypesByProgram: getStudyTypesByProgram(courseInput),
        };
        set((s) => ({ courses: [...s.courses, nextCourse] }));
        get().logAction('الدورات', 'إضافة دورة', nextCourse.name);
        syncToServer(get, () => courseApi.add(nextCourse as unknown as Record<string, unknown>));
      },
      updateCourse: (id, updates) => {
        const course = get().courses.find(c => c.id === id);
        if (!course) return { ok: false, message: 'الدورة غير موجودة' };

        // Check if removing options used by students
        if (updates.availablePrograms || updates.studyTypesByProgram || updates.availableStudyTypes || updates.locationConfig) {
          const courseStudents = get().students.filter(s => s.courseId === id);
          const draftCourse = { ...course, ...updates };
          const nextPrograms = getAvailablePrograms(draftCourse);

          for (const student of courseStudents) {
            if (student.courseProgram && !(nextPrograms as readonly string[]).includes(student.courseProgram)) {
              return { ok: false, message: `لا يمكن إزالة "${student.courseProgram}" لأنه مستخدم من طلاب مسجلين` };
            }
            if (student.courseProgram && student.studyType) {
              const nextStudyTypes = getAvailableStudyTypesForProgram(draftCourse, student.courseProgram);
              if (!(nextStudyTypes as readonly string[]).includes(student.studyType)) {
                return { ok: false, message: `لا يمكن إزالة "${student.studyType}" من "${student.courseProgram}" لأنه مستخدم من طلاب مسجلين` };
              }
            }
          }
        }

        const normalizedUpdates = updates.studyTypesByProgram || updates.availablePrograms
          ? {
              ...updates,
              availableStudyTypes: getAvailableStudyTypes({ ...course, ...updates }),
              studyTypesByProgram: getStudyTypesByProgram({ ...course, ...updates }),
            }
          : updates;

        const previousCourses = get().courses;
        set((s) => ({ courses: s.courses.map((c) => c.id === id ? { ...c, ...normalizedUpdates } : c) }));
        get().logAction('الدورات', 'تعديل دورة', get().courseName(id));
        syncToServer(get, () => courseApi.update(id, normalizedUpdates as Record<string, unknown>), {
          description: 'تعديل دورة',
          rollback: () => set({ courses: previousCourses }),
        });
        return { ok: true, message: '' };
      },
      toggleCourse: (id) => {
        const previousCourses = get().courses;
        const course = previousCourses.find((c) => c.id === id);
        set((s) => ({ courses: s.courses.map((c) => c.id === id ? { ...c, active: !c.active } : c) }));
        get().logAction('الدورات', course?.active ? 'تعطيل دورة' : 'تفعيل دورة', course?.name || id);
        syncToServer(get, () => courseApi.update(id, { active: !course?.active }), {
          description: course?.active ? 'تعطيل دورة' : 'تفعيل دورة',
          rollback: () => set({ courses: previousCourses }),
        });
      },
      deleteCourse: (id) => {
        const state = get();
        const course = state.courses.find((c) => c.id === id);
        if (!course) return false;
        if (state.students.some((s) => s.courseId === id) || state.exams.some((e) => e.courseIds.includes(id))) {
          get().logAction('الدورات', 'رفض حذف دورة', `${course.name} مرتبطة بطلاب أو امتحانات`);
          return false;
        }
        // Delete related course/chapter links from DB
        state.courseChapters.filter(cc => cc.courseId === id).forEach(cc => syncToServer(get, () => courseChapterApi.remove(cc.id)));
        set((s) => ({
          courses: s.courses.filter((c) => c.id !== id),
          courseChapters: s.courseChapters.filter((cc) => cc.courseId !== id),
        }));
        get().logAction('الدورات', 'حذف دورة', course.name);
        syncToServer(get, () => courseApi.remove(id));
        return true;
      },

      addChapter: (name, opportunities) => {
        const chapter: Chapter = { id: uid('ch'), name, opportunities };
        set((s) => ({ chapters: [...s.chapters, chapter] }));
        get().logAction('الفصول والفرص', 'إضافة فصل', name);
        syncToServer(get, () => chapterApi.add(chapter));
      },
      updateChapter: (id, updates) => {
        set((s) => ({ chapters: s.chapters.map((ch) => ch.id === id ? { ...ch, ...updates } : ch) }));
        get().logAction('الفصول والفرص', 'تعديل فصل', get().chapterName(id));
        syncToServer(get, () => chapterApi.update(id, updates as Record<string, unknown>));
      },
      deleteChapter: (id) => {
        const chapter = get().chapters.find((ch) => ch.id === id);
        if (!chapter) return false;
        if (get().courseChapters.some((cc) => cc.chapterId === id && cc.active)) {
          get().logAction('الفصول والفرص', 'رفض حذف فصل', `${chapter.name} فعال حالياً`);
          return false;
        }
        // Delete related courseChapters from DB
        get().courseChapters.filter(cc => cc.chapterId === id).forEach(cc => syncToServer(get, () => courseChapterApi.remove(cc.id)));
        set((s) => ({ chapters: s.chapters.filter((ch) => ch.id !== id), courseChapters: s.courseChapters.filter((cc) => cc.chapterId !== id) }));
        get().logAction('الفصول والفرص', 'حذف فصل', chapter.name);
        syncToServer(get, () => chapterApi.remove(id));
        return true;
      },
      attachChapter: (courseId, chapterId) => {
        if (get().courseChapters.some((cc) => cc.courseId === courseId && cc.chapterId === chapterId && !cc.archived)) return;
        const previousCourseChapters = get().courseChapters;
        const cc: CourseChapter = { id: uid('cc'), courseId, chapterId, active: false, archived: false, archive: [] };
        set((s) => ({ courseChapters: [...s.courseChapters, cc] }));
        get().logAction('الفصول والفرص', 'ربط فصل بدورة', `${get().chapterName(chapterId)} - ${get().courseName(courseId)}`);
        syncToServer(get, () => courseChapterApi.add({ ...cc, archive: JSON.stringify(cc.archive) }), {
          description: 'ربط فصل بدورة',
          rollback: () => set({ courseChapters: previousCourseChapters }),
        });
      },
      toggleChapter: (courseChapterId, force = false) => {
        const state = get();
        const cc = state.courseChapters.find((x) => x.id === courseChapterId);
        if (!cc) return;
        const chapter = state.chapters.find((x) => x.id === cc.chapterId);
        if (!chapter) return;

        if (!cc.active) {
          const notZero = state.students.filter((s) => s.courseId === cc.courseId && s.opportunities !== 0);
          if (notZero.length > 0 && !force) return;
          set((s) => {
            const restoredArchive = new Map((cc.archive || []).map((entry) => [entry.studentId, entry.opportunities]));
            const courseChapters = s.courseChapters.map((x) => x.courseId === cc.courseId ? { ...x, active: false } : x);
            const idx = courseChapters.findIndex((x) => x.id === courseChapterId);
            if (idx >= 0) {
              courseChapters[idx] = { ...courseChapters[idx], active: true, archived: false, archive: cc.archive || [] };
            }
            const students = s.students.map((st) => {
              if (st.courseId !== cc.courseId) return st;
              const restored = restoredArchive.get(st.id);
              return {
                ...st,
                opportunities: restored !== undefined ? Number(restored) : chapter.opportunities,
                baseOpportunities: chapter.opportunities,
              };
            });
            return { courseChapters, students };
          });
          get().logAction('الفصول والفرص', cc.archive?.length ? 'تفعيل فصل واسترجاع أرشيف الفرص' : 'تفعيل فصل ومنح فرص جديدة', `${chapter.name} - ${get().courseName(cc.courseId)}`);
        } else {
          set((s) => ({
            courseChapters: s.courseChapters.map((x) => x.id === courseChapterId
              ? { ...x, active: false, archived: false, archive: s.students.filter((st) => st.courseId === cc.courseId).map((st) => ({ studentId: st.id, opportunities: st.opportunities, date: todayISO() })) }
              : x),
            students: s.students.map((st) => st.courseId === cc.courseId ? { ...st, opportunities: 0, baseOpportunities: 0 } : st),
          }));
          get().logAction('الفصول والفرص', 'إلغاء تفعيل فصل', `${chapter.name} - ${get().courseName(cc.courseId)}`);
        }
        // Sync the updated courseChapter to DB
        const previousCourseChapters = state.courseChapters;
        const previousStudents = state.students;
        const updatedCc = get().courseChapters.find(x => x.id === courseChapterId);
        if (updatedCc) syncToServer(get, () => courseChapterApi.update(courseChapterId, {
          active: updatedCc.active,
          archived: updatedCc.archived,
          archive: JSON.stringify(updatedCc.archive || []),
          syncStudentOpportunities: true,
          courseId: cc.courseId,
          chapterOpportunities: chapter.opportunities,
        }), {
          description: 'تفعيل/تعطيل فصل وتحديث فرص الطلاب دفعة واحدة',
          rollback: () => set({ courseChapters: previousCourseChapters, students: previousStudents }),
        });
      },
      deleteCourseChapter: (courseChapterId) => {
        const cc = get().courseChapters.find((x) => x.id === courseChapterId);
        if (!cc) return false;
        if (cc.active) return false;
        set((s) => ({ courseChapters: s.courseChapters.filter((x) => x.id !== courseChapterId) }));
        get().logAction('الفصول والفرص', 'حذف ربط فصل بدورة', `${get().chapterName(cc.chapterId)} - ${get().courseName(cc.courseId)}`);
        syncToServer(get, () => courseChapterApi.remove(courseChapterId));
        return true;
      },

      addStudent: (studentData) => {
        const state = get();
        const sanitizedStudentData = {
          ...studentData,
          name: studentData.name.trim(),
          school: studentData.school.trim(),
          phone: studentData.phone.trim(),
          parentPhone: studentData.parentPhone.trim(),
          telegram: sanitizeTelegramInput(studentData.telegram),
          accountingGraceDays: normalizeGraceDaysValue(studentData.accountingGraceDays),
        };
        const duplicateMessage = getStudentDuplicateMessage(state.students, sanitizedStudentData);
        if (duplicateMessage) {
          get().logAction('تسجيل الطلاب', 'رفض تسجيل طالب مكرر', `${sanitizedStudentData.name} - ${duplicateMessage}`);
          return { ok: false, message: duplicateMessage };
        }
        // Find the maximum existing code number to avoid duplicates after deletion
        const maxCodeNum = state.students.reduce((max, s) => {
          const match = s.code?.match(/^BIO-(\d+)$/);
          return match ? Math.max(max, parseInt(match[1], 10)) : max;
        }, 0);
        const code = `BIO-${String(maxCodeNum + 1).padStart(3, '0')}`;
        const student: Student = { ...sanitizedStudentData, id: uid('st'), code };
        set((s) => ({ students: [...s.students, student] }));
        get().logAction('تسجيل الطلاب', 'تسجيل طالب', `${student.name} - ${get().courseName(student.courseId)}`);
        syncToServer(get, async () => {
          const result = await studentApi.add(student as unknown as Record<string, unknown>);
          if (!result.ok) {
            set((s) => ({ students: s.students.filter((st) => st.id !== student.id) }));
            get().logAction('تسجيل الطلاب', 'تراجع تسجيل طالب', result.error || 'رفض الخادم حفظ الطالب');
          }
        });
        return { ok: true, message: 'تم تسجيل الطالب' };
      },
      updateStudent: (id, updates) => {
        const current = get().students.find((st) => st.id === id);
        if (!current) return { ok: false, message: 'تعذر العثور على الطالب' };
        const merged = {
          ...current,
          ...updates,
          name: updates.name !== undefined ? updates.name.trim() : current.name,
          school: updates.school !== undefined ? updates.school.trim() : current.school,
          phone: updates.phone !== undefined ? updates.phone.trim() : current.phone,
          parentPhone: updates.parentPhone !== undefined ? updates.parentPhone.trim() : current.parentPhone,
          telegram: updates.telegram !== undefined ? sanitizeTelegramInput(updates.telegram) : current.telegram,
          accountingGraceDays: updates.accountingGraceDays !== undefined ? normalizeGraceDaysValue(updates.accountingGraceDays) : current.accountingGraceDays,
        };
        const duplicateMessage = getStudentDuplicateMessage(get().students, merged, id);
        if (duplicateMessage) {
          get().logAction('سجل الطلاب', 'رفض تعديل طالب مكرر', `${merged.name} - ${duplicateMessage}`);
          return { ok: false, message: duplicateMessage.replace('إضافة', 'تعديل') };
        }
        const previousStudents = get().students;
        set((s) => ({ students: s.students.map((st) => st.id === id ? { ...st, ...merged } : st) }));
        get().logAction('سجل الطلاب', 'تعديل بيانات طالب', get().studentName(id));
        const apiUpdates: Record<string, unknown> = {
          name: merged.name,
          school: merged.school,
          gender: merged.gender,
          phone: merged.phone,
          parentPhone: merged.parentPhone,
          telegram: merged.telegram,
          courseProgram: merged.courseProgram,
          courseTerm: merged.courseTerm,
          studyType: merged.studyType,
          locationScope: merged.locationScope,
          baghdadMode: merged.baghdadMode,
          mainSite: merged.mainSite,
          subSite: merged.subSite,
          courseId: merged.courseId,
          status: merged.status,
          dismissalType: merged.dismissalType,
          dismissalReason: merged.dismissalReason,
          dismissalNotes: merged.dismissalNotes,
          createdAt: merged.createdAt,
          opportunities: merged.opportunities,
          baseOpportunities: merged.baseOpportunities,
          accountingGraceDays: merged.accountingGraceDays,
        };
        syncToServer(get, () => studentApi.update(id, apiUpdates), {
          description: 'تعديل بيانات طالب',
          rollback: () => set({ students: previousStudents }),
        });
        if (updates.accountingGraceDays !== undefined || updates.createdAt !== undefined) {
          get().recalculateAcademicEffects(id);
        }
        return { ok: true, message: 'تم تعديل بيانات الطالب' };
      },
      deleteStudent: (id) => {
        const student = get().students.find((st) => st.id === id);
        if (!student) return false;
        const previousState = {
          students: get().students,
          grades: get().grades,
          opportunityLogs: get().opportunityLogs,
          studentLeaves: get().studentLeaves,
          studentCalls: get().studentCalls,
          studentNotes: get().studentNotes,
          correctionSheets: get().correctionSheets,
        };
        set((s) => ({
          students: s.students.filter((st) => st.id !== id),
          grades: s.grades.filter((g) => g.studentId !== id),
          opportunityLogs: s.opportunityLogs.filter((log) => log.studentId !== id),
          studentLeaves: s.studentLeaves.filter((leave) => leave.studentId !== id),
          studentCalls: s.studentCalls.filter((call) => call.studentId !== id),
          studentNotes: s.studentNotes.filter((note) => note.studentId !== id),
          correctionSheets: s.correctionSheets.filter((sh) => sh.studentId !== id),
        }));
        get().logAction('سجل الطلاب', 'حذف طالب مع سجلاته التابعة', `${student.name} - ${student.code}`);
        syncToServer(get, () => studentApi.remove(id), {
          description: 'حذف طالب',
          rollback: () => set(previousState),
        });
        return true;
      },
      dismissStudent: (studentId, type, reason, notes = '') => {
        const stateBefore = get();
        const studentBefore = stateBefore.students.find((student) => student.id === studentId);
        const deductedOpportunities = Math.max(0, Math.trunc(Number(studentBefore?.opportunities || 0)));
        const finalChanceViolation = Boolean(studentBefore && hasFinalChanceForStudent(stateBefore.opportunityLogs, studentId) && type === 'فصل مؤقت');
        const nextDismissalType = finalChanceViolation ? 'فصل نهائي' : type;
        const nextDismissalReason = finalChanceViolation ? `عدم الالتزام بالتعهد السابق - ${reason}` : reason;
        const actionNote: StudentNote | null = studentBefore
          ? {
              id: uid('note'),
              studentId,
              kind: 'إجراء',
              text: `فصل الطالب (${nextDismissalType}): ${nextDismissalReason}${notes ? ` - ملاحظة: ${notes}` : ''}`,
              date: todayISO(),
            }
          : null;
        const deductionLog: OpportunityLog | null = deductedOpportunities > 0
          ? {
              id: uid('ol'),
              studentId,
              examId: '',
              action: 'خصم',
              amount: deductedOpportunities,
              reason: `فصل الطالب: ${nextDismissalReason}`,
              date: todayISO(),
              chapterId: stateBefore.activeChapterForCourse(studentBefore?.courseId || '')?.id || '',
            }
          : null;

        set((s) => ({
          students: s.students.map((st) => st.id === studentId
            ? { ...st, status: 'مفصول' as const, dismissalType: nextDismissalType, dismissalReason: nextDismissalReason, dismissalNotes: notes, opportunities: 0 }
            : st),
          opportunityLogs: deductionLog ? [deductionLog, ...s.opportunityLogs] : s.opportunityLogs,
          studentNotes: actionNote ? [actionNote, ...s.studentNotes] : s.studentNotes,
        }));
        get().logAction('الطلاب', `فصل الطالب (${nextDismissalType})`, `${get().studentName(studentId)} - ${nextDismissalReason}`);
        syncToServer(get, () => studentApi.update(studentId, { status: 'مفصول', dismissalType: nextDismissalType, dismissalReason: nextDismissalReason, dismissalNotes: notes, opportunities: 0 }));
        if (deductionLog) syncToServer(get, () => opportunityLogApi.add(deductionLog as unknown as Record<string, unknown>));
        if (actionNote) syncToServer(get, () => studentNoteApi.add(actionNote as unknown as Record<string, unknown>));
      },
      reactivateStudent: (studentId) => {
        const stateBefore = get();
        const studentBefore = stateBefore.students.find((st) => st.id === studentId);
        const shouldGrantFinalChance = Boolean(studentBefore?.status === 'مفصول');
        const academicReactivationSource = studentBefore && shouldGrantFinalChance
          ? findAcademicReactivationSourceForStudent(stateBefore, studentBefore)
          : null;
        const academicReactivationLink = academicReactivationSource
          ? ` ${encodeAcademicReactivationLink(academicReactivationSource)}`
          : '';
        const reactivationLog: OpportunityLog | null = studentBefore
          ? {
              id: uid('ol'),
              studentId,
              examId: academicReactivationSource?.sourceExamId || '',
              action: 'إعادة تفعيل',
              amount: 0,
              reason: `تثبيت إعادة التفعيل: لا يعاد فصل الطالب بسبب سجلات قديمة، وأي إجراء جديد بعد الفرصة يصبح نهائياً${academicReactivationLink}`,
              date: todayISO(),
              chapterId: stateBefore.activeChapterForCourse(studentBefore.courseId)?.id || '',
            }
          : null;
        const finalChanceLog: OpportunityLog | null = shouldGrantFinalChance && studentBefore
          ? {
              id: uid('ol'),
              studentId,
              examId: academicReactivationSource?.sourceExamId || '',
              action: 'فرصة أخيرة بعد تعهد',
              amount: 1,
              reason: `إرجاع الطالب بعد إعادة التفعيل بفرصة واحدة فقط${academicReactivationLink}`,
              date: todayISO(),
              chapterId: stateBefore.activeChapterForCourse(studentBefore.courseId)?.id || '',
            }
          : null;
        const actionNote: StudentNote | null = studentBefore
          ? {
              id: uid('note'),
              studentId,
              kind: 'إجراء',
              text: shouldGrantFinalChance
                ? `إعادة تفعيل الطالب ومنحه فرصة واحدة بعد الفصل السابق: ${studentBefore.dismissalReason || studentBefore.dismissalType || 'بدون سبب مسجل'}`
                : 'إعادة تفعيل الطالب',
              date: todayISO(),
            }
          : null;
        set((s) => ({
          students: s.students.map((st) => st.id === studentId
            ? { ...st, status: 'نشط' as const, dismissalType: '', dismissalReason: '', dismissalNotes: '', opportunities: shouldGrantFinalChance ? 1 : st.opportunities }
            : st),
          opportunityLogs: ([reactivationLog, finalChanceLog].filter(Boolean) as OpportunityLog[]).concat(s.opportunityLogs),
          studentNotes: actionNote ? [actionNote, ...s.studentNotes] : s.studentNotes,
        }));
        get().logAction('الطلاب', shouldGrantFinalChance ? 'إعادة تفعيل بفرصة واحدة' : 'إعادة تفعيل طالب', get().studentName(studentId));
        syncToServer(get, () => studentApi.update(studentId, { status: 'نشط', dismissalType: '', dismissalReason: '', dismissalNotes: '', ...(shouldGrantFinalChance ? { opportunities: 1 } : {}) }));
        if (reactivationLog) syncToServer(get, () => opportunityLogApi.add(reactivationLog as unknown as Record<string, unknown>));
        if (finalChanceLog) syncToServer(get, () => opportunityLogApi.add(finalChanceLog as unknown as Record<string, unknown>));
        if (actionNote) syncToServer(get, () => studentNoteApi.add(actionNote as unknown as Record<string, unknown>));
      },

      addExam: (examData) => {
        const exam: Exam = { ...examData, id: uid('ex') };
        set((s) => ({ exams: [...s.exams, exam] }));
        get().logAction('الامتحانات', 'إضافة امتحان', exam.name);
        syncToServer(get, () => examApi.add({ ...exam, courseIds: exam.courseIds, opportunitiesPenalty: String(exam.opportunitiesPenalty) }));
      },
      updateExam: (id, updates) => {
        const stateBefore = get();
        const exam = stateBefore.exams.find((e) => e.id === id);
        const affectedStudentIds = Array.from(new Set(
          stateBefore.grades
            .filter((grade) => grade.examId === id)
            .map((grade) => grade.studentId)
            .filter(Boolean),
        ));
        set((s) => ({ exams: s.exams.map((e) => e.id === id ? { ...e, ...updates } : e) }));
        get().logAction('الامتحانات', 'تعديل امتحان', exam?.name || id);
        syncToServer(get, () => examApi.update(id, updates as Record<string, unknown>));
        if (affectedStudentIds.length > 0) get().recalculateAcademicEffects(affectedStudentIds);
      },
      toggleExam: (id) => {
        const stateBefore = get();
        const exam = stateBefore.exams.find((e) => e.id === id);
        const affectedStudentIds = Array.from(new Set(
          stateBefore.grades
            .filter((grade) => grade.examId === id)
            .map((grade) => grade.studentId)
            .filter(Boolean),
        ));
        set((s) => ({ exams: s.exams.map((e) => e.id === id ? { ...e, active: !e.active } : e) }));
        get().logAction('الامتحانات', exam?.active ? 'تعطيل امتحان' : 'تفعيل امتحان', exam?.name || id);
        syncToServer(get, () => examApi.update(id, { active: !exam?.active }));
        if (affectedStudentIds.length > 0) get().recalculateAcademicEffects(affectedStudentIds);
      },
      deleteExam: (id) => {
        const state = get();
        const exam = state.exams.find((e) => e.id === id);
        if (!exam) return false;

        const relatedGrades = state.grades.filter((grade) => grade.examId === id);
        const relatedOpportunityLogs = state.opportunityLogs.filter((log) => opportunityLogBelongsToExam(log, id));
        const relatedCorrectionSheets = state.correctionSheets.filter((sheet) => sheet.examId === id);
        const relatedLeaves = state.studentLeaves.filter((leave) => leave.examId === id);
        const relatedCalls = state.studentCalls.filter((call) => call.examId === id);
        const affectedStudentIds = Array.from(new Set([
          ...relatedGrades.map((grade) => grade.studentId),
          ...relatedOpportunityLogs.map((log) => log.studentId),
          ...relatedLeaves.map((leave) => leave.studentId),
          ...relatedCalls.map((call) => call.studentId),
          ...relatedCorrectionSheets.map((sheet) => sheet.studentId),
        ].filter((studentId): studentId is string => Boolean(studentId))));
        const actionNotes: StudentNote[] = affectedStudentIds.map((studentId) => ({
          id: uid('note'),
          studentId,
          kind: 'إجراء',
          text: `حذف امتحان (${exam.name}) مع درجاته وإلغاء أي فصل أو خصم تلقائي مرتبط به`,
          date: todayISO(),
        }));

        relatedGrades.forEach((grade) => syncToServer(get, () => gradeApi.remove(grade.id, grade.studentId, grade.examId)));
        relatedOpportunityLogs
          .filter(isAcademicallyManagedOpportunityLog)
          .forEach((log) => syncToServer(get, () => opportunityLogApi.remove(log.id), { description: 'حذف إجراء أكاديمي مرتبط بامتحان محذوف' }));
        relatedCorrectionSheets.forEach((sheet) => syncToServer(get, () => correctionSheetApi.remove(sheet.id)));
        relatedLeaves.forEach((leave) => syncToServer(get, () => studentLeaveApi.remove(leave.id)));
        relatedCalls.forEach((call) => syncToServer(get, () => studentCallApi.remove(call.id)));

        set((s) => ({
          exams: s.exams.filter((e) => e.id !== id),
          grades: s.grades.filter((g) => g.examId !== id),
          correctionSheets: s.correctionSheets.filter((sh) => sh.examId !== id),
          opportunityLogs: s.opportunityLogs.filter((log) => !opportunityLogBelongsToExam(log, id)),
          studentLeaves: s.studentLeaves.filter((leave) => leave.examId !== id),
          studentCalls: s.studentCalls.filter((call) => call.examId !== id),
          studentNotes: actionNotes.length ? [...actionNotes, ...s.studentNotes] : s.studentNotes,
        }));

        actionNotes.forEach((note) => syncToServer(get, () => studentNoteApi.add(note as unknown as Record<string, unknown>)));
        get().recalculateAcademicEffects(affectedStudentIds);
        get().logAction('الامتحانات', 'حذف امتحان مع سجلاته وإعادة احتساب التأثيرات', exam.name);
        syncToServer(get, () => examApi.remove(id));
        return true;
      },

      addGrade: (gradeData) => {
        const stateBefore = get();
        if (isStudentExcusedForExam(stateBefore, gradeData.studentId, gradeData.examId)) {
          const examName = stateBefore.exams.find((exam) => exam.id === gradeData.examId)?.name || '';
          get().logAction('الدرجات', 'رفض إدخال درجة لطالب مجاز', `${get().studentName(gradeData.studentId)} - ${examName}`);
          return;
        }
        const existing = stateBefore.grades.find((g) => g.studentId === gradeData.studentId && g.examId === gradeData.examId);
        const normalizedGradeData = {
          ...gradeData,
          academicAccountingChecked: Boolean(gradeData.academicAccountingChecked),
        };
        const grade: Grade = existing
          ? {
              ...existing,
              ...normalizedGradeData,
              updatedAt: todayISO(),
            }
          : { ...normalizedGradeData, id: uid('gr'), createdAt: todayISO(), updatedAt: todayISO() };

        set((s) => ({ grades: existing ? s.grades.map((g) => g.id === existing.id ? grade : g) : [...s.grades, grade] }));
        get().logAction('الدرجات', existing ? 'تعديل درجة' : 'إدخال درجة', `${get().studentName(grade.studentId)} - ${stateBefore.exams.find((e) => e.id === grade.examId)?.name || ''}`);
        queueGradeSaves(get, [grade]);
        get().recalculateAcademicEffects(grade.studentId);
      },
      bulkAddGrades: (gradeItems) => {
        const stateBefore = get();
        const now = todayISO();
        const validItems = gradeItems.filter((item) => {
          if (isStudentExcusedForExam(stateBefore, item.studentId, item.examId)) {
            const examName = stateBefore.exams.find((exam) => exam.id === item.examId)?.name || '';
            get().logAction('الدرجات', 'رفض إدخال جماعي لطالب مجاز', `${get().studentName(item.studentId)} - ${examName}`);
            return false;
          }
          return true;
        });

        if (validItems.length === 0) return { added: 0, updated: 0 };

        const affectedStudentIds = new Set<string>();
        const nextGrades = [...stateBefore.grades];
        const gradesToSync: Grade[] = [];
        let added = 0;
        let updated = 0;

        validItems.forEach((item) => {
          const existingIndex = nextGrades.findIndex((grade) => grade.studentId === item.studentId && grade.examId === item.examId);
          const normalized: Grade = existingIndex >= 0
            ? {
                ...nextGrades[existingIndex],
                ...item,
                status: item.status,
                score: item.score,
                notes: item.notes,
                academicAccountingChecked: Boolean(item.academicAccountingChecked),
                updatedAt: now,
              }
            : {
                ...item,
                id: uid('gr'),
                academicAccountingChecked: Boolean(item.academicAccountingChecked),
                createdAt: now,
                updatedAt: now,
              };

          if (existingIndex >= 0) {
            nextGrades[existingIndex] = normalized;
            updated += 1;
          } else {
            nextGrades.push(normalized);
            added += 1;
          }
          gradesToSync.push(normalized);
          affectedStudentIds.add(normalized.studentId);
        });

        set({ grades: nextGrades });
        const examNames = Array.from(new Set(gradesToSync.map((grade) => stateBefore.exams.find((exam) => exam.id === grade.examId)?.name || 'امتحان'))).join('، ');
        get().logAction('الدرجات', 'إضافة درجات جماعية', `${gradesToSync.length} درجة - ${examNames}`);
        queueGradeSaves(get, gradesToSync);
        get().recalculateAcademicEffects(Array.from(affectedStudentIds));
        return { added, updated };
      },
      updateGrade: (id, updates) => {
        const stateBefore = get();
        const existingGrade = stateBefore.grades.find((g) => g.id === id);
        const nextStudentId = updates.studentId || existingGrade?.studentId || '';
        const nextExamId = updates.examId || existingGrade?.examId || '';
        if (nextStudentId && nextExamId && isStudentExcusedForExam(stateBefore, nextStudentId, nextExamId)) {
          const examName = stateBefore.exams.find((exam) => exam.id === nextExamId)?.name || '';
          get().logAction('الدرجات', 'رفض تعديل درجة لطالب مجاز', `${get().studentName(nextStudentId)} - ${examName}`);
          return;
        }
        const previousState = { students: stateBefore.students, grades: stateBefore.grades, opportunityLogs: stateBefore.opportunityLogs };
        const affectedStudentIds = [existingGrade?.studentId, updates.studentId].filter(Boolean) as string[];
        set((s) => ({ grades: s.grades.map((g) => g.id === id ? { ...g, ...updates, updatedAt: todayISO() } : g) }));
        get().logAction('الدرجات', 'تعديل مباشر للدرجة', id);
        syncToServer(get, () => gradeApi.update(id, {
          ...updates,
          ...(existingGrade ? { studentId: existingGrade.studentId, examId: existingGrade.examId } : {}),
        } as Record<string, unknown>), {
          description: 'تعديل درجة',
          rollback: () => set(previousState),
        });
        if (affectedStudentIds.length > 0) get().recalculateAcademicEffects(affectedStudentIds);
      },
      deleteGrade: (id) => {
        const stateBefore = get();
        const grade = stateBefore.grades.find((g) => g.id === id);
        if (!grade) return false;
        const examName = stateBefore.exams.find((e) => e.id === grade.examId)?.name || 'امتحان محذوف';
        const previousState = { students: stateBefore.students, grades: stateBefore.grades, opportunityLogs: stateBefore.opportunityLogs, studentNotes: stateBefore.studentNotes };
        const actionNote: StudentNote = {
          id: uid('note'),
          studentId: grade.studentId,
          kind: 'إجراء',
          text: `حذف درجة من امتحان (${examName}) وإعادة احتساب حالة الطالب والفرص`,
          date: todayISO(),
        };
        set((s) => ({ grades: s.grades.filter((g) => g.id !== id), studentNotes: [actionNote, ...s.studentNotes] }));
        get().logAction('الدرجات', 'حذف درجة', `${get().studentName(grade.studentId)} - ${examName}`);
        syncToServer(get, () => gradeApi.remove(id, grade.studentId, grade.examId), {
          description: 'حذف درجة',
          rollback: () => set(previousState),
        });
        syncToServer(get, () => studentNoteApi.add(actionNote as unknown as Record<string, unknown>));
        get().recalculateAcademicEffects(grade.studentId);
        return true;
      },
      clearAbsentGradesForExam: (examId) => {
        const stateBefore = get();
        const exam = stateBefore.exams.find((item) => item.id === examId);
        const absentGrades = stateBefore.grades.filter((grade) => grade.examId === examId && grade.status === 'غائب');
        if (!exam || absentGrades.length === 0) return 0;

        const affectedStudentIds = Array.from(new Set(absentGrades.map((grade) => grade.studentId)));
        const previousState = {
          students: stateBefore.students,
          grades: stateBefore.grades,
          opportunityLogs: stateBefore.opportunityLogs,
        };

        set((s) => ({
          grades: s.grades.filter((grade) => !(grade.examId === examId && grade.status === 'غائب')),
        }));
        get().logAction(
          'الدرجات',
          'إلغاء حالة غائب جماعي',
          `${exam.name} - ${absentGrades.length} طالب`,
        );
        syncToServer(get, () => gradeApi.removeAbsentByExam(examId), {
          description: 'إلغاء حالة غائب جماعي',
          rollback: () => set(previousState),
        });
        get().recalculateAcademicEffects(affectedStudentIds);
        return absentGrades.length;
      },
      recalculateAcademicEffects: (studentIds) => {
        const before = get();
        const targetStudentIds = Array.isArray(studentIds)
          ? new Set(studentIds.filter(Boolean))
          : studentIds
            ? new Set([studentIds])
            : undefined;
        const recalculated = recalculateStudentsFromAcademicRules(before, targetStudentIds);
        const oldAutomaticLogs = before.opportunityLogs.filter(isAutomaticOpportunityLog);
        const oldAcademicallyManagedLogs = before.opportunityLogs.filter(isAcademicallyManagedOpportunityLog);
        const studentsById = new Map(before.students.map((student) => [student.id, student]));
        set({ students: recalculated.students, opportunityLogs: recalculated.opportunityLogs });
        recalculated.students.forEach((student) => {
          if (targetStudentIds && !targetStudentIds.has(student.id)) return;
          const oldStudent = studentsById.get(student.id);
          if (!oldStudent) return;
          if (
            oldStudent.opportunities !== student.opportunities ||
            oldStudent.status !== student.status ||
            oldStudent.dismissalType !== student.dismissalType ||
            oldStudent.dismissalReason !== student.dismissalReason
          ) {
            syncToServer(get, () => studentApi.update(student.id, {
              opportunities: student.opportunities,
              status: student.status,
              dismissalType: student.dismissalType,
              dismissalReason: student.dismissalReason,
            }));
          }
        });
        const nextAutomaticLogs = recalculated.opportunityLogs.filter(isAutomaticOpportunityLog);
        const nextAcademicallyManagedLogs = recalculated.opportunityLogs.filter(isAcademicallyManagedOpportunityLog);
        oldAcademicallyManagedLogs
          .filter((oldLog) => !nextAcademicallyManagedLogs.some((nextLog) => nextLog.id === oldLog.id))
          .forEach((oldLog) => syncToServer(get, () => opportunityLogApi.remove(oldLog.id), { description: 'حذف إجراء أكاديمي ملغى' }));
        nextAutomaticLogs
          .filter((nextLog) => {
            const oldLog = oldAutomaticLogs.find((item) => item.id === nextLog.id);
            return !oldLog
              || oldLog.action !== nextLog.action
              || oldLog.amount !== nextLog.amount
              || oldLog.reason !== nextLog.reason
              || oldLog.date !== nextLog.date
              || oldLog.chapterId !== nextLog.chapterId
              || oldLog.examId !== nextLog.examId;
          })
          .forEach((log) => syncToServer(get, () => opportunityLogApi.add(log as unknown as Record<string, unknown>), { description: 'حفظ إجراء تلقائي' }));
      },
      adjustOpportunities: (studentId, amount, reason) => {
        const stateBefore = get();
        const studentBefore = stateBefore.students.find((st) => st.id === studentId);
        if (!studentBefore || !stateBefore.activeChapterForCourse(studentBefore.courseId)) {
          get().logAction('إدارة الفرص', 'رفض حركة فرص بدون فصل نشط', `${studentBefore?.name || studentId} - ${reason}`);
          return;
        }
        const action = amount > 0 ? 'إضافة' : 'خصم';
        const normalizedAmount = Math.max(1, Math.trunc(Math.abs(Number(amount) || 0)));
        const signedAmount = amount > 0 ? normalizedAmount : -normalizedAmount;
        const log: OpportunityLog = { id: uid('ol'), studentId, examId: '', action, amount: normalizedAmount, reason, date: todayISO(), chapterId: stateBefore.activeChapterForCourse(studentBefore?.courseId || '')?.id || '' };
        set((s) => {
          const students = s.students.map((st) => st.id === studentId ? { ...st, opportunities: Math.max(0, st.opportunities + signedAmount) } : st);
          return { students, opportunityLogs: [log, ...s.opportunityLogs] };
        });
        get().logAction('إدارة الفرص', amount > 0 ? 'إضافة فرصة' : 'خصم فرصة', `${get().studentName(studentId)} - ${normalizedAmount} - ${reason}`);
        const student = get().students.find((s) => s.id === studentId);
        if (student) syncToServer(get, () => studentApi.update(studentId, { opportunities: student.opportunities }));
        syncToServer(get, () => opportunityLogApi.add(log as unknown as Record<string, unknown>));
        if (student && student.opportunities === 0 && student.status === 'نشط') {
          const hasFinalChance = hasFinalChanceForStudent(get().opportunityLogs, studentId);
          get().dismissStudent(
            studentId,
            hasFinalChance ? 'فصل نهائي' : 'فصل مؤقت',
            hasFinalChance ? 'عدم الالتزام بالتعهد السابق - انتهاء الفرصة الأخيرة' : 'انتهاء الفرص',
          );
        }
      },
      bulkAdjustOpportunities: (studentIds, amount, reason, options = {}) => {
        const stateBefore = get();
        const normalizedAmount = Math.max(1, Math.trunc(Math.abs(Number(amount) || 0)));
        const signedAmount = amount > 0 ? normalizedAmount : -normalizedAmount;
        const action = signedAmount > 0 ? 'إضافة' : 'خصم';
        const uniqueStudentIds = Array.from(new Set(studentIds.filter(Boolean)));
        const eligibleStudents = uniqueStudentIds
          .map((id) => stateBefore.students.find((student) => student.id === id) || null)
          .filter((student): student is Student => Boolean(student && stateBefore.activeChapterForCourse(student.courseId)));
        const skipped = uniqueStudentIds.length - eligibleStudents.length;
        if (!eligibleStudents.length) {
          get().logAction('إدارة الفرص', 'رفض عملية جماعية بدون طلاب مؤهلين', reason);
          return { affected: 0, skipped };
        }

        const batchId = uid('batch');
        const datedReason = `عملية جماعية (${batchId}): ${reason}`;
        const logs: OpportunityLog[] = eligibleStudents.map((student) => ({
          id: uid('ol'),
          studentId: student.id,
          examId: '',
          action,
          amount: normalizedAmount,
          reason: datedReason,
          date: todayISO(),
          chapterId: stateBefore.activeChapterForCourse(student.courseId)?.id || '',
        }));

        const eligibleStudentIds = new Set(eligibleStudents.map((student) => student.id));
        const opportunityLogsAfterAdjustment = [...logs, ...stateBefore.opportunityLogs];
        const adjustedStudents = stateBefore.students.map((student) => {
          if (!eligibleStudentIds.has(student.id)) return student;
          return { ...student, opportunities: Math.max(0, student.opportunities + signedAmount) };
        });

        const dismissalEffects = adjustedStudents
          .filter((student) => eligibleStudentIds.has(student.id) && student.opportunities === 0 && student.status === 'نشط')
          .map((student) => {
            const hasFinalChance = hasFinalChanceForStudent(opportunityLogsAfterAdjustment, student.id);
            const dismissalType = hasFinalChance ? 'فصل نهائي' : 'فصل مؤقت';
            const dismissalReason = hasFinalChance ? 'عدم الالتزام بالتعهد السابق - انتهاء الفرصة الأخيرة' : 'انتهاء الفرص';
            const note: StudentNote = {
              id: uid('note'),
              studentId: student.id,
              kind: 'إجراء',
              text: `فصل الطالب (${dismissalType}): ${dismissalReason}`,
              date: todayISO(),
            };
            return { studentId: student.id, dismissalType, dismissalReason, note };
          });
        const reactivationEffects = signedAmount > 0 && options.reactivateDismissedOnAdd
          ? adjustedStudents
              .filter((student) => eligibleStudentIds.has(student.id) && student.status === 'مفصول' && student.opportunities > 0)
              .map((student) => {
                const note: StudentNote = {
                  id: uid('note'),
                  studentId: student.id,
                  kind: 'إجراء',
                  text: 'إعادة تفعيل تلقائية بعد إضافة فرصة جماعية',
                  date: todayISO(),
                };
                return { studentId: student.id, note };
              })
          : [];
        const dismissalByStudentId = new Map(dismissalEffects.map((effect) => [effect.studentId, effect]));
        const reactivationByStudentId = new Map(reactivationEffects.map((effect) => [effect.studentId, effect]));
        const effectNotes = [...dismissalEffects.map((effect) => effect.note), ...reactivationEffects.map((effect) => effect.note)];
        const nextStudents = adjustedStudents.map((student) => {
          const dismissal = dismissalByStudentId.get(student.id);
          if (dismissal) {
            return {
              ...student,
              status: 'مفصول' as const,
              dismissalType: dismissal.dismissalType,
              dismissalReason: dismissal.dismissalReason,
              dismissalNotes: '',
              opportunities: 0,
            };
          }
          const reactivation = reactivationByStudentId.get(student.id);
          if (reactivation) {
            return {
              ...student,
              status: 'نشط' as const,
              dismissalType: '',
              dismissalReason: '',
              dismissalNotes: '',
            };
          }
          return student;
        });

        set((s) => ({
          students: nextStudents,
          opportunityLogs: [...logs, ...s.opportunityLogs],
          studentNotes: [...effectNotes, ...s.studentNotes],
        }));

        get().logAction(
          'إدارة الفرص',
          signedAmount > 0 ? 'إضافة فرص جماعية' : 'خصم فرص جماعي',
          `${eligibleStudents.length} طالب - ${normalizedAmount} - ${reason}${skipped ? ` - تم تجاوز ${skipped} بدون فصل نشط` : ''}`,
        );
        dismissalEffects.forEach((effect) => {
          get().logAction('الطلاب', `فصل الطالب (${effect.dismissalType})`, `${get().studentName(effect.studentId)} - ${effect.dismissalReason}`);
        });
        reactivationEffects.forEach((effect) => {
          get().logAction('الطلاب', 'إعادة تفعيل تلقائية', `${get().studentName(effect.studentId)} - إضافة فرصة جماعية`);
        });

        const nextState = get();
        const studentPayload = eligibleStudents
          .map((studentBefore) => {
            const student = nextState.students.find((item) => item.id === studentBefore.id);
            if (!student) return null;
            const payload: Record<string, unknown> = {
              id: student.id,
              opportunities: student.opportunities,
            };
            const dismissal = dismissalByStudentId.get(student.id);
            if (dismissal) {
              payload.status = 'مفصول';
              payload.dismissalType = dismissal.dismissalType;
              payload.dismissalReason = dismissal.dismissalReason;
              payload.dismissalNotes = '';
            } else if (reactivationByStudentId.has(student.id)) {
              payload.status = 'نشط';
              payload.dismissalType = '';
              payload.dismissalReason = '';
              payload.dismissalNotes = '';
            }
            return payload;
          })
          .filter((item): item is Record<string, unknown> => Boolean(item));

        syncToServer(
          get,
          () => opportunityLogApi.bulkAdjust({
            students: studentPayload,
            opportunityLogs: logs as unknown as Array<Record<string, unknown>>,
            studentNotes: effectNotes as unknown as Array<Record<string, unknown>>,
          }),
          { description: 'حفظ تحديث فرص جماعي بطلب واحد' },
        );

        return { affected: eligibleStudents.length, skipped };
      },
      addStudentLeave: (leaveData) => {
        const stateBefore = get();
        const leave: StudentLeave = normalizeStudentLeave({ ...leaveData, id: uid('lv') });
        const affectedExamIds = affectedExamIdsForLeave(leave, stateBefore);
        const affectedExamIdSet = new Set(affectedExamIds);
        const existingGrades = stateBefore.grades.filter((grade) => grade.studentId === leave.studentId && affectedExamIdSet.has(grade.examId));
        const previousState = {
          students: stateBefore.students,
          grades: stateBefore.grades,
          opportunityLogs: stateBefore.opportunityLogs,
          studentLeaves: stateBefore.studentLeaves,
          studentNotes: stateBefore.studentNotes,
        };
        const leaveLabel = leave.leaveType === 'period'
          ? `فترة ${formatAppDate(leave.dateFrom)} إلى ${formatAppDate(leave.dateTo)}`
          : `امتحان (${stateBefore.exams.find((exam) => exam.id === leave.examId)?.name || 'امتحان محذوف'})`;
        const removedGradeDetails = existingGrades.map((grade) => {
          const exam = stateBefore.exams.find((item) => item.id === grade.examId);
          return `${exam?.name || 'امتحان محذوف'}: ${formatGradeScore(grade, exam, '—')}`;
        });
        const removedGradeNote: StudentNote | null = existingGrades.length
          ? {
              id: uid('note'),
              studentId: leave.studentId,
              kind: 'إجراء',
              text: `إضافة إجازة ${leaveLabel}: تم حذف درجة الطالب (${removedGradeDetails.join('، ')}) لأن الطالب أصبح مجازًا، وإلغاء أي إجراء أكاديمي تلقائي مرتبط بها`,
              date: todayISO(),
            }
          : {
              id: uid('note'),
              studentId: leave.studentId,
              kind: 'إجراء',
              text: `إضافة إجازة ${leaveLabel}: إلغاء محاسبة الطالب ضمن نطاق الإجازة`,
              date: todayISO(),
            };

        set((s) => ({
          studentLeaves: [
            leave,
            ...s.studentLeaves.filter((item) => {
              const normalized = normalizeStudentLeave(item);
              if (normalized.id === leave.id) return false;
              if (leave.leaveType === 'exam') return !(normalized.studentId === leave.studentId && normalized.leaveType === 'exam' && normalized.examId === leave.examId);
              return !(
                normalized.studentId === leave.studentId &&
                normalized.leaveType === 'period' &&
                normalized.dateFrom === leave.dateFrom &&
                normalized.dateTo === leave.dateTo
              );
            }),
          ],
          grades: s.grades.filter((grade) => !(grade.studentId === leave.studentId && affectedExamIdSet.has(grade.examId))),
          studentNotes: [removedGradeNote, ...s.studentNotes],
        }));
        get().logAction('المتابعة', 'إضافة إجازة', `${get().studentName(leave.studentId)} - ${leave.reason} - ${leaveLabel}`);
        existingGrades.forEach((grade) => {
          const exam = stateBefore.exams.find((item) => item.id === grade.examId);
          const examName = exam?.name || '';
          get().logAction('الدرجات', 'إزالة درجة بسبب الإجازة', `${get().studentName(leave.studentId)} - ${examName} - الدرجة المحذوفة: ${formatGradeScore(grade, exam, '—')} لأن الطالب أصبح مجازًا`);
          syncToServer(get, () => gradeApi.remove(grade.id, grade.studentId, grade.examId), { description: 'حذف درجة بسبب إجازة' });
        });
        syncToServer(get, () => studentNoteApi.add(removedGradeNote as unknown as Record<string, unknown>));
        syncToServer(get, () => studentLeaveApi.add(leave as unknown as Record<string, unknown>), {
          description: 'إضافة إجازة',
          rollback: () => set(previousState),
        });
        get().recalculateAcademicEffects(leave.studentId);
      },
      deleteStudentLeave: (id) => {
        const stateBefore = get();
        const deletedLeave = stateBefore.studentLeaves.find((leave) => leave.id === id);
        const previousState = {
          students: stateBefore.students,
          opportunityLogs: stateBefore.opportunityLogs,
          studentLeaves: stateBefore.studentLeaves,
          studentNotes: stateBefore.studentNotes,
        };
        const actionNote: StudentNote | null = deletedLeave ? {
          id: uid('note'),
          studentId: deletedLeave.studentId,
          kind: 'إجراء',
          text: `حذف إجازة (${deletedLeave.reason}) وإعادة تفعيل محاسبة الطالب ضمن نطاقها`,
          date: todayISO(),
        } : null;
        set((s) => ({
          studentLeaves: s.studentLeaves.filter((leave) => leave.id !== id),
          studentNotes: actionNote ? [actionNote, ...s.studentNotes] : s.studentNotes,
        }));
        get().logAction('المتابعة', 'حذف إجازة', id);
        if (actionNote) syncToServer(get, () => studentNoteApi.add(actionNote as unknown as Record<string, unknown>));
        syncToServer(get, () => studentLeaveApi.remove(id), {
          description: 'حذف إجازة',
          rollback: () => set(previousState),
        });
        if (deletedLeave) get().recalculateAcademicEffects(deletedLeave.studentId);
      },
      addStudentCall: (callData) => {
        const previousCalls = get().studentCalls;
        const call: StudentCall = { ...callData, id: uid('call'), createdAt: todayISO() };
        set((s) => ({ studentCalls: [call, ...s.studentCalls] }));
        get().logAction('المتابعة', 'تسجيل مكالمة', get().studentName(call.studentId));
        syncToServer(get, () => studentCallApi.add(call as unknown as Record<string, unknown>), {
          description: 'تسجيل مكالمة',
          rollback: () => set({ studentCalls: previousCalls }),
        });
      },
      updateStudentCall: (id, updates) => {
        const previousCalls = get().studentCalls;
        set((s) => ({ studentCalls: s.studentCalls.map((call) => call.id === id ? { ...call, ...updates } : call) }));
        syncToServer(get, () => studentCallApi.update(id, updates as Record<string, unknown>), {
          description: 'تحديث مكالمة',
          rollback: () => set({ studentCalls: previousCalls }),
        });
      },
      addStudentNote: (noteData) => {
        const previousNotes = get().studentNotes;
        const note: StudentNote = { ...noteData, id: uid('note') };
        set((s) => ({ studentNotes: [note, ...s.studentNotes] }));
        get().logAction('المتابعة', 'إضافة ملاحظة', get().studentName(note.studentId));
        syncToServer(get, () => studentNoteApi.add(note as unknown as Record<string, unknown>), {
          description: 'إضافة ملاحظة',
          rollback: () => set({ studentNotes: previousNotes }),
        });
      },
      deleteStudentNote: (id) => {
        const previousNotes = get().studentNotes;
        set((s) => ({ studentNotes: s.studentNotes.filter((note) => note.id !== id) }));
        syncToServer(get, () => studentNoteApi.remove(id), {
          description: 'حذف ملاحظة',
          rollback: () => set({ studentNotes: previousNotes }),
        });
      },

      resetOpportunities: (studentId) => {
        const studentBefore = get().students.find((st) => st.id === studentId);
        if (!studentBefore || !get().activeChapterForCourse(studentBefore.courseId)) {
          get().logAction('إدارة الفرص', 'رفض إعادة تعيين بدون فصل نشط', studentBefore?.name || studentId);
          return;
        }
        const log: OpportunityLog = { id: uid('ol'), studentId, examId: '', action: 'إعادة تعيين', amount: studentBefore?.baseOpportunities || 0, reason: 'إعادة تعيين الفرص', date: todayISO(), chapterId: '' };
        set((s) => {
          const students = s.students.map((st) => st.id === studentId ? { ...st, opportunities: st.baseOpportunities } : st);
          return { students, opportunityLogs: [log, ...s.opportunityLogs] };
        });
        get().logAction('إدارة الفرص', 'إعادة تعيين فرص', get().studentName(studentId));
        const updatedStudent = get().students.find(st => st.id === studentId);
        if (updatedStudent) syncToServer(get, () => studentApi.update(studentId, { opportunities: updatedStudent.opportunities }));
        syncToServer(get, () => opportunityLogApi.add(log as unknown as Record<string, unknown>));
      },
      undoOpportunityLog: (logId) => {
        const log = get().opportunityLogs.find((item) => item.id === logId);
        const student = log ? get().students.find((item) => item.id === log.studentId) : null;
        if (!log || !student) return false;
        if (!get().activeChapterForCourse(student.courseId)) {
          get().logAction('إدارة الفرص', 'رفض تراجع بدون فصل نشط', `${student.name} - ${log.action}`);
          return false;
        }
        if (log.action === 'إضافة') {
          get().adjustOpportunities(log.studentId, -Math.abs(log.amount), `تراجع عن إضافة: ${log.reason || ''}`.trim());
          get().logAction('إدارة الفرص', 'تراجع عن إضافة فرصة', `${student.name} - ${log.amount}`);
          return true;
        }
        if (log.action === 'خصم') {
          get().adjustOpportunities(log.studentId, Math.abs(log.amount), `تراجع عن خصم: ${log.reason || ''}`.trim());
          get().logAction('إدارة الفرص', 'تراجع عن خصم فرصة', `${student.name} - ${log.amount}`);
          return true;
        }
        get().logAction('إدارة الفرص', 'رفض تراجع حركة غير قابلة للعكس', `${student.name} - ${log.action}`);
        return false;
      },

      addCorrectionSheet: (sheet) => {
        const entry: CorrectionSheet = { ...sheet, id: uid('sh') };
        set((s) => ({ correctionSheets: [...s.correctionSheets, entry] }));
        get().logAction('التصحيح الإلكتروني', 'إضافة ورقة تصحيح', `${get().studentName(sheet.studentId)} - ${get().userName(sheet.correctorId)}`);
        syncToServer(get, () => correctionSheetApi.add(entry as unknown as Record<string, unknown>));
      },
      updateCorrectionSheet: (id, updates) => {
        set((s) => ({ correctionSheets: s.correctionSheets.map((sh) => sh.id === id ? { ...sh, ...updates } : sh) }));
        get().logAction('التصحيح الإلكتروني', 'تعديل ورقة تصحيح', id);
        syncToServer(get, () => correctionSheetApi.update(id, updates as Record<string, unknown>));
      },
      deleteCorrectionSheet: (id) => {
        const sheet = get().correctionSheets.find((sh) => sh.id === id);
        if (!sheet) return false;
        set((s) => ({ correctionSheets: s.correctionSheets.filter((sh) => sh.id !== id) }));
        get().logAction('التصحيح الإلكتروني', 'حذف ورقة تصحيح', `${get().studentName(sheet.studentId)} - ${get().userName(sheet.correctorId)}`);
        syncToServer(get, () => correctionSheetApi.remove(id));
        return true;
      },

      addUser: (userData) => {
        const user: User = { ...userData, id: uid('u'), password: userData.password || '123456' };
        set((s) => ({ users: [...s.users, user] }));
        get().logAction('الحسابات', 'إضافة مستخدم', user.name);
        syncToServer(get, () => userApi.add({ ...user, permissions: user.permissions }));
      },
      updateUser: (id, updates) => {
        const existingUser = get().users.find((u) => u.id === id);
        const safeUpdates = existingUser && isPrimaryAdminUser(existingUser)
          ? { ...updates, active: true, roleId: ADMIN_ROLE_ID, role: ADMIN_ROLE_NAME, permissions: ADMIN_FULL_PERMISSIONS }
          : updates;
        set((s) => ({ users: s.users.map((u) => u.id === id ? normalizeAdminAccessUser({ ...u, ...safeUpdates }) : u) }));
        get().logAction('الحسابات', 'تعديل مستخدم', get().userName(id));
        syncToServer(get, () => userApi.update(id, safeUpdates as Record<string, unknown>));
      },
      toggleUser: (id) => {
        const user = get().users.find((u) => u.id === id);
        if (!user || isPrimaryAdminUser(user)) {
          get().logAction('الحسابات', 'منع تعطيل المدير', user?.name || id);
          return;
        }
        set((s) => ({ users: s.users.map((u) => u.id === id ? { ...u, active: !u.active } : u) }));
        get().logAction('الحسابات', user.active ? 'تعطيل مستخدم' : 'تفعيل مستخدم', user.name || id);
        syncToServer(get, () => userApi.update(id, { active: !user.active }));
      },
      updateUserPermissions: (id, permissions) => {
        const user = get().users.find((u) => u.id === id);
        const nextPermissions = user && hasFullAdminAccess(user) ? [...ADMIN_FULL_PERMISSIONS] : sanitizePermissionIds(permissions);
        set((s) => ({ users: s.users.map((u) => u.id === id ? normalizeAdminAccessUser({ ...u, permissions: nextPermissions }) : u) }));
        get().logAction('الحسابات', 'تحديث صلاحيات', get().userName(id));
        syncToServer(get, () => userApi.update(id, { permissions: nextPermissions }));
      },
      deleteUser: (id) => {
        const state = get();
        const user = state.users.find((u) => u.id === id);
        if (!user || user.roleId === 'role_admin' || state.currentUserId === id) return false;
        set((s) => ({ users: s.users.filter((u) => u.id !== id) }));
        get().logAction('الحسابات', 'حذف مستخدم', user.name);
        syncToServer(get, () => userApi.remove(id));
        return true;
      },

      addRole: (roleData) => {
        const role: Role = { ...roleData, id: uid('role') };
        set((s) => ({ roles: [...s.roles, role] }));
        get().logAction('الحسابات', 'إضافة دور', role.name);
        syncToServer(get, () => roleApi.add(role as unknown as Record<string, unknown>));
      },
      updateRole: (id, updates) => {
        const safeUpdates = id === ADMIN_ROLE_ID
          ? { ...updates, name: ADMIN_ROLE_NAME, isDefault: true, permissions: ADMIN_FULL_PERMISSIONS }
          : updates;
        set((s) => ({ roles: mergeDefaultRoles(s.roles.map((r) => r.id === id ? { ...r, ...safeUpdates } : r)) }));
        get().logAction('الحسابات', 'تعديل دور', id);
        syncToServer(get, () => roleApi.update(id, safeUpdates as Record<string, unknown>));
      },
      deleteRole: (id) => {
        const state = get();
        const role = state.roles.find((r) => r.id === id);
        if (!role || role.isDefault) return false;
        // Reassign users with this role to viewer
        const users = state.users.map((u) => u.roleId === id ? { ...u, roleId: 'role_viewer', role: 'مشاهدة فقط', permissions: [...ALL_VIEW_PERMISSION_IDS] } : u);
        set((s) => ({ roles: s.roles.filter((r) => r.id !== id), users }));
        get().logAction('الحسابات', 'حذف دور', role.name);
        // Sync updated users to DB
        users.filter(u => u.roleId === 'role_viewer' && state.users.find(su => su.id === u.id && su.roleId === id)).forEach(u => syncToServer(get, () => userApi.update(u.id, { roleId: 'role_viewer', permissions: u.permissions })));
        syncToServer(get, () => roleApi.remove(id));
        return true;
      },
      exportBackup: () => {
        const state = get();
        const backup = DATA_KEYS.reduce((acc, key) => ({ ...acc, [key]: state[key as keyof TeacherState] }), {} as Record<string, unknown>);
        return JSON.stringify({ version: 5, exportedAt: new Date().toISOString(), ...backup }, null, 2);
      },
      importBackup: (jsonText) => {
        try {
          const parsed = JSON.parse(jsonText) as BackupShape & { version?: number };
          if (!parsed || !Array.isArray(parsed.students) || !Array.isArray(parsed.courses)) {
            return { ok: false, message: 'ملف النسخة الاحتياطية غير صحيح أو ناقص' };
          }

          delete (parsed as Record<string, unknown>).groups;
          if (Array.isArray(parsed.students)) {
            parsed.students = parsed.students.map((student) => {
              const copy = { ...(student as unknown as Record<string, unknown>) };
              delete copy.groupId;
              copy.dismissalNotes = String(copy.dismissalNotes || '');
              return copy as unknown as Student;
            });
          }
          if (Array.isArray(parsed.exams)) {
            parsed.exams = parsed.exams.map((exam) => {
              const copy = { ...(exam as unknown as Record<string, unknown>) };
              delete copy.groupId;
              copy.noDiscount = Boolean(copy.noDiscount);
              return copy as unknown as Exam;
            });
          }

          // Migrate old users (without roleId)
          if (parsed.users) {
            const defaultRoles = DEFAULT_ROLES;
            parsed.users = parsed.users.map((u) => {
              const uObj = u as unknown as Record<string, unknown>;
              if (!uObj.roleId) {
                return migrateOldUser(uObj, defaultRoles) as unknown as User;
              }
              return u;
            }) as User[];
          }

          // Ensure roles exist, or use defaults
          if (!parsed.roles || !Array.isArray(parsed.roles) || parsed.roles.length === 0) {
            parsed.roles = DEFAULT_ROLES.map(r => ({ ...r, permissions: [...r.permissions] }));
          } else {
            parsed.roles = mergeDefaultRoles(parsed.roles);
          }

          const seedAdmin = seedData().users.find((u) => isPrimaryAdminUser(u))!;
          if (!parsed.users || !Array.isArray(parsed.users) || parsed.users.length === 0) {
            parsed.users = [{ ...seedAdmin }];
          } else if (!parsed.users.some((u) => isPrimaryAdminUser(u))) {
            parsed.users = [...parsed.users, { ...seedAdmin }];
          }
          parsed.users = parsed.users.map((u) => normalizeAdminAccessUser(u));

          const next: Partial<TeacherState> = {};
          DATA_KEYS.forEach((key) => {
            if (parsed[key] !== undefined) (next as Record<string, unknown>)[key] = parsed[key];
          });
          const adminUser = parsed.users?.find((u) => isPrimaryAdminUser(u) && u.active) || parsed.users?.find((u) => u.roleId === ADMIN_ROLE_ID && u.active);
          set({ ...next, currentUserId: adminUser?.id || 'u_admin', currentSection: 'dashboard' });
          get().logAction('النسخ الاحتياطي', 'استيراد نسخة احتياطية', `تم استيراد نسخة إصدار ${parsed.version || 1}`);
          return { ok: true, message: 'تم استيراد النسخة الاحتياطية بنجاح' };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : 'تعذر قراءة الملف' };
        }
      },
      exportMonthlyReport: (month = todayISO().slice(0, 7)) => {
        const state = get();
        const grades = state.grades.filter((g) => g.createdAt.startsWith(month) || g.updatedAt.startsWith(month));
        const newStudents = state.students.filter((s) => s.createdAt.startsWith(month));
        const oppLogs = state.opportunityLogs.filter((l) => l.date.startsWith(month));
        const dismissed = state.students.filter((s) => s.status === 'مفصول');
        const rows = [
          `تقرير TeacherPro الشهري - ${month}`,
          `تاريخ التصدير: ${nowText()}`,
          '',
          `عدد الطلاب الكلي: ${state.students.length}`,
          `طلاب جدد هذا الشهر: ${newStudents.length}`,
          `طلاب مفصولون حالياً: ${dismissed.length}`,
          `عدد الامتحانات: ${state.exams.length}`,
          `درجات مدخلة/معدلة هذا الشهر: ${grades.length}`,
          `حركات الفرص هذا الشهر: ${oppLogs.length}`,
          '',
          'تفصيل الطلاب الجدد:',
          ...newStudents.map((s) => `- ${s.code} | ${s.name} | ${get().courseName(s.courseId)} | ${formatAppDate(s.createdAt, s.createdAt)}`),
          '',
          'تفصيل حركات الفرص:',
          ...oppLogs.map((l) => `- ${formatAppDate(l.date, l.date)} | ${get().studentName(l.studentId)} | ${l.action} ${l.amount} | ${l.reason}`),
        ];
        return rows.join('\n');
      },

    }),
    {
      name: 'teacher-pro-store-v4',
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
          nextState.courses = DEFAULT_COURSES.map(c => ({ ...c }));
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
            nextState.students = nextState.students.map((student) => stripKeys(student, ["receiptNo", "codeSequence", "totalAmount", "paidAmount", "installments", "accountingStart"]));
          }
          if (Array.isArray(nextState.exams)) {
            nextState.exams = nextState.exams.map((exam) => stripKeys(exam, ["attendance", "attendanceClosed"]));
          }
          if (Array.isArray(nextState.grades)) {
            nextState.grades = nextState.grades.map((grade) => stripKeys(grade, ["accountingChecked"]));
          }
        }

        // Migration v7 → v8: remove obsolete electronic groups and their links from local snapshots.
        if (version < 8) {
          delete nextState.groups;
          if (Array.isArray(nextState.students)) {
            nextState.students = nextState.students.map((student) => stripKeys(student, ["groupId"]));
          }
          if (Array.isArray(nextState.exams)) {
            nextState.exams = nextState.exams.map((exam) => stripKeys(exam, ["groupId"]));
          }
          if (Array.isArray(nextState.users)) {
            nextState.users = nextState.users.map((user) => ({
              ...(user as Record<string, unknown>),
              permissions: sanitizePermissionIds(parseArrayField<string>((user as Record<string, unknown>).permissions)),
            }));
          }
          if (Array.isArray(nextState.roles)) {
            nextState.roles = nextState.roles.map((role) => ({
              ...(role as Record<string, unknown>),
              permissions: sanitizePermissionIds(parseArrayField<string>((role as Record<string, unknown>).permissions)),
            }));
          }
        }

        // Migration v8 → v9: preserve student grace days as an academic-protection field.
        if (version < 9 && Array.isArray(nextState.students)) {
          nextState.students = nextState.students.map((student) => ({
            ...(student as Record<string, unknown>),
            accountingGraceDays: normalizeGraceDaysValue((student as Record<string, unknown>).accountingGraceDays),
          }));
        }

        // Migration v9 → v10: add per-student dismissal notes.
        if (version < 10 && Array.isArray(nextState.students)) {
          nextState.students = nextState.students.map((student) => ({
            ...(student as Record<string, unknown>),
            dismissalNotes: String((student as Record<string, unknown>).dismissalNotes || ''),
          }));
        }

        // Migration v10 → v11: remove the old leave/excused grade status from local snapshots.
        if (version < 11 && Array.isArray(nextState.grades)) {
          nextState.grades = nextState.grades.map((grade) => ({
            ...(grade as Record<string, unknown>),
            status: sanitizeGradeStatus((grade as Record<string, unknown>).status),
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
              permissions: sanitizePermissionIds(parseArrayField<string>((user as Record<string, unknown>).permissions)),
            }));
          }
          if (Array.isArray(nextState.roles)) {
            nextState.roles = nextState.roles.map((role) => ({
              ...(role as Record<string, unknown>),
              permissions: sanitizePermissionIds(parseArrayField<string>((role as Record<string, unknown>).permissions)),
            }));
          }
        }

        // Migration v12 → v13: add leave scope fields for exam/period leave records.
        if (version < 13 && Array.isArray(nextState.studentLeaves)) {
          nextState.studentLeaves = nextState.studentLeaves.map((leave) => normalizeStudentLeave(leave as Record<string, unknown>));
        }

        return nextState;
      },
      partialize: (state) => toPersistedUiSnapshot(state),
    }
  )
);
