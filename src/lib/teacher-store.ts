'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  courseApi, chapterApi, courseChapterApi,
  studentApi, examApi, gradeApi, opportunityLogApi, studentLeaveApi, studentCallApi, studentNoteApi, correctionSheetApi,
  userApi, roleApi, logApi, authApi,
  loadAllFromServer, type AuthApiUser, type ServerData,
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
import { isExamOnOrAfterStudentRegistration, isGradeEntered } from './exam-utils';
import { toBaghdadDateTimeLocal } from './baghdad-time';

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
  locationScope: 'بغداد' | 'محافظات' | '';
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

export interface StudentLeave {
  id: string;
  studentId: string;
  examId: string;
  reason: string;
  studyType: string;
  date: string;
  notes: string;
}

export interface StudentCall {
  id: string;
  studentId: string;
  examId: string;
  category: string;
  target: string;
  phone: string;
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


export interface LeaderboardSettings {
  correctionErrorPenalty: number;
  sumErrorPenalty: number;
  excludedExamIds: string[];
}

export type SectionId =
  | 'dashboard'
  | 'courses'
  | 'chapters'
  | 'student-register'
  | 'student-registry'
  | 'dismissed-students'
  | 'exam-new'
  | 'grade-entry'
  | 'exam-records'
  | 'grade-records'
  | 'opportunities'
  | 'follow-up'
  | 'e-correction'
  | 'accounts'
  | 'logs';

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
  'courses': 'courses.add',
  'chapters': 'chapters.view',
  'student-register': 'students.add',
  'student-registry': 'students.view',
  'dismissed-students': 'students.view',
  'exam-new': 'exams.add',
  'grade-entry': 'grades.add',
  'exam-records': 'exams.view',
  'grade-records': 'grades.view',
  'opportunities': 'opportunities.view',
  'follow-up': 'follow-up.view',
  'e-correction': 'correction.view',
  'accounts': 'accounts.view',
  'logs': 'logs.view',
};

// ─── Default Roles ──────────────────────────────────────────────────────────

const ALL_PERMISSION_IDS = Array.from(new Set(PERMISSION_CATALOG.map(p => p.id)));
const ALL_VIEW_PERMISSION_IDS = PERMISSION_CATALOG.filter(p => p.level === 'read').map(p => p.id);

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '1993';
const ADMIN_ROLE_ID = 'role_admin';
const ADMIN_ROLE_NAME = 'مدير عام';
const ADMIN_FULL_PERMISSIONS = [...ALL_PERMISSION_IDS];
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
  updateGrade: (id: string, updates: Partial<Grade>) => void;
  deleteGrade: (id: string) => boolean;
  recalculateAcademicEffects: (studentIds?: string | string[]) => void;

  adjustOpportunities: (studentId: string, amount: number, reason: string) => void;
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
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

function automaticOpportunityLogId(studentId: string, examId: string, action: string, reason: string): string {
  const slug = `${action}-${reason}`
    .replace(/[^A-Za-z0-9\u0600-\u06FF]+/g, '-')
    .slice(0, 32);
  return `auto_${studentId}_${examId}_${slug}`;
}

function isReactivationOpportunityLog(log: OpportunityLog): boolean {
  return log.action === 'إعادة تفعيل' || String(log.reason || '').includes('تثبيت إعادة التفعيل');
}

function isStudentExcusedForExam(state: Pick<TeacherState, 'studentLeaves'>, studentId: string, examId: string): boolean {
  return state.studentLeaves.some((leave) => leave.studentId === studentId && leave.examId === examId);
}

