#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failed = false;
const pass = (message) => console.log(`✅ ${message}`);
const fail = (message) => { failed = true; console.error(`❌ ${message}`); };
const must = (condition, ok, bad = ok) => condition ? pass(ok) : fail(bad);

// The catalog and the default roles moved to a plain module the server can
// read; the store re-exports them.
const store = read("src/lib/teacher-store.ts") + "\n" + read("src/lib/permission-catalog.ts");
const accounts = read("src/components/teacher-pro/accounts.tsx");
const usersRoute = read("src/app/api/users/route.ts");
const rolesRoute = read("src/app/api/roles/route.ts");
const permissionsRoute = read("src/app/api/permissions/route.ts");
const securityRoute = read("src/app/api/accounts/security/route.ts");
const pkg = JSON.parse(read("package.json"));

const requiredPermissionIds = [
  "accounts.users.view",
  "accounts.users.add",
  "accounts.users.edit",
  "accounts.users.delete",
  "accounts.roles.view",
  "accounts.roles.add",
  "accounts.roles.edit",
  "accounts.roles.delete",
  "accounts.permissions.view",
  "accounts.permissions.assign",
  "accounts.security.view",
  "logs.delete",
  "logs.clear",
  "logs.restore",
  "follow-up.calls.view",
  "follow-up.calls.manage",
  "follow-up.leaves.view",
  "follow-up.leaves.manage",
];

for (const permission of requiredPermissionIds) {
  must(
    store.includes(`id: "${permission}"`),
    `الصلاحية ${permission} موجودة في PERMISSION_CATALOG`,
    `الصلاحية ${permission} غير موجودة في PERMISSION_CATALOG.`,
  );
}

must(
  store.includes('"follow-up-calls": "follow-up.calls.view"') &&
    store.includes('"follow-up-leaves": "follow-up.leaves.view"') &&
    store.includes('"admin-log-reset": "logs.clear"'),
  "ربط الصفحات الحساسة بصلاحياتها الدقيقة داخل SECTION_PERMISSIONS",
  "SECTION_PERMISSIONS يجب أن يربط المكالمات/الإجازات/تصفير اللوغ بصلاحيات دقيقة.",
);

must(
  !store.includes("follow-up.pledges") &&
    !store.includes('"follow-up-pledges":') &&
    !accounts.includes("المتابعة / التعهدات"),
  "صلاحيات وصفحة التعهدات القديمة محذوفة من إدارة الحسابات",
);

must(
  !accounts.includes("PermissionsArchitectureTab") &&
    !accounts.includes('value="architecture"') &&
    accounts.includes("{perm.label}") &&
    accounts.includes("{perm.description}") &&
    store.includes("أي ميزة جديدة تنضاف لأي صفحة لازم تنضاف هنا داخل قائمة الصلاحيات"),
  "الصلاحيات تُشرح بالعربي داخل نافذة الدور، وقاعدة إضافة أي ميزة جديدة تبقى عند قائمة الصلاحيات",
  "تبويب هيكلة الصلاحيات انشال؛ نافذة الدور لازم تعرض اسم كل صلاحية ووصفها، وقاعدة الميزة الجديدة لازم تبقى بقائمة الصلاحيات.",
);

must(
  usersRoute.includes("requirePermissionPrincipal(req, 'accounts.users.add')") &&
    usersRoute.includes("requirePermissionPrincipal(req, 'accounts.users.edit')") &&
    usersRoute.includes("requirePermissionPrincipal(req, 'accounts.users.delete')") &&
    usersRoute.includes("requireAnyPermission(req, ['accounts.view', 'accounts.users.view'])"),
  "API المستخدمين يستخدم صلاحيات دقيقة للعرض/الإضافة/التعديل/الحذف",
  "users API يجب أن لا يبقى معتمد فقط على accounts.manage لكل شيء.",
);

must(
  rolesRoute.includes("requirePermissionPrincipal(req, 'accounts.roles.add')") &&
    rolesRoute.includes("requirePermissionPrincipal(req, 'accounts.roles.edit')") &&
    rolesRoute.includes("requirePermissionPrincipal(req, 'accounts.roles.delete')") &&
    rolesRoute.includes("requireAnyPermission(req, ['accounts.view', 'accounts.roles.view'])"),
  "API الأدوار يستخدم صلاحيات دقيقة للعرض/الإضافة/التعديل/الحذف",
  "roles API يجب أن يستخدم صلاحيات الأدوار الدقيقة.",
);

