#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failed = false;
const pass = (message) => console.log(`✅ ${message}`);
const fail = (message) => {
  failed = true;
  console.error(`❌ ${message}`);
};
const must = (condition, ok, bad = ok) => (condition ? pass(ok) : fail(bad));

const store = read("src/lib/teacher-store.ts");
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
  "follow-up.pledges.view",
  "follow-up.pledges.manage",
  "grades.missing.view",
  "grades.missing.manage",
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
    store.includes('"follow-up-pledges": "follow-up.pledges.view"') &&
    store.includes('"missing-students-notes": "grades.missing.view"') &&
    store.includes('"admin-log-reset": "logs.clear"'),
  "ربط الصفحات الحساسة بصلاحياتها الدقيقة داخل SECTION_PERMISSIONS",
  "SECTION_PERMISSIONS يجب أن يربط المكالمات/الإجازات/التعهدات/الطلاب غير الموجودين/تصفير اللوغ بصلاحيات دقيقة.",
);

must(
  accounts.includes("PermissionsArchitectureTab") &&
    accounts.includes("PAGE_PERMISSION_BLUEPRINT") &&
    accounts.includes(
      "أي ميزة جديدة تنضاف لأي صفحة لازم تنضاف هنا داخل PERMISSION_CATALOG",
    ),
  "إدارة الحسابات تحتوي تبويب هيكلة الصلاحيات مع قاعدة إضافة أي ميزة جديدة",
  "إدارة الحسابات يجب أن تحتوي تبويب يشرح هيكلة الصلاحيات ويجعل أي ميزة جديدة Permission ID واضح.",
);

must(
  usersRoute.includes('"accounts.users.add"') &&
    usersRoute.includes('"accounts.users.edit"') &&
    usersRoute.includes('"accounts.users.delete"') &&
    usersRoute.includes('"accounts.users.view"') &&
    usersRoute.includes("requirePermissionPrincipal") &&
    usersRoute.includes("requireAnyPermission"),
  "API المستخدمين يستخدم صلاحيات دقيقة للعرض/الإضافة/التعديل/الحذف",
  "users API يجب أن لا يبقى معتمد فقط على accounts.manage لكل شيء.",
);

must(
  rolesRoute.includes(
    "requirePermissionPrincipal(req, 'accounts.roles.add')",
  ) &&
    rolesRoute.includes(
      "requirePermissionPrincipal(req, 'accounts.roles.edit')",
    ) &&
    rolesRoute.includes(
      "requirePermissionPrincipal(req, 'accounts.roles.delete')",
    ) &&
    rolesRoute.includes(
      "requireAnyPermission(req, ['accounts.view', 'accounts.roles.view'])",
    ),
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
  store.includes('p !== "accounts.users.delete"') &&
    store.includes('p !== "accounts.permissions.assign"') &&
    store.includes('p !== "logs.clear"') &&
    store.includes('p !== "logs.restore"'),
  "الأدوار الافتراضية لا تمنح الصلاحيات الحساسة الجديدة تلقائياً للمشرف",
  "يجب منع الصلاحيات الحساسة الجديدة من دور المشرف الافتراضي.",
);

must(
  pkg.scripts["test:accounts-permissions-integrity"] ===
    "node scripts/test-accounts-permissions-integrity.mjs" &&
    String(pkg.scripts["test:side-effects"] || "").includes(
      "test:accounts-permissions-integrity",
    ),
  "اختبار إدارة الحسابات والصلاحيات مربوط داخل test:side-effects",
  "يجب ربط اختبار الحسابات والصلاحيات في package.json و test:side-effects.",
);

if (failed) {
  console.error("\nفشل اختبار إدارة الحسابات والصلاحيات.");
  process.exit(1);
}
console.log("\nكل اختبارات إدارة الحسابات والصلاحيات نجحت.");