function recalculateStudentsFromAcademicRules(
  state: Pick<TeacherState, 'students' | 'grades' | 'exams' | 'courseChapters' | 'chapters' | 'opportunityLogs' | 'studentLeaves'>,
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
  const leaveKeys = new Set((state.studentLeaves || []).map((leave) => `${leave.studentId}:${leave.examId}`));

  const students = state.students.map((student) => {
    const isTargetStudent = !hasScopedRecalculation || targetStudentIds?.has(student.id);
    if (!isTargetStudent) return student;

    const manualDismissal = student.status === 'مفصول' && !isRuleManagedDismissal(student);
    if (manualDismissal) return student;

    // إذا تمت إعادة تفعيل الطالب يدوياً، لا نعيد فصله بسبب درجات/غيابات قديمة
    // عند تحميل البيانات أو عند إعادة احتساب جماعي. أما تعديل درجة الطالب نفسه
    // فيُعاد احتسابه بصورة مستهدفة حتى يتأثر هو فقط بالتغيير الجديد.
    const hasManualReactivation = student.status === 'نشط' && manualLogs.some((log) => log.studentId === student.id && isReactivationOpportunityLog(log));
    if (!hasScopedRecalculation && hasManualReactivation) return student;

    const activeCourseChapter = activeCourseChapterByCourse.get(student.courseId);
    const activeChapter = activeCourseChapter ? state.chapters.find((chapter) => chapter.id === activeCourseChapter.chapterId) : null;
    let opportunities = Number(student.baseOpportunities || activeChapter?.opportunities || 0);
    let dismissalType = '';
    let dismissalReason = '';
    let dismissalPriority = -1;
    let cheatCount = 0;

    const studentManualLogs = manualLogs
      .filter((log) => log.studentId === student.id)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const hasFinalChancePledge = studentManualLogs.some((log) => log.action === 'فرصة أخيرة بعد تعهد');
    studentManualLogs.forEach((log) => {
      const amount = Math.abs(Number(log.amount || 0));
      if (!amount) return;
      if (log.action === 'إضافة' || log.action === 'فرصة أخيرة بعد تعهد') opportunities += amount;
      if (log.action === 'خصم') opportunities -= amount;
      if (log.action === 'إعادة تعيين') opportunities = Number(student.baseOpportunities || activeChapter?.opportunities || 0);
    });

    const studentGrades = state.grades
      .filter((grade) => grade.studentId === student.id)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    const addAutomaticLog = (exam: Exam, action: string, amount: number, reason: string) => {
      if (amount <= 0 && action === 'خصم تلقائي') return;
      automaticLogs.push({
        id: automaticOpportunityLogId(student.id, exam.id, action, reason),
        studentId: student.id,
        examId: exam.id,
        action,
        amount: Math.max(0, Math.trunc(amount)),
        reason: `تلقائي: ${reason}`,
        date: exam.date || todayISO(),
        chapterId: activeChapter?.id || activeCourseChapter?.chapterId || '',
      });
    };

    const consumeAllRemainingOpportunities = (exam: Exam, reason: string) => {
      const deducted = Math.max(0, Math.trunc(opportunities));
      if (deducted > 0) {
        addAutomaticLog(exam, 'خصم تلقائي', deducted, `${reason} - خصم جميع الفرص بسبب الفصل`);
      }
      opportunities = 0;
    };

    const setDismissal = (type: string, reason: string, priority: number, exam?: Exam) => {
      if (priority >= dismissalPriority) {
        dismissalType = type;
        dismissalReason = reason;
        dismissalPriority = priority;
      }
      if (exam) {
        consumeAllRemainingOpportunities(exam, reason);
        addAutomaticLog(exam, 'فصل تلقائي', 0, reason);
      }
    };

    for (const grade of studentGrades) {
      const exam = examsById.get(grade.examId);
      if (!exam) continue;
      if (!isGradeEntered(grade, exam)) continue;
      if (!isExamOnOrAfterStudentRegistration(student, exam)) continue;
      if (leaveKeys.has(`${student.id}:${exam.id}`)) continue;
      if (isExamWithinStudentGracePeriod(student, exam)) continue;

      if (grade.status === 'غش') {
        cheatCount += 1;
        if (cheatCount === 1) {
          const deducted = Math.max(0, opportunities);
          if (deducted > 0) addAutomaticLog(exam, 'خصم تلقائي', deducted, `غش أول في امتحان: ${exam.name} - خصم جميع الفرص`);
          opportunities = 0;
          setDismissal('فصل مؤقت', `أول حالة غش في امتحان: ${exam.name}`, 80, exam);
        } else {
          setDismissal('فصل نهائي', `غش متكرر في امتحان: ${exam.name}`, 100, exam);
        }
        continue;
      }

      if (grade.status === 'غائب') {
        if (exam.type === 'تراكمي' || exam.type === 'فاينل') {
          setDismissal('فصل مؤقت', `غياب ضمن درجة الفصل في امتحان ${exam.type}: ${exam.name}`, 75, exam);
        } else {
          const penalty = examPenaltyValue(exam);
          opportunities -= penalty;
          addAutomaticLog(exam, 'خصم تلقائي', penalty, `غياب في امتحان يومي: ${exam.name}`);
        }
        continue;
      }

      if (grade.status === 'درجة' && grade.score !== null) {
        const score = Number(grade.score);
        if (exam.type === 'تراكمي' || exam.type === 'فاينل') {
          if (score === 0) {
            setDismissal('فصل مؤقت', `درجة صفر في امتحان ${exam.type}: ${exam.name}`, 76, exam);
          } else if (exam.dismissalGrade !== null && score <= exam.dismissalGrade) {
            setDismissal('فصل مؤقت', `درجة فصل (${score}): ${exam.name}`, 75, exam);
          }
          continue;
        }
        if (score <= exam.discountMark) {
          const penalty = examPenaltyValue(exam);
          opportunities -= penalty;
          addAutomaticLog(exam, 'خصم تلقائي', penalty, `درجة ${score} ضمن الخصم في امتحان: ${exam.name}`);
        }
      }
    }

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

  const keptAutomaticLogs = hasScopedRecalculation
    ? previousAutomaticLogs.filter((log) => !targetStudentIds?.has(log.studentId))
    : [];

  return { students, opportunityLogs: [...automaticLogs, ...keptAutomaticLogs, ...manualLogs] };
}

function getSyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'تعذر حفظ التغيير في الخادم. تم التراجع عن التغيير المحلي.';
}

function notifySyncFailure(_getState: () => TeacherState, description: string, error: unknown): void {
  const message = getSyncErrorMessage(error);
  console.warn('[Store] Server sync failed:', description, error);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('teacherpro:server-sync-error', {
      detail: { message: description ? `${description}: ${message}` : message },
    }));
  }
}

