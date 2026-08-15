#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

let failed = false;
function pass(message) {
  console.log(`✅ ${message}`);
}
function fail(message) {
  failed = true;
  console.error(`❌ ${message}`);
}
function must(condition, okMessage, failMessage) {
  if (condition) pass(okMessage);
  else fail(failMessage || okMessage);
}

const pagePath = "src/components/teacher-pro/dismissed-students.tsx";
const detailsRoutePath = "src/app/api/dismissed-students/details/route.ts";
const statusActionRoutePath = "src/app/api/students/status-action/route.ts";
const dismissedStatsRoutePath = "src/app/api/dismissed-students/stats/route.ts";
const pkgPath = "package.json";

const page = read(pagePath);
const detailsRoute = read(detailsRoutePath);
const statusActionRoute = read(statusActionRoutePath);
const dismissedStatsRoute = read(dismissedStatsRoutePath);
const pkg = JSON.parse(read(pkgPath));

must(
  page.includes("studentApi") && page.includes(".list(") && page.includes('status: "مفصول"'),
  "صفحة المفصولين تقرأ قائمة المفصولين من API الطلاب بفلتر الحالة",
  "صفحة المفصولين يجب أن تقرأ المفصولين من قاعدة البيانات عبر studentApi.list(status=مفصول).",
);

must(
  page.includes("AbortController") &&
    page.includes("signal: controller.signal") &&
    page.includes("return () => controller.abort()"),
  "طلبات قائمة المفصولين وتفاصيل الفصل تُلغى عبر AbortController",
  "يجب إلغاء طلبات صفحة المفصولين عند تغيّر البحث/الفلاتر حتى لا ترجع نتائج قديمة فوق الجديدة.",
);

must(
  page.includes("/api/dismissed-students/details?") &&
    page.includes("ids.join") &&
    !page.includes('fetch("/api/dismissed-students/details", { credentials: "same-origin" })'),
  "تفاصيل الفصل تُطلب للطلاب المعروضين فقط وليس لكل المفصولين دفعة واحدة",
  "يجب تمرير ids إلى /api/dismissed-students/details وعدم تحميل كل تفاصيل المفصولين بلا حدود.",
);

must(
  page.includes("studentApi.statusAction") &&
    page.includes('action: "reactivate"') &&
    !/reactivateStudent\s*[,\n}]/.test(page),
  "إعادة التفعيل في صفحة المفصولين Server-first عبر status-action",
  "لا يجوز أن تستخدم صفحة المفصولين reactivateStudent المحلي؛ يجب استخدام studentApi.statusAction.",
);

must(
  page.includes("studentApi.update(studentId, { dismissalNotes: nextNote })") &&
    !/updateStudent\s*[,\n}]/.test(page),
  "حفظ ملاحظات الفصل Server-first عبر API الطلاب",
  "لا يجوز أن تستخدم صفحة المفصولين updateStudent المحلي لحفظ ملاحظات الفصل.",
);

must(
  page.includes("canRunSensitiveActions") &&
    page.includes("disabled={!canRunSensitiveActions") &&
    page.includes("تفاصيل الفصل غير محملة من بيانات النظام"),
  "الإجراءات الحساسة تُمنع عند فشل تحميل بيانات الخادم أو تفاصيل الفصل",
  "يجب منع إعادة التفعيل/الحفظ عند عرض بيانات غير مؤكدة من الخادم.",
);

must(
  page.includes('type PledgeFilter = "all" | "with-pledge" | "without-pledge"') &&
    page.includes("setFilterPledge") &&
    page.includes("with-pledge") &&
    page.includes("without-pledge"),
  "فلتر التعهد موجود ومرتبط بتفاصيل الفصل القادمة من قاعدة البيانات",
  "صفحة المفصولين تحتاج فلتر تعهد واضح: الكل / بتعهد / بدون تعهد.",
);

must(
  page.includes("emitTeacherProDataChanged") &&
    page.includes("dismissed-students-reactivate") &&
    page.includes("dismissed-students-note"),
  "إجراءات صفحة المفصولين تطلق مزامنة لباقي النظام بعد نجاح الخادم",
  "يجب بث مزامنة بعد إعادة التفعيل وحفظ الملاحظات حتى تعترف باقي الصفحات بالتغيير.",
);

must(
  detailsRoute.includes("requestedIds") &&
    detailsRoute.includes("id: { in: requestedIds }") &&
    detailsRoute.includes("db.$transaction") &&
    detailsRoute.includes("pledgeNotes"),
  "API تفاصيل المفصولين يدعم ids ويرجع سياق الفصل والتعهد من قاعدة البيانات",
  "API تفاصيل المفصولين يجب أن يدعم ids ويجمع السجلات/الدرجات/التعهدات من DB.",
);

must(
  (statusActionRoute.includes("db.$transaction") || statusActionRoute.includes("withSerializableTransaction")) &&
    statusActionRoute.includes('action !== "dismiss" && action !== "reactivate"') &&
    statusActionRoute.includes("فرصة أخيرة بعد تعهد") &&
    statusActionRoute.includes("auditLog.create"),
  "API حالة الطالب ينفذ الفصل/إعادة التفعيل داخل transaction مع سجلات وتدقيق",
  "إعادة التفعيل والفصل يجب أن تبقى داخل transaction واحدة مع audit log.",
);


must(
  page.includes("/api/dismissed-students/stats?") &&
    page.includes("setDismissedStats") &&
    page.includes("dismissedStatsLoading"),
  "إحصائيات المفصولين تأتي من API قاعدة البيانات وليست من الصفحة الحالية فقط",
  "يجب أن تقرأ صفحة المفصولين إحصائياتها من /api/dismissed-students/stats حتى لا تتأثر بحد الصفحة أو تأخر تفاصيل التعهد.",
);

must(
  dismissedStatsRoute.includes('source: "database"') &&
    dismissedStatsRoute.includes("withPledge") &&
    dismissedStatsRoute.includes("withoutPledge") &&
    dismissedStatsRoute.includes('distinct: ["studentId"]'),
  "API إحصائيات المفصولين يحسب التعهدات والملاحظات من قاعدة البيانات",
  "يجب أن يحسب API الإحصائيات total/withPledge/withoutPledge من DB وبطلاب مميزين.",
);

must(
  pkg.scripts &&
    pkg.scripts["test:dismissed-students-integrity"] === "node scripts/test-dismissed-students-integrity.mjs",
  "سكريبت test:dismissed-students-integrity مضاف إلى package.json",
  "يجب إضافة سكريبت رسمي لاختبار صفحة المفصولين.",
);

must(
  pkg.scripts &&
    String(pkg.scripts["test:side-effects"] || "").includes("test:dismissed-students-integrity"),
  "اختبار side-effects يشمل صفحة المفصولين",
  "يجب أن يشمل test:side-effects اختبار صفحة المفصولين حتى لا ترجع الأخطاء.",
);

if (failed) {
  console.error("\nفشل اختبار سلامة صفحة المفصولين. راجع الرسائل أعلاه.");
  process.exit(1);
}

console.log("\nكل اختبارات سلامة صفحة المفصولين نجحت.");
