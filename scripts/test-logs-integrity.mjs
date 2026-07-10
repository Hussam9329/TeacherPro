#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failed = false;
const pass = (message) => console.log(`✅ ${message}`);
const fail = (message) => { failed = true; console.error(`❌ ${message}`); };
const must = (condition, ok, bad = ok) => condition ? pass(ok) : fail(bad);

const logsView = read("src/components/teacher-pro/logs.tsx");
const logsRoute = read("src/app/api/logs/route.ts");
const api = read("src/lib/api.ts");
const pkg = JSON.parse(read("package.json"));

must(
  logsView.includes("logApi") &&
    logsView.includes("AbortController") &&
    logsView.includes("signal: controller.signal") &&
    logsView.includes("قاعدة البيانات"),
  "صفحة السجلات صارت Server-driven وتلغي الطلبات القديمة",
  "صفحة السجلات يجب أن تقرأ من logApi مع AbortController لا من كاش Zustand فقط.",
);

must(
  !logsView.includes("const { logs } = useTeacherStore()") &&
    !logsView.includes("searchAny"),
  "صفحة السجلات لا تعتمد على كاش store أو فلترة محلية فقط",
  "يجب إزالة الاعتماد على store logs والبحث المحلي searchAny.",
);

must(
  api.includes("export type LogListQuery") &&
    api.includes("module: query.module") &&
    api.includes("user: query.user") &&
    api.includes("apiGet<Pick<ServerData, \"logs\">"),
  "طبقة API تدعم فلاتر السجلات وخيارات الإلغاء",
  "logApi.list يجب أن يدعم q/module/user/page/pageSize و AbortController.",
);

must(
  logsRoute.includes("Prisma.AuditLogWhereInput") &&
    logsRoute.includes("searchParams.get('q')") &&
    logsRoute.includes("searchParams.get('module')") &&
    logsRoute.includes("searchParams.get('user')") &&
    logsRoute.includes("source: 'database'"),
  "API السجلات يدعم البحث والفلاتر والصفحات من قاعدة البيانات",
  "GET /api/logs يجب أن يدعم q/module/user مع pagination ويرجع source=database.",
);

must(
  logsRoute.includes("logs.delete") &&
    logsRoute.includes("حذف السجلات متاح لمدير النظام صاحب صلاحية حذف السجلات فقط"),
  "حذف سجل مفرد مقيد بالمدير وصلاحية logs.delete",
  "DELETE /api/logs يجب أن لا يكتفي بقراءة السجلات أو حذف غير مضبوط.",
);

must(
  pkg.scripts["test:logs-integrity"] === "node scripts/test-logs-integrity.mjs" &&
    String(pkg.scripts["test:side-effects"] || "").includes("test:logs-integrity"),
  "اختبار السجلات مربوط داخل test:side-effects",
  "يجب ربط اختبار السجلات داخل package.json.",
);

if (failed) {
  console.error("\nفشل اختبار السجلات.");
  process.exit(1);
}
console.log("\nكل اختبارات السجلات نجحت.");
