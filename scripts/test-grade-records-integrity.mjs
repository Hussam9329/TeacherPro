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
const exportApi = read("src/app/api/grades/export/route.ts");
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
  page.includes('label: "درجة الطالب"') &&
    page.includes('key: "fullMark"') &&
    page.includes('label: "الدرجة الكاملة"') &&
    page.includes('normalizeScore(grade.score)'),
  "تصدير سجل الدرجات يفصل درجة الطالب عن الدرجة الكاملة كقيم رقمية",
  "يجب ألا يصدّر سجل الدرجات الدرجة بصيغة 20/50 التي قد يفسرها Excel كتاريخ."
);

must(
  page.includes('params.set("includeAllStudents", "1")') &&
    page.includes('statusText: row.statusText || grade?.status || "لم يمتحن"') &&
    page.includes('label: "الإجراء الحالي / المتوقع"'),
  "واجهة التصدير تطلب التقرير الكامل وتعرض لم يمتحن والإجراء المتوقع",
  "يجب أن يطلب تصدير سجل الدرجات كل طلاب الدورة لا سجلات الدرجات فقط."
);

must(
  exportApi.includes("completeGradeExportRows") &&
    exportApi.includes('grade?.status || "لم يمتحن"') &&
    exportApi.includes('gradeKind === "excused" ? "مجاز"') &&
    exportApi.includes("predictedMissingActionText") &&
    exportApi.includes("includesStudentsWithoutGrades: true"),
  "API التصدير يدمج طلاب الدورة بلا درجة داخل التقرير",
  "يجب أن ينشئ API صفاً لكل طالب مرتبط بالامتحان حتى عند غياب سجل الدرجة."
);

must(
  exportApi.includes('return "لا إجراء - الطالب مجاز"') &&
    exportApi.includes('return "فصل تلقائي عند تسجيله غائباً"') &&
    exportApi.includes("المتبقي المتوقع") &&
    exportApi.includes("student.studentLeaves"),
  "الإجراء المتوقع يراعي الإجازة والسماح والفصل وخصم الفرص",
  "يجب ألا يعرض التقرير إجراءً عقابياً موحداً للحالات المحمية."
);

must(
    exportApi.includes("protectedGradeActionText") &&
    exportApi.includes('gradeKind === "excused" ? "مجاز"') &&
    exportApi.includes("protectedGradeActionText(gradeKind)") &&
    page.includes("row.predictedActionText || cls.text"),
  "تصدير المجاز يعتمد تصنيف الخادم ويعرض لا إجراء بدلاً من مخصوم",
  "يجب ألا يعيد المتصفح تصنيف الطالب المجاز كمخصوم عند نقص كاش الإجازات."
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