function isFailedApiResult(result: unknown): result is { ok: false; error?: string } {
  return Boolean(result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false);
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
        throw new Error(result.error || 'رفض الخادم حفظ التغيير');
      }
    })
    .catch((error) => {
      options.rollback?.();
      notifySyncFailure(getState, options.description || '', error);
    });
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
            active: Boolean(ex.active),
            scheduledActivateAt: normalizeDateTimeValue(ex.scheduledActivateAt),
            scheduledDeactivateAt: normalizeDateTimeValue(ex.scheduledDeactivateAt),
            date: ex.date ? String(ex.date).slice(0, 10) : todayISO(),
          };
          }) as Exam[];

          const grades = (serverData.grades || []).map((g: Record<string, unknown>) => ({
            ...g,
            status: sanitizeGradeStatus(g.status),
            score: g.score === null || g.score === undefined ? null : Number(g.score),
            academicAccountingChecked: Boolean(g.academicAccountingChecked),
            createdAt: g.createdAt ? String(g.createdAt).slice(0, 10) : todayISO(),
            updatedAt: g.updatedAt ? String(g.updatedAt).slice(0, 10) : todayISO(),
          })) as Grade[];

          const opportunityLogs = (serverData.opportunityLogs || []).map((ol: Record<string, unknown>) => ({
            ...ol,
            amount: Number(ol.amount || 0),
            date: ol.date ? String(ol.date).slice(0, 10) : todayISO(),
          })) as OpportunityLog[];

          const studentLeaves = (serverData.studentLeaves || []).map((leave: Record<string, unknown>) => ({
            ...leave,
            date: leave.date ? String(leave.date).slice(0, 10) : todayISO(),
            notes: String(leave.notes || ''),
            studyType: String(leave.studyType || ''),
          })) as StudentLeave[];

          const studentCalls = (serverData.studentCalls || []).map((call: Record<string, unknown>) => ({
            ...call,
            completed: Boolean(call.completed),
            completedAt: call.completedAt ? String(call.completedAt) : '',
            createdAt: call.createdAt ? String(call.createdAt).slice(0, 10) : todayISO(),
            notes: String(call.notes || ''),
          })) as StudentCall[];

          const studentNotes = (serverData.studentNotes || []).map((note: Record<string, unknown>) => ({
            ...note,
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

          // لا نعيد احتساب الفصل والفرص عند فتح النظام فقط.
          // إعادة الاحتساب تبقى مرتبطة بأحداث صريحة مثل إدخال/تعديل درجة أو تعديل امتحان.

          const adminAfterLoad = users.find((u) => isPrimaryAdminUser(u));
          if (adminAfterLoad) {
            syncToServer(get, () => userApi.update(adminAfterLoad.id, {
              active: true,
              roleId: ADMIN_ROLE_ID,
              role: ADMIN_ROLE_NAME,
              permissions: ADMIN_FULL_PERMISSIONS,
            }));
          }
          const adminRoleAfterLoad = roles.find((role) => role.id === ADMIN_ROLE_ID);
          if (adminRoleAfterLoad) {
            syncToServer(get, async () => {
              const result = await roleApi.update(ADMIN_ROLE_ID, {
                name: ADMIN_ROLE_NAME,
                isDefault: true,
                permissions: ADMIN_FULL_PERMISSIONS,
              });
              if (!result.ok) {
                await roleApi.add({ id: ADMIN_ROLE_ID, name: ADMIN_ROLE_NAME, isDefault: true, permissions: ADMIN_FULL_PERMISSIONS });
              }
            });
          }
          return true;
        } catch (e) {
          console.warn('[Store] Failed to load from server:', e);
          set({ dbLoading: false, dbConnected: false });
          return false;
        }
      },

      setSection: (section) => {
        if (!get().canAccess(section)) {
          get().logAction('الصلاحيات', 'محاولة دخول مرفوضة', section);
          return;
        }
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

        await get().loadFromServer();
        get().logAction('تسجيل الدخول', 'دخول للنظام', sessionUser.name);
        return { ok: true, message: 'تم تسجيل الدخول بنجاح' };
      },
      canAccess: (section) => {
        if (!get().isAuthenticated) return false;
        const user = get().currentUser();
        if (!user) return false;
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
        if (!grade || !isGradeEntered(grade, exam)) return { text: 'غير مسجل', type: 'neutral', kind: 'missing' };
        if (student && !isExamOnOrAfterStudentRegistration(student, exam)) return { text: 'قبل التسجيل', type: 'neutral', kind: 'before-registration' };
        if (student && isExamWithinStudentGracePeriod(student, exam)) return { text: 'ضمن السماح', type: 'info', kind: 'grace' };
        if (grade.status === 'غش') return { text: 'غش', type: 'danger', kind: 'cheat' };
        if (grade.status === 'غائب') {
          if (exam.type === 'تراكمي' || exam.type === 'فاينل') return { text: 'فصل', type: 'danger', kind: 'dismissal' };
          return { text: 'مخصوم', type: 'danger', kind: 'deducted' };
        }
        const score = Number(grade.score) || 0;
        if (exam.type === 'تراكمي' || exam.type === 'فاينل') {
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
        syncToServer(get, () => logApi.add({ ...log, userName: user, userId: currentUser?.id }));
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
            if (student.courseProgram && !nextPrograms.includes(student.courseProgram as any)) {
              return { ok: false, message: `لا يمكن إزالة "${student.courseProgram}" لأنه مستخدم من طلاب مسجلين` };
            }
            if (student.courseProgram && student.studyType) {
              const nextStudyTypes = getAvailableStudyTypesForProgram(draftCourse, student.courseProgram);
              if (!nextStudyTypes.includes(student.studyType as any)) {
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
        if (updatedCc) syncToServer(get, () => courseChapterApi.update(courseChapterId, { active: updatedCc.active, archived: updatedCc.archived, archive: JSON.stringify(updatedCc.archive) }), {
          description: 'تفعيل/تعطيل فصل',
          rollback: () => set({ courseChapters: previousCourseChapters, students: previousStudents }),
        });
        // Sync updated students to DB
        get().students.filter(st => st.courseId === cc.courseId).forEach(st => syncToServer(get, () => studentApi.update(st.id, { opportunities: st.opportunities, baseOpportunities: st.baseOpportunities }), {
          description: 'تحديث فرص الطلاب بعد تفعيل الفصل',
          rollback: () => set({ courseChapters: previousCourseChapters, students: previousStudents }),
        }));
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
        const { id: _id, code: _code, ...apiUpdates } = merged;
        void _id; void _code;
        syncToServer(get, () => studentApi.update(id, apiUpdates as Record<string, unknown>), {
          description: 'تعديل بيانات طالب',
          rollback: () => set({ students: previousStudents }),
        });
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
        const deductionLog: OpportunityLog | null = deductedOpportunities > 0
          ? {
              id: uid('ol'),
              studentId,
              examId: '',
              action: 'خصم',
              amount: deductedOpportunities,
              reason: `فصل الطالب: ${reason}`,
              date: todayISO(),
              chapterId: stateBefore.activeChapterForCourse(studentBefore?.courseId || '')?.id || '',
            }
          : null;

        set((s) => ({
          students: s.students.map((st) => st.id === studentId
            ? { ...st, status: 'مفصول' as const, dismissalType: type, dismissalReason: reason, dismissalNotes: notes, opportunities: 0 }
            : st),
          opportunityLogs: deductionLog ? [deductionLog, ...s.opportunityLogs] : s.opportunityLogs,
        }));
        get().logAction('الطلاب', `فصل الطالب (${type})`, `${get().studentName(studentId)} - ${reason}`);
        syncToServer(get, () => studentApi.update(studentId, { status: 'مفصول', dismissalType: type, dismissalReason: reason, dismissalNotes: notes, opportunities: 0 }));
        if (deductionLog) syncToServer(get, () => opportunityLogApi.add(deductionLog as unknown as Record<string, unknown>));
      },
      reactivateStudent: (studentId) => {
        const stateBefore = get();
        const studentBefore = stateBefore.students.find((st) => st.id === studentId);
        const shouldGrantFinalChance = Boolean(
          studentBefore?.dismissalType === 'فصل مؤقت' &&
          String(studentBefore.dismissalReason || '').includes('انتهاء الفرص'),
        );
        const reactivationLog: OpportunityLog | null = studentBefore
          ? {
              id: uid('ol'),
              studentId,
              examId: '',
              action: 'إعادة تفعيل',
              amount: 0,
              reason: 'تثبيت إعادة التفعيل: لا يعاد فصل الطالب بسبب سجلات قديمة إلا عند تعديل درجته هو',
              date: todayISO(),
              chapterId: stateBefore.activeChapterForCourse(studentBefore.courseId)?.id || '',
            }
          : null;
        const finalChanceLog: OpportunityLog | null = shouldGrantFinalChance && studentBefore
          ? {
              id: uid('ol'),
              studentId,
              examId: '',
              action: 'فرصة أخيرة بعد تعهد',
              amount: 1,
              reason: 'إرجاع الطالب بعد التعهد بفرصة أخيرة',
              date: todayISO(),
              chapterId: stateBefore.activeChapterForCourse(studentBefore.courseId)?.id || '',
            }
          : null;
        set((s) => ({
          students: s.students.map((st) => st.id === studentId
            ? { ...st, status: 'نشط' as const, dismissalType: '', dismissalReason: '', dismissalNotes: '', opportunities: shouldGrantFinalChance ? 1 : st.opportunities }
            : st),
          opportunityLogs: ([reactivationLog, finalChanceLog].filter(Boolean) as OpportunityLog[]).concat(s.opportunityLogs),
        }));
        get().logAction('الطلاب', shouldGrantFinalChance ? 'إعادة تفعيل بتعهد وفرصة أخيرة' : 'إعادة تفعيل طالب', get().studentName(studentId));
        syncToServer(get, () => studentApi.update(studentId, { status: 'نشط', dismissalType: '', dismissalReason: '', dismissalNotes: '', ...(shouldGrantFinalChance ? { opportunities: 1 } : {}) }));
        if (reactivationLog) syncToServer(get, () => opportunityLogApi.add(reactivationLog as unknown as Record<string, unknown>));
        if (finalChanceLog) syncToServer(get, () => opportunityLogApi.add(finalChanceLog as unknown as Record<string, unknown>));
      },

      addExam: (examData) => {
        const exam: Exam = { ...examData, id: uid('ex') };
        set((s) => ({ exams: [...s.exams, exam] }));
        get().logAction('الامتحانات', 'إضافة امتحان', exam.name);
        syncToServer(get, () => examApi.add({ ...exam, courseIds: exam.courseIds, opportunitiesPenalty: String(exam.opportunitiesPenalty) }));
      },
      updateExam: (id, updates) => {
        set((s) => ({ exams: s.exams.map((e) => e.id === id ? { ...e, ...updates } : e) }));
        get().logAction('الامتحانات', 'تعديل امتحان', get().exams.find((e) => e.id === id)?.name || id);
        syncToServer(get, () => examApi.update(id, updates as Record<string, unknown>));
        get().recalculateAcademicEffects();
      },
      toggleExam: (id) => {
        const exam = get().exams.find((e) => e.id === id);
        set((s) => ({ exams: s.exams.map((e) => e.id === id ? { ...e, active: !e.active } : e) }));
        get().logAction('الامتحانات', exam?.active ? 'تعطيل امتحان' : 'تفعيل امتحان', exam?.name || id);
        syncToServer(get, () => examApi.update(id, { active: !exam?.active }));
      },
      deleteExam: (id) => {
        const state = get();
        const exam = state.exams.find((e) => e.id === id);
        if (!exam) return false;

        const relatedGrades = state.grades.filter((grade) => grade.examId === id);
        const relatedOpportunityLogs = state.opportunityLogs.filter((log) => log.examId === id);
        const relatedCorrectionSheets = state.correctionSheets.filter((sheet) => sheet.examId === id);
        const relatedLeaves = state.studentLeaves.filter((leave) => leave.examId === id);
        const relatedCalls = state.studentCalls.filter((call) => call.examId === id);

        relatedGrades.forEach((grade) => syncToServer(get, () => gradeApi.remove(grade.id)));
        relatedOpportunityLogs.forEach((log) => syncToServer(get, () => opportunityLogApi.remove(log.id)));
        relatedCorrectionSheets.forEach((sheet) => syncToServer(get, () => correctionSheetApi.remove(sheet.id)));
        relatedLeaves.forEach((leave) => syncToServer(get, () => studentLeaveApi.remove(leave.id)));
        relatedCalls.forEach((call) => syncToServer(get, () => studentCallApi.remove(call.id)));

        set((s) => ({
          exams: s.exams.filter((e) => e.id !== id),
          grades: s.grades.filter((g) => g.examId !== id),
          correctionSheets: s.correctionSheets.filter((sh) => sh.examId !== id),
          opportunityLogs: s.opportunityLogs.filter((log) => log.examId !== id),
          studentLeaves: s.studentLeaves.filter((leave) => leave.examId !== id),
          studentCalls: s.studentCalls.filter((call) => call.examId !== id),
        }));

        get().recalculateAcademicEffects();
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

        const previousState = { students: stateBefore.students, grades: stateBefore.grades, opportunityLogs: stateBefore.opportunityLogs };
        set((s) => ({ grades: existing ? s.grades.map((g) => g.id === existing.id ? grade : g) : [...s.grades, grade] }));
        get().logAction('الدرجات', existing ? 'تعديل درجة' : 'إدخال درجة', `${get().studentName(grade.studentId)} - ${stateBefore.exams.find((e) => e.id === grade.examId)?.name || ''}`);
        syncToServer(get, () => gradeApi.add(grade as unknown as Record<string, unknown>), {
          description: existing ? 'تعديل درجة' : 'إدخال درجة',
          rollback: () => set(previousState),
        });
        get().recalculateAcademicEffects(grade.studentId);
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
        syncToServer(get, () => gradeApi.update(id, updates as Record<string, unknown>), {
          description: 'تعديل درجة',
          rollback: () => set(previousState),
        });
        if (affectedStudentIds.length > 0) get().recalculateAcademicEffects(affectedStudentIds);
      },
      deleteGrade: (id) => {
        const stateBefore = get();
        const grade = stateBefore.grades.find((g) => g.id === id);
        if (!grade) return false;
        const previousState = { students: stateBefore.students, grades: stateBefore.grades, opportunityLogs: stateBefore.opportunityLogs };
        set((s) => ({ grades: s.grades.filter((g) => g.id !== id) }));
        get().logAction('الدرجات', 'حذف درجة', `${get().studentName(grade.studentId)} - ${get().exams.find((e) => e.id === grade.examId)?.name || ''}`);
        syncToServer(get, () => gradeApi.remove(id), {
          description: 'حذف درجة',
          rollback: () => set(previousState),
        });
        get().recalculateAcademicEffects(grade.studentId);
        return true;
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
        set({ students: recalculated.students, opportunityLogs: recalculated.opportunityLogs });
        recalculated.students.forEach((student) => {
          const oldStudent = before.students.find((item) => item.id === student.id);
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
        oldAutomaticLogs
          .filter((oldLog) => !nextAutomaticLogs.some((nextLog) => nextLog.id === oldLog.id))
          .forEach((oldLog) => syncToServer(get, () => opportunityLogApi.remove(oldLog.id)));
        nextAutomaticLogs.forEach((log) => syncToServer(get, () => opportunityLogApi.add(log as unknown as Record<string, unknown>)));
      },
      adjustOpportunities: (studentId, amount, reason) => {
        const stateBefore = get();
        const studentBefore = stateBefore.students.find((st) => st.id === studentId);
        if (!studentBefore || !stateBefore.activeChapterForCourse(studentBefore.courseId)) {
          get().logAction('إدارة الفرص', 'رفض حركة فرص بدون فصل نشط', `${studentBefore?.name || studentId} - ${reason}`);
          return;
        }
        const action = amount > 0 ? 'إضافة' : 'خصم';
        const log: OpportunityLog = { id: uid('ol'), studentId, examId: '', action, amount: Math.abs(amount), reason, date: todayISO(), chapterId: stateBefore.activeChapterForCourse(studentBefore?.courseId || '')?.id || '' };
        set((s) => {
          const students = s.students.map((st) => st.id === studentId ? { ...st, opportunities: Math.max(0, st.opportunities + amount) } : st);
          return { students, opportunityLogs: [log, ...s.opportunityLogs] };
        });
        get().logAction('إدارة الفرص', amount > 0 ? 'إضافة فرصة' : 'خصم فرصة', `${get().studentName(studentId)} - ${Math.abs(amount)} - ${reason}`);
        const student = get().students.find((s) => s.id === studentId);
        if (student) syncToServer(get, () => studentApi.update(studentId, { opportunities: student.opportunities }));
        syncToServer(get, () => opportunityLogApi.add(log as unknown as Record<string, unknown>));
        if (student && student.opportunities === 0 && student.status === 'نشط') {
          get().dismissStudent(studentId, 'فصل مؤقت', 'انتهاء الفرص');
        }
      },
      addStudentLeave: (leaveData) => {
        const stateBefore = get();
        const leave: StudentLeave = { ...leaveData, id: uid('lv') };
        const existingGrade = stateBefore.grades.find((grade) => grade.studentId === leave.studentId && grade.examId === leave.examId);
        const previousState = {
          students: stateBefore.students,
          grades: stateBefore.grades,
          opportunityLogs: stateBefore.opportunityLogs,
          studentLeaves: stateBefore.studentLeaves,
        };
        set((s) => ({
          studentLeaves: [leave, ...s.studentLeaves.filter((item) => !(item.studentId === leave.studentId && item.examId === leave.examId))],
          grades: s.grades.filter((grade) => !(grade.studentId === leave.studentId && grade.examId === leave.examId)),
        }));
        get().logAction('المتابعة', 'إضافة إجازة', `${get().studentName(leave.studentId)} - ${leave.reason}`);
        if (existingGrade) {
          get().logAction('الدرجات', 'إزالة درجة بسبب الإجازة', `${get().studentName(leave.studentId)} - ${get().exams.find((exam) => exam.id === leave.examId)?.name || ''}`);
        }
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
        };
        set((s) => ({ studentLeaves: s.studentLeaves.filter((leave) => leave.id !== id) }));
        get().logAction('المتابعة', 'حذف إجازة', id);
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
          ...newStudents.map((s) => `- ${s.code} | ${s.name} | ${get().courseName(s.courseId)} | ${s.createdAt}`),
          '',
          'تفصيل حركات الفرص:',
          ...oppLogs.map((l) => `- ${l.date} | ${get().studentName(l.studentId)} | ${l.action} ${l.amount} | ${l.reason}`),
        ];
        return rows.join('\n');
      },

    }),
    {
      name: 'teacher-pro-store-v4',
      version: 12,
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Record<string, unknown>;
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

        return nextState;
      },
      partialize: (state) => ({
        courses: state.courses,
        chapters: state.chapters,
        courseChapters: state.courseChapters,
        students: state.students,
        exams: state.exams,
        grades: state.grades,
        opportunityLogs: state.opportunityLogs,
        studentLeaves: state.studentLeaves,
        studentCalls: state.studentCalls,
        studentNotes: state.studentNotes,
        correctionSheets: state.correctionSheets,
        users: state.users,
        roles: state.roles,
        logs: state.logs,
        leaderboardSettings: state.leaderboardSettings,
        theme: state.theme,
        studentPageSize: state.studentPageSize,
        gradePageSize: state.gradePageSize,
        currentUserId: state.currentUserId,
      }),
    }
  )
);
