#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

let failed = false;
function ok(message) { console.log(`✅ ${message}`); }
function bad(message) { failed = true; console.error(`❌ ${message}`); }
function must(condition, okMessage, badMessage = okMessage) {
  condition ? ok(okMessage) : bad(badMessage);
}

const store = read('src/lib/teacher-store.ts');
const serverAuth = read('src/lib/server-auth.ts');
const accounts = read('src/components/teacher-pro/accounts.tsx');
const logsView = read('src/components/teacher-pro/logs.tsx');
const adminReset = read('src/components/teacher-pro/admin-log-reset.tsx');
const logsRoute = read('src/app/api/logs/route.ts');
const permissionsRoute = read('src/app/api/permissions/route.ts');
const usersRoute = read('src/app/api/users/route.ts');
const rolesRoute = read('src/app/api/roles/route.ts');
const clearRoute = read('src/app/api/logs/clear/route.ts');
const api = read('src/lib/api.ts');
const pkg = JSON.parse(read('package.json'));

const requiredPagePermissions = [
  'page.dashboard.view',
  'page.courses.view',
  'page.chapters.view',
  'page.student-register.view',
  'page.student-bulk-import.view',
  'page.student-registry.view',
  'page.dismissed-students.view',
  'page.exam-new.view',
  'page.grade-entry.view',
  'page.exam-records.view',
  'page.grade-records.view',
  'page.missing-students-notes.view',
  'page.opportunities.view',
  'page.follow-up-calls.view',
  'page.follow-up-leaves.view',
  'page.follow-up-pledges.view',
  'page.e-correction.view',
  'page.accounts.view',
  'page.logs.view',
  'page.admin-log-reset.manage',
];

for (const id of requiredPagePermissions) {
  must(store.includes(`id: "${id}"`), `الصلاحية ${id} موجودة في كتالوك الصلاحيات`, `الكتالوك ناقص صلاحية الصفحة ${id}.`);
  must(store.includes(`"${id}"`), `خريطة الصفحات تتعرف على ${id}`, `SECTION_PERMISSIONS أو الخريطة المرتبطة لا تحتوي ${id}.`);
}

const accountActionPermissions = [
  'accounts.users.view',
  'accounts.users.add',
  'accounts.users.edit',
  'accounts.users.delete',
  'accounts.roles.view',
  'accounts.roles.add',
  'accounts.roles.edit',
  'accounts.roles.delete',
  'accounts.permissions.manage',
  'accounts.security.view',
  'logs.view',
  'logs.export',
  'logs.delete',
  'logs.clear',
  'logs.restore',
];

for (const id of accountActionPermissions) {
  must(store.includes(`id: "${id}"`), `صلاحية الإجراء ${id} موجودة`, `كتالوك الصلاحيات ناقص ${id}.`);
}

must(
  store.includes('SECTION_PERMISSION_EQUIVALENTS') && store.includes('hasListedPermission') && store.includes('return hasListedPermission(user, requiredPermission)'),
  'الواجهة تدعم صلاحيات صفحة دقيقة مع توافق الصلاحيات القديمة',
  'canAccess يجب أن يستخدم صلاحيات صفحة دقيقة مع aliases للتوافق.',
);

must(
  serverAuth.includes('SERVER_PERMISSION_EQUIVALENTS') &&
    serverAuth.includes('"accounts.manage"') &&
    serverAuth.includes('"logs.view"') &&
    serverAuth.includes('principal.permissions.includes(alias)'),
  'الخادم يدعم صلاحيات دقيقة كبدائل للصلاحيات القديمة عند فحص API',
  'server-auth يجب أن يدعم aliases للصلاحيات الدقيقة.',
);

must(
  permissionsRoute.includes('SECTION_PERMISSIONS') && permissionsRoute.includes('sectionPermissions') && permissionsRoute.includes("source: 'database'"),
  'API الصلاحيات يرجع الكتالوك وخريطة الصفحات من مصدر واحد',
  'API /permissions يجب أن يرجع catalog + sectionPermissions.',
);

must(
  accounts.includes('PermissionGovernancePanel') &&
    accounts.includes('SECTION_PERMISSIONS') &&
    accounts.includes('هيكلة الصلاحيات الذكية'),
  'إدارة الحسابات تعرض لوحة تفصيل الصلاحيات حسب الصفحات والإجراءات',
  'صفحة الحسابات تحتاج لوحة واضحة لتغطية الصفحات والإجراءات.',
);

