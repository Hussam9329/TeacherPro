#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const componentRoot = path.join(root, "src/components/teacher-pro");
const componentFiles = fs
  .readdirSync(componentRoot)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, source: fs.readFileSync(path.join(componentRoot, name), "utf8") }));

let failed = 0;
const must = (condition, message) => {
  if (condition) console.log(`✅ ${message}`);
  else {
    failed += 1;
    console.error(`❌ ${message}`);
  }
};

const language = read("src/lib/teacherpro-language.ts");
const toast = read("src/lib/user-toast.ts");
const actionLock = read("src/hooks/use-action-lock.ts");
const layout = read("src/components/teacher-pro/layout.tsx");
const uiKit = read("src/components/teacher-pro/ui-kit.tsx");
const exportDialog = read("src/components/teacher-pro/export-dialog.tsx");
const logsView = read("src/components/teacher-pro/logs.tsx");
const logsRoute = read("src/app/api/logs/route.ts");
const opportunitiesRoute = read("src/app/api/opportunities/stats/route.ts");
const dismissedRoute = read("src/app/api/dismissed-students/stats/route.ts");
const opportunitiesView = read("src/components/teacher-pro/opportunities.tsx");
const dismissedView = read("src/components/teacher-pro/dismissed-students.tsx");
const registryView = read("src/components/teacher-pro/student-registry.tsx");
const gradeRecordsView = read("src/components/teacher-pro/grade-records.tsx");
const followUpView = read("src/components/teacher-pro/follow-up.tsx");
const pkg = JSON.parse(read("package.json"));

const canonicalTerms = [
  "الطلاب غير الموجودين",
  "البطاقات",
  "تيليجرام",
  "درجات مسجلة",
  "نوع البرنامج",
  "فصل مؤقت",
  "فصل نهائي",
  "فرص محفوظة",
];
must(
  canonicalTerms.every((term) => language.includes(term)),
  "القاموس المركزي يحتوي كل المصطلحات المعتمدة للدفعة الثانية",
);

const allComponents = componentFiles.map((item) => item.source).join("\n");
const legacyTerms = [
  "الطلاب الغير موجودين",
  "الطلاب غير المتواجدين",
  "تليكرام",
  "تلغرام",
  "تلكرام",
  "نوع الدراسة",
  "كارت",
  "كروت",
  "الفرص الحالية",
];
must(
  legacyTerms.every((term) => !allComponents.includes(term)),
  "لا تستخدم واجهات TeacherPro أكثر من اسم لنفس المصطلح",
);

must(
  componentFiles.every(({ source }) => !source.includes('from "sonner"') && !source.includes("from 'sonner'")),
  "كل رسائل TeacherPro تمر عبر طبقة الرسائل البشرية الموحدة",
);

const forbiddenTechnicalUi = [
  "Server-first",
  "Server first",
  "Sync Scope",
  "Database Direct",
  "Permission ID",
  "قاعدة البيانات",
  "الخادم",
  "السيرفر",
];
must(
  forbiddenTechnicalUi.every((term) => !allComponents.includes(term)),
  "لا تظهر المصطلحات التقنية المحظورة داخل الواجهة العامة",
);

const isolatedTechnicalLabel = /(?:>|["'`])\s*(?:Cache|JSON|ID|DB)\s*(?:<|["'`])/;
must(
  !isolatedTechnicalLabel.test(allComponents),
  "لا تظهر تسميات Cache أو JSON أو ID أو DB كعناوين للمستخدم",
);

must(
  language.includes('saving: "جارٍ الحفظ"') &&
    language.includes('saved: "تم الحفظ"') &&
    language.includes('failed: "تعذر الحفظ"') &&
    language.includes('retry: "إعادة المحاولة"'),
  "حالات الحفظ الأربع موحدة في مصدر واحد",
);

must(
  actionLock.includes('status: "saving"') &&
    toast.includes("teacherProSuccessToastCopy") &&
    toast.includes("teacherProErrorToastCopy") &&
    layout.includes('teacherpro:user-action-status') &&
    layout.includes("TEACHERPRO_ACTION_COPY.retry"),
  "حالة الحفظ تبدأ عند العملية وتُثبت فقط برسالة النجاح أو الخطأ النهائية",
);

must(
  language.includes("لم يتم حفظ أي تغيير") &&
    language.includes("تحقق من البيانات") &&
    language.includes("TEACHERPRO_ACTION_COPY.retry"),
  "رسالة الخطأ تشرح ما فشل وهل حُفظ شيء وما الخطوة التالية",
);

must(
  uiKit.includes("TEACHERPRO_COUNT_SCOPE_COPY") &&
    uiKit.includes("data-count-scope={scope}") &&
    uiKit.includes("CountScopeSummary") &&
    uiKit.includes("إجمالي ${subject} في النظام") &&
    uiKit.includes("المطابقون للفلاتر") &&
    uiKit.includes("المعروض في الصفحة"),
  "مكوّنات العدادات تميّز بصرياً بين النظام والفلاتر والصفحة الحالية",
);

must(
  opportunitiesRoute.includes("system,") && opportunitiesRoute.includes("filtered,") &&
    dismissedRoute.includes("system,") && dismissedRoute.includes("filtered,") &&
    logsRoute.includes("systemTotalCount"),
  "واجهات الإحصائيات المهمة ترجع إجمالي النظام منفصلاً عن نتائج الفلاتر",
);

must(
  [opportunitiesView, dismissedView, registryView, gradeRecordsView, logsView].every((source) =>
    source.includes("CountScopeSummary"),
  ),
  "الصفحات ذات العدادات الحساسة تعرض نطاق كل رقم بوضوح",
);

must(
  followUpView.includes('data-count-scope="filtered"') &&
    followUpView.includes("المعروض في الصفحة") &&
    followUpView.includes("المطابقون للفلاتر"),
  "عدادات المكالمات لا تبدو كأنها إجمالي النظام وهي مرتبطة بالاختيار الحالي",
);

must(
  exportDialog.includes("humanizeTeacherProText") &&
    exportDialog.includes("normalizeExportValue") &&
    logsView.includes("humanizeTeacherProText") &&
    logsView.includes("technicalDetails"),
  "المصطلحات الموحدة تشمل التصدير وملخص السجلات مع إبقاء التفاصيل التقنية اختيارية",
);

must(
  pkg.scripts["test:language-ux-integrity"] === "node scripts/test-language-ux-integrity.mjs" &&
    String(pkg.scripts["test:side-effects"] || "").includes("test:language-ux-integrity"),
  "اختبار اللغة وتجربة النظام مربوط بفحص الآثار الجانبية العام",
);

if (failed) {
  console.error(`\nفشل ${failed} من اختبارات توحيد اللغة وتجربة النظام.`);
  process.exit(1);
}
console.log("\nكل اختبارات توحيد اللغة والمصطلحات والعدادات نجحت.");
