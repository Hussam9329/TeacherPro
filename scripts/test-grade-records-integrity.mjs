import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

let failed = false;
function pass(message) { console.log(`✅ ${message}`); }
function fail(message) { failed = true; console.error(`❌ ${message}`); }
function must(condition, okMessage, failMessage) {
  if (condition) pass(okMessage);
  else fail(failMessage || okMessage);
}

const page = read("src/components/teacher-pro/grade-records.tsx");
const api = read("src/lib/api.ts");
const pkg = JSON.parse(read("package.json"));

must(
  page.includes("gradeApi") && page.includes(".list(") && page.includes("signal: controller.signal") &&
    page.includes("AbortController"),
  "سجل الدرجات يحمّل الدرجات من API مع AbortController",
  "يجب أن يستخدم سجل الدرجات gradeApi.list مع signal."
);

must(
  page.includes("gradeCoverageStatsApi") && page.includes("quietAbort: true"),
  "إحصائيات تغطية الدرجات تدعم إلغاء الطلبات القديمة",
  "يجب تمرير AbortController إلى gradeCoverageStatsApi."
);

must(
  page.includes("canRunGradeRecordActions") &&
    page.includes("تم تعطيل التعديل والحذف حتى يرجع الاتصال"),
  "سجل الدرجات يمنع التعديل والحذف إذا فشل تحميل الخادم",
  "يجب منع الإجراءات الحساسة عند فشل بيانات الخادم."
);

must(
  page.includes("gradeApi.update") && page.includes("gradeApi.remove") &&
    !page.includes("updateGrade(") && !page.includes("deleteGrade("),
  "تعديل وحذف الدرجات في سجل الدرجات Server-first",
  "لا يجوز استخدام updateGrade/deleteGrade المحلي داخل سجل الدرجات."
);

must(
  page.includes("emitTeacherProDataChanged") &&
    page.includes("grade-records-edit") &&
    page.includes("grade-records-delete"),
  "سجل الدرجات يبث مزامنة بعد التعديل والحذف",
  "يجب بث مزامنة بعد نجاح إجراءات سجل الدرجات."
);

must(
  api.includes("gradeCoverageStatsApi") && api.includes("options: ApiGetOptions") &&
    api.includes("apiGet<GradeCoverageStatsResponse>") && api.includes("options"),
  "طبقة API تدعم AbortController لإحصائيات سجل الدرجات",
  "gradeCoverageStatsApi.get يجب أن يقبل ApiGetOptions."
);

must(
  pkg.scripts?.["test:grade-records-integrity"] === "node scripts/test-grade-records-integrity.mjs",
  "سكريبت test:grade-records-integrity موجود",
  "يجب إضافة اختبار رسمي لسجل الدرجات."
);

must(
  String(pkg.scripts?.["test:side-effects"] || "").includes("test:grade-records-integrity"),
  "الفحص الشامل test:side-effects يشمل سجل الدرجات",
  "يجب إدخال سجل الدرجات داخل test:side-effects."
);

if (failed) {
  console.error("\nفشل اختبار سلامة سجل الدرجات.");
  process.exit(1);
}
console.log("\nكل اختبارات سلامة سجل الدرجات نجحت.");
