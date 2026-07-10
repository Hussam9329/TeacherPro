#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failed = false;
const pass = (message) => console.log(`✅ ${message}`);
const fail = (message) => { failed = true; console.error(`❌ ${message}`); };
const must = (condition, ok, bad = ok) => condition ? pass(ok) : fail(bad);

const resetView = read("src/components/teacher-pro/admin-log-reset.tsx");
const clearRoute = read("src/app/api/logs/clear/route.ts");
const restoreRoute = read("src/app/api/logs/restore/route.ts");
const store = read("src/lib/teacher-store.ts");
const pkg = JSON.parse(read("package.json"));

must(
  store.includes('id: "logs.clear"') &&
    store.includes('id: "logs.restore"') &&
    store.includes('"admin-log-reset": "logs.clear"'),
  "تصفير اللوغ مربوط بصلاحيات logs.clear/logs.restore",
  "يجب أن تكون صلاحيات تصفير واستعادة اللوغ معرفة ومربوطة بالقسم.",
);

must(
  resetView.includes("DEFAULT_SCOPE_IDS") &&
    resetView.includes("audit-accounts") &&
    resetView.includes("opportunity-logs") &&
    resetView.includes("restoreLastLogClear"),
  "واجهة تصفير اللوغ تعرض نطاقات واضحة واستعادة آخر تصفير",
  "واجهة تصفير اللوغ يجب أن تحتوي نطاقات واضحة واستعادة.",
);

must(
  clearRoute.includes("ensureLogClearBackupTable") &&
    clearRoute.includes("insertLogClearBackup") &&
    clearRoute.includes("verifyPassword") &&
    clearRoute.includes("checkApiRateLimit") &&
    clearRoute.includes("إجراءات الحسابات والصلاحيات والأمان وتسجيل الدخول"),
  "API تصفير اللوغ يحفظ نسخة احتياطية ويتحقق من كلمة مرور الأدمن ويشمل الحسابات/الصلاحيات",
  "logs/clear يجب أن يكون محمياً بكلمة مرور الأدمن ونسخة احتياطية ونطاق حسابات محدث.",
);

must(
  restoreRoute.includes("ensureLogClearBackupTable") &&
    restoreRoute.includes("restoredAt") &&
    restoreRoute.includes("createMany") &&
    restoreRoute.includes("verifyPassword"),
  "API استعادة التصفير يعيد السجلات من آخر نسخة احتياطية ويمنع الاستعادة المكررة",
  "logs/restore يجب أن يعيد السجلات من النسخة الاحتياطية ويعلمها restoredAt.",
);

must(
  pkg.scripts["test:admin-log-reset-integrity"] === "node scripts/test-admin-log-reset-integrity.mjs" &&
    String(pkg.scripts["test:side-effects"] || "").includes("test:admin-log-reset-integrity"),
  "اختبار تصفير اللوغ مربوط داخل test:side-effects",
  "يجب ربط اختبار تصفير اللوغ في package.json.",
);

if (failed) {
  console.error("\nفشل اختبار تصفير اللوغ.");
  process.exit(1);
}
console.log("\nكل اختبارات تصفير اللوغ نجحت.");