must(
  accounts.includes('userApi.add') &&
    accounts.includes('userApi.update') &&
    accounts.includes('userApi.remove') &&
    accounts.includes('roleApi.add') &&
    accounts.includes('roleApi.update') &&
    accounts.includes('roleApi.remove'),
  'إدارة المستخدمين والأدوار Server-first عبر API',
  'صفحة الحسابات يجب أن تستخدم userApi/roleApi بدلاً من Store optimistic.',
);

must(
  !accounts.includes('addUser(') &&
    !accounts.includes('updateUser(') &&
    !accounts.includes('toggleUser(') &&
    !accounts.includes('deleteUser(') &&
    !accounts.includes('addRole(') &&
    !accounts.includes('updateRole(') &&
    !accounts.includes('deleteRole('),
  'صفحة الحسابات لا تستخدم دوال Store المتفائلة للحسابات والأدوار',
  'يجب إزالة الاعتماد على addUser/updateUser/deleteUser/addRole/updateRole/deleteRole من واجهة الحسابات.',
);

must(
  logsView.includes('logApi.list') &&
    logsView.includes('AbortController') &&
    !logsView.includes('const { logs } = useTeacherStore()') &&
    logsView.includes('المصدر: قاعدة البيانات'),
  'صفحة السجلات Server-driven وتلغي الطلبات القديمة',
  'السجلات يجب أن تُقرأ من قاعدة البيانات لا من كاش Store.',
);

must(
  api.includes('list: (options: { queryString?: string; signal?: AbortSignal; quietAbort?: boolean } = {})') &&
    api.includes('listAll: () => apiGetAllPages'),
  'طبقة API تدعم قائمة سجلات خادمية بفلاتر مع إبقاء listAll للتوافق',
  'logApi يجب أن يدعم queryString/signal ويحتفظ listAll للتوافق.',
);

must(
  logsRoute.includes('buildLogSearchWhere') &&
    logsRoute.includes('distinct') &&
    logsRoute.includes('modules: moduleRows') &&
    logsRoute.includes('users: userRows') &&
    logsRoute.includes('source: "database"'),
  'API السجلات يدعم البحث والفلاتر والفهارس المساعدة من قاعدة البيانات',
  'GET /api/logs يجب أن يدعم q/module/user/page/limit ويرجع modules/users.',
);

must(
  adminReset.includes('audit-permissions') &&
    adminReset.includes('audit-log-reset') &&
    clearRoute.includes("'audit-permissions'") &&
    clearRoute.includes("'audit-log-reset'"),
  'تصفير الـ log صار يفصل الحسابات/الصلاحيات/عمليات التصفير بشكل أوضح',
  'تصفير الـ log يحتاج scopes مستقلة للصلاحيات ولعمليات التصفير.',
);

must(
  usersRoute.includes('accounts.permissions.manage') &&
    rolesRoute.includes('accounts.permissions.manage') &&
    usersRoute.includes('logs.clear') &&
    rolesRoute.includes('logs.clear'),
  'صلاحيات الحسابات الحساسة محمية في API المستخدمين والأدوار',
  'قائمة الصلاحيات الحساسة في users/roles APIs يجب أن تشمل الصلاحيات الدقيقة الجديدة.',
);

must(
  pkg.scripts && pkg.scripts['test:accounts-logs-integrity'] === 'node scripts/test-accounts-logs-integrity.mjs',
  'سكريبت test:accounts-logs-integrity موجود',
  'package.json يجب أن يحتوي test:accounts-logs-integrity.',
);

must(
  String(pkg.scripts['test:side-effects'] || '').includes('test:accounts-logs-integrity'),
  'الفحص الشامل يشمل إدارة الحسابات والسجلات وتصفير الـ log',
  'test:side-effects يجب أن يشمل test:accounts-logs-integrity.',
);

if (failed) {
  console.error('\nفشل اختبار إدارة الحسابات/السجلات. راجع النقاط أعلاه.');
  process.exit(1);
}
console.log('\nكل اختبارات إدارة الحسابات والصلاحيات والسجلات نجحت.');
