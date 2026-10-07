/**
 * The permission catalog and the default roles, in one plain module that the
 * server routes and the browser both read (the store file is browser-only, so
 * a server route importing from it received an empty object).
 *
 * أي ميزة جديدة تنضاف لأي صفحة لازم تنضاف هنا داخل قائمة الصلاحيات بمعرّف
 * واضح واسم ووصف عربي؛ نافذة تعديل الدور تعرضها للمستخدم من هنا.
 */

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
    id: "students.registry.view",
    label: "عرض سجل الطلاب فقط",
    category: "الطلاب",
    level: "read",
    description: "فتح سجل الطلاب للقراءة فقط، بدون إدارة المفصولين أو إغلاق الكودات أو فترات السماح، وبدون أي تعديل أو أرشفة",
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
  // فترات السماح
  {
    id: "grace-periods.view",
    label: "عرض فترات السماح",
    category: "الطلاب / فترات السماح",
    level: "read",
    description: "فتح «إدارة فترة السماح» من لوحة النظام: البحث عن طالب وقراءة فترات السماح وقائمتها.",
  },
  {
    id: "grace-periods.manage",
    label: "إدارة فترات السماح",
    category: "الطلاب / فترات السماح",
    level: "manage",
    description: "إضافة فترة سماح وتعديلها وإلغاؤها، مع معاينة أثرها على الامتحانات والفرص قبل الحفظ.",
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
    category: "تصفير السجلات",
    level: "manage",
    description: "تصفير نطاقات محددة من السجلات بعد كلمة مرور الأدمن ونسخة استعادة.",
  },
  {
    id: "logs.restore",
    label: "استعادة آخر تصفير",
    category: "تصفير السجلات",
    level: "manage",
    description: "استعادة آخر نسخة احتياطية أنشئت قبل تصفير السجلات.",
  },
  // مشاكل البوت: a notebook in its own dashboard window. Only the admin has it
  // until it is given to a role or an account.
  {
    id: "bot-problems.manage",
    label: "مشاكل البوت",
    category: "مشاكل البوت",
    level: "manage",
    description: "فتح نافذة «مشاكل البوت» بلوحة النظام: إضافة مشكلة لطالب، وتعليمها محلولة أو إرجاعها.",
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

export const ALL_PERMISSION_IDS = Array.from(
  new Set(PERMISSION_CATALOG.map((p) => p.id)),
);
export const ALL_VIEW_PERMISSION_IDS = PERMISSION_CATALOG.filter(
  (p) => p.level === "read",
).map((p) => p.id);

/**
 * Who may open the calls work list: the calls page permission, or the older
 * whole-follow-up permission. A calls-only account needs nothing else.
 */
export const CALLS_VIEW_PERMISSIONS = ["follow-up.calls.view", "follow-up.view"];
/** Working on grades (entry, records, smart notes): any grade permission. */
export const GRADES_WORK_PERMISSIONS = ["grades.view", "grades.add", "grades.edit", "grades.delete"];
/** Reading «إدارة فترة السماح»: its own permission, or the full students view. */
export const GRACE_VIEW_PERMISSIONS = ["grace-periods.view", "students.view"];
/** Adding, editing and cancelling a grace period: its own permission, or editing students. */
export const GRACE_MANAGE_PERMISSIONS = ["grace-periods.manage", "students.edit"];
/** Reading «إدارة الإجازات» (the leaves list, the student search, a leave's exams). */
export const LEAVES_VIEW_PERMISSIONS = ["follow-up.leaves.view", "follow-up.view"];

export const ADMIN_ROLE_ID = "role_admin";
export const ADMIN_ROLE_NAME = "مدير عام";

export type DefaultRoleDefinition = {
  id: string;
  name: string;
  isDefault: boolean;
  permissions: string[];
};

export const DEFAULT_ROLE_DEFINITIONS: DefaultRoleDefinition[] = [
  {
    id: "role_admin",
    name: "مدير عام",
    isDefault: true,
    permissions: [...ALL_PERMISSION_IDS],
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
        p !== "system.settings" &&
        p !== "bot-problems.manage",
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
    // For staff who only make calls: the calls list, its actions and notes.
    // Inside the calls page they still see what a call needs (the student's
    // details, grades and opportunities in the card and «ملف الطالب»).
    id: "role_caller",
    name: "موظف مكالمات",
    isDefault: true,
    // The dashboard holds the «إدارة المكالمات» and «ملاحظات المكالمات» buttons.
    permissions: ["system.dashboard", "follow-up.calls.view", "follow-up.calls.manage", "students.registry.view"],
  },
  {
    // For staff who only handle leaves: «إدارة الإجازات» (search a student,
    // add, edit and delete a leave and see its effect on exams) from the
    // dashboard, and the dashboard's count of current leaves.
    id: "role_leaves",
    name: "موظف إجازات",
    isDefault: true,
    permissions: ["system.dashboard", "follow-up.leaves.view", "follow-up.leaves.manage"],
  },
  {
    // For staff who only handle grace periods: «إدارة فترة السماح» from the
    // dashboard (search a student, add, edit and cancel a period with its
    // effect on exams and opportunities) and nothing else.
    id: "role_grace",
    name: "موظف فترات السماح",
    isDefault: true,
    permissions: ["system.dashboard", "grace-periods.view", "grace-periods.manage"],
  },
  {
    id: "role_viewer",
    name: "مشاهدة فقط",
    isDefault: true,
    permissions: [...ALL_VIEW_PERMISSION_IDS],
  },
];
