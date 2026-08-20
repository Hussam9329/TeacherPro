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
const logsRoute = read("src/app/api/logs/route.ts");
const opportunityLogsRoute = read("src/app/api/opportunity-logs/route.ts");
const schemaReadiness = read("src/lib/schema-readiness.ts");
const prismaSchema = read("prisma/schema.prisma");
const schemaMigration = read(
  "prisma/migrations/20260820140000_schema_authority_reconciliation/migration.sql",
);
const transitionPolicy = read("src/lib/second-chapter-transition.ts");
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
  clearRoute.includes("assertDatabaseSchemaReady") &&
    clearRoute.includes("insertLogClearBackup") &&
    prismaSchema.includes("model LogClearBackup") &&
    schemaMigration.includes('CREATE TABLE IF NOT EXISTS "LogClearBackup"') &&
    clearRoute.includes("verifyPassword") &&
    clearRoute.includes("checkApiRateLimit") &&
    clearRoute.includes("إجراءات الحسابات والصلاحيات والأمان وتسجيل الدخول"),
  "API تصفير اللوغ يحفظ نسخة احتياطية ويتحقق من كلمة مرور الأدمن ويشمل الحسابات/الصلاحيات",
  "logs/clear يجب أن يكون محمياً بكلمة مرور الأدمن ونسخة احتياطية ونطاق حسابات محدث.",
);

must(
  clearRoute.includes("SECOND_CHAPTER_TRANSITION_MARKER_ID") &&
    clearRoute.includes("SECOND_CHAPTER_PROTECTED_OPPORTUNITY_REASONS") &&
    logsRoute.includes("SECOND_CHAPTER_TRANSITION_MARKER_ID") &&
    opportunityLogsRoute.includes(
      "isSecondChapterProtectedOpportunityReason",
    ) &&
    transitionPolicy.includes("SECOND_CHAPTER_SETTLEMENT_REASON") &&
    transitionPolicy.includes("SECOND_CHAPTER_REACTIVATION_REASON"),
  "تصفير/حذف السجلات يحمي علامة انتقال الفصل الثاني وسجلات التسوية وإعادة التفعيل",
  "يجب منع حذف السجلات التي تحفظ بداية الفصل الثاني وتمنع رجوع آثار الفصل السابق.",
);

must(
  restoreRoute.includes("assertDatabaseSchemaReady") &&
    restoreRoute.includes("restoredAt") &&
    restoreRoute.includes("createMany") &&
    restoreRoute.includes("verifyPassword"),
  "API استعادة التصفير يعيد السجلات من آخر نسخة احتياطية ويمنع الاستعادة المكررة",
  "logs/restore يجب أن يعيد السجلات من النسخة الاحتياطية ويعلمها restoredAt.",
);

must(
  schemaReadiness.includes("_prisma_migrations") &&
    !clearRoute.includes("CREATE TABLE") &&
    !restoreRoute.includes("CREATE TABLE"),
  "مسارات التصفير والاستعادة تفحص migration فقط ولا تنشئ جداول أثناء الطلب",
  "يجب أن تكون بنية جدول النسخ الاحتياطية ضمن migrations فقط.",
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
