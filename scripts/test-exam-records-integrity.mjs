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
const editDialog = read("src/components/teacher-pro/exam-edit-dialog.tsx");
const globals = read("src/app/globals.css");
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
  page.includes("editingExamId") &&
    page.includes("<ExamEditDialog") &&
    editDialog.includes("useState<FullExamEditState>") &&
    !page.includes("setEditDialog((prev)"),
  "حالة تعديل الامتحان معزولة داخل الـ Dialog ولا تعيد Render لقائمة السجل أثناء الكتابة",
  "يجب أن يمتلك ExamEditDialog حالته المحلية وألا تبقى setEditDialog في صفحة السجل."
);

must(
  page.includes("gradesByExamId") &&
    page.includes("studentById") &&
    page.includes("examById") &&
    page.includes("buildExamExportRows") &&
    page.includes("fetchRows={async") &&
    page.includes("rows={[]}"),
  "تصدير درجات الامتحان Lazy ويستخدم فهارس Memoized بدلاً من filter/find المتكرر لكل Render",
  "يجب ألا تُبنى صفوف التصدير لكل امتحان أثناء رسم الصفحة."
);

must(
  page.includes("const ExamRecordCard = React.memo") &&
    page.includes("const ExamRecordTableRow = React.memo") &&
    page.includes("const ExamRecordActions = React.memo"),
  "كروت وصفوف وإجراءات سجل الامتحانات Memoized بدون comparator مخصص قد يخفي تحديثات صحيحة",
  "يجب استخدام React.memo بالمقارنة الافتراضية الآمنة للكروت والصفوف والإجراءات."
);

must(
  page.includes("tp-exam-record-card-collapsed") &&
    globals.includes("@supports (content-visibility: auto)") &&
    globals.includes("contain-intrinsic-size: auto 250px"),
  "content-visibility محصور بالكروت المطوية مع حجم احتياطي آمن",
  "يجب عدم تطبيق content-visibility على الكروت المفتوحة أو على الصفحة كلها."
);

must(
  editDialog.includes("tp-exam-edit-dialog") &&
    editDialog.includes("backdrop-blur-none") &&
    editDialog.includes("[&>[data-slot=dialog-footer]]:backdrop-blur-none") &&
    editDialog.includes("[&>[data-slot=dialog-header]]:backdrop-blur-none"),
  "تم تخفيف طبقات الـ backdrop blur الثقيلة داخل نافذة تعديل الامتحان فقط",
  "يجب أن يبقى تخفيف blur محصوراً في Dialog التعديل حتى لا يتغير تصميم النظام كله."
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