must(
  permissionsRoute.includes("accounts.permissions.view") &&
    permissionsRoute.includes("requireAnyPermission"),
  "API كتالوج الصلاحيات محمي بصلاحية عرض الصلاحيات",
  "permissions API يجب أن يكون محمياً بصلاحية accounts.permissions.view أو accounts.view.",
);

must(
  securityRoute.includes("accounts.security.view") &&
    securityRoute.includes("logs.clear") &&
    securityRoute.includes("accounts.permissions.assign"),
  "لوحة أمان الحسابات تعرف الصلاحيات الحساسة الجديدة",
  "accounts/security يجب أن يشمل الصلاحيات الحساسة الجديدة في الفحص.",
);


must(
  // Accounts and permissions (every accounts.* id) never go to the supervisor.
  store.includes('permissions: ALL_PERMISSION_IDS.filter((p) => !p.startsWith("accounts.")),'),
  "دور المشرف الافتراضي ما ياخذ أي صلاحية من الحسابات والصلاحيات",
  "يجب منع صلاحيات الحسابات والصلاحيات من دور المشرف الافتراضي.",
);

must(
  pkg.scripts["test:accounts-permissions-integrity"] === "node scripts/test-accounts-permissions-integrity.mjs" &&
    String(pkg.scripts["test:side-effects"] || "").includes("test:accounts-permissions-integrity"),
  "اختبار إدارة الحسابات والصلاحيات مربوط داخل test:side-effects",
  "يجب ربط اختبار الحسابات والصلاحيات في package.json و test:side-effects.",
);

// «مشرف»: everything except the accounts and permissions pages, which are
// the only thing that sets مدير النظام apart; «إشراف كامل» covers the places
// the system treated the admin alone (calls oversight, Telegram link, logs).
{
  const catalog = read("src/lib/permission-catalog.ts");
  const auth = read("src/lib/server-auth.ts");
  const migration = read("prisma/migrations/20261007120000_supervisors_full_access/migration.sql");
  const supervisorList = JSON.parse(/SET "permissions" = '([^']+)'/.exec(migration)?.[1] || "[]");
  must(
    catalog.includes('permissions: ALL_PERMISSION_IDS.filter((p) => !p.startsWith("accounts.")),') &&
      catalog.includes('id: "system.oversight",') &&
      auth.includes('return hasPermission(principal, "system.oversight");') &&
      supervisorList.includes("system.oversight") && supervisorList.includes("backup.restore") &&
      supervisorList.includes("bot-problems.manage") && !supervisorList.some((id) => id.startsWith("accounts.")) &&
      migration.includes(`WHERE "id" = 'role_supervisor'`) &&
      ["src/app/api/student-calls/presence/route.ts", "src/app/api/student-calls/candidates/route.ts", "src/app/api/student-calls/route.ts", "src/app/api/students/route.ts", "src/app/api/logs/route.ts"]
        .every((file) => read(file).includes("oversees(principal)")),
    "دور المشرف ياخذ كل الصلاحيات عدا الحسابات والصلاحيات، ويتعامل مثل مدير النظام بباقي النظام",
  );
  // An old supervisor account keeps its own copy of the old role, accounts
  // views included: the server drops them and the migration cleans the copy.
  const cleanup = read("prisma/migrations/20261007130000_supervisor_accounts_own_permissions/migration.sql");
  must(
    auth.includes("if (!isAdmin && permissions.includes('system.oversight')) {") &&
      auth.includes("permissions = permissions.filter((permission) => !isAccountsPermission(permission));") &&
      cleanup.includes(`WHERE "roleId" = 'role_supervisor' AND "permissions" LIKE '%accounts.%'`) &&
      cleanup.includes("item.value NOT LIKE 'accounts.%' AND item.value <> 'page.accounts.view'"),
    "حساب مشرف قديم بنسخته الخاصة من الصلاحيات ما تطلعله الحسابات",
  );
}

if (failed) {
  console.error("\nفشل اختبار إدارة الحسابات والصلاحيات.");
  process.exit(1);
}
console.log("\nكل اختبارات إدارة الحسابات والصلاحيات نجحت.");
