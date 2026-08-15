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

const page = read("src/components/teacher-pro/exam-records.tsx");
const api = read("src/lib/api.ts");
const pkg = JSON.parse(read("package.json"));

must(
  page.includes("expandedExamIds") && page.includes("toggleExamDetails") &&
    page.includes("إظهار التفاصيل") && page.includes("إخفاء التفاصيل"),
  "سجل الامتحانات يخفي تفاصيل الامتحان حتى يضغط المستخدم إظهار التفاصيل",
  "يجب وجود حالة expandedExamIds وزر إظهار/إخفاء التفاصيل."
);

must(
  page.includes("تفاصيل الامتحان مخفية") &&
    page.includes("renderExamDetailsPanel") &&
    page.includes("detailsOpen ?"),
  "كارت الامتحان يعرض ملخصاً فقط ويُظهر التفاصيل عند الفتح",
  "يجب أن تكون تفاصيل الامتحان داخل شرط detailsOpen لا ظاهرة دائماً."
);

must(
  page.includes("React.Fragment") && page.includes("colSpan={9}") &&
    page.includes("detailsOpen &&"),
  "عرض الجدول يخفي التفاصيل في صف منفصل لا يظهر إلا عند الفتح",
  "جدول سجل الامتحانات يجب أن يخفي التفاصيل داخل صف موسع مشروط."
);

must(
  page.includes("examApi.update") && page.includes("examApi.remove") &&
    !page.includes("updateExam(") && !page.includes("toggleExam(") && !page.includes("deleteExam("),
  "إجراءات سجل الامتحانات Server-first ولا تستخدم store optimistic",
  "لا يجوز أن تستخدم صفحة سجل الامتحانات updateExam/toggleExam/deleteExam من الكاش."
);

must(
  page.includes("loadFromServer") && page.includes("refreshExamRecordsAfterMutation") &&
    page.includes("emitTeacherProDataChanged"),
  "بعد تعديل/تعطيل/حذف الامتحان يتم تحديث النظام ومزامنة باقي الصفحات",
  "يجب تحديث البيانات وبث المزامنة بعد نجاح الخادم."
);

must(
  page.includes("AbortController") &&
    page.includes("examStatsApi") &&
    page.includes("signal: controller.signal"),
  "إحصائيات سجل الامتحانات تستخدم AbortController لمنع رجوع طلب قديم",
  "تحميل إحصائيات الامتحانات يجب أن يدعم إلغاء الطلبات القديمة."
);

must(
  api.includes("examStatsApi") && api.includes("options: ApiGetOptions") &&
    api.includes("apiGet<ExamStatsResponse>") && api.includes("options"),
  "طبقة API تدعم AbortController لإحصائيات الامتحانات",
  "examStatsApi.get يجب أن يقبل ApiGetOptions ويمررها إلى apiGet."
);

must(
  pkg.scripts?.["test:exam-records-integrity"] === "node scripts/test-exam-records-integrity.mjs",
  "سكريبت test:exam-records-integrity موجود",
  "يجب إضافة اختبار رسمي لسجل الامتحانات."
);

must(
  String(pkg.scripts?.["test:side-effects"] || "").includes("test:exam-records-integrity"),
  "الفحص الشامل test:side-effects يشمل سجل الامتحانات",
  "يجب إدخال سجل الامتحانات داخل test:side-effects."
);

if (failed) {
  console.error("\nفشل اختبار سلامة سجل الامتحانات.");
  process.exit(1);
}
console.log("\nكل اختبارات سلامة سجل الامتحانات نجحت.");
