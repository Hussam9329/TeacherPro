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

const page = read("src/components/teacher-pro/missing-students-notes.tsx");
const api = read("src/lib/api.ts");
const pkg = JSON.parse(read("package.json"));

must(
  page.includes('fetch("/api/grade-entry-missing-notes"') &&
    page.includes("AbortController") &&
    page.includes("signal"),
  "صفحة الطلاب غير الموجودين تقرأ الملاحظات من قاعدة البيانات مع AbortController",
  "يجب أن تقرأ الصفحة من /api/grade-entry-missing-notes مباشرةً مع signal."
);

must(
  !page.includes("readGradeEntryMissingNotes") &&
    !page.includes("fetchGradeEntryMissingNotesFromServer") &&
    !page.includes("deleteGradeEntryMissingNote"),
  "الصفحة لا تعرض/تحذف اعتماداً على localStorage أو دوال تفاؤلية",
  "لا يجوز استخدام readGradeEntryMissingNotes أو deleteGradeEntryMissingNote في صفحة الطلاب غير الموجودين."
);

must(
  page.includes("method: \"DELETE\"") &&
    page.includes("حذف من قاعدة البيانات") &&
    page.includes("تعذر حذف الملاحظة من قاعدة البيانات"),
  "حذف ملاحظة الطلاب غير الموجودين Server-first من API",
  "الحذف يجب أن يمر عبر DELETE إلى API مع رسالة فشل واضحة."
);

must(
  page.includes("missingStudentsNotesStatsApi") &&
    page.includes("مصدر الصفحة") &&
    page.includes("DB"),
  "الإحصائيات ومصدر الصفحة واضحان للمستخدم من قاعدة البيانات",
  "يجب عرض إحصائيات قاعدة البيانات ومؤشر مصدر الصفحة."
);

must(
  page.includes("emitTeacherProDataChanged") &&
    page.includes("missing-students-notes-delete"),
  "الصفحة تبث مزامنة بعد حذف الملاحظة",
  "يجب بث مزامنة بعد حذف ملاحظة الطلاب غير الموجودين."
);

must(
  api.includes("missingStudentsNotesStatsApi") &&
    api.includes("options: ApiGetOptions") &&
    api.includes("grade-entry-missing-notes/stats"),
  "طبقة API تدعم AbortController لإحصائيات الطلاب غير الموجودين",
  "missingStudentsNotesStatsApi.get يجب أن يقبل ApiGetOptions."
);

must(
  pkg.scripts?.["test:missing-students-notes-integrity"] === "node scripts/test-missing-students-notes-integrity.mjs",
  "سكريبت test:missing-students-notes-integrity موجود",
  "يجب إضافة اختبار رسمي للطلاب غير الموجودين."
);

must(
  String(pkg.scripts?.["test:side-effects"] || "").includes("test:missing-students-notes-integrity"),
  "الفحص الشامل test:side-effects يشمل الطلاب غير الموجودين",
  "يجب إدخال اختبار الطلاب غير الموجودين داخل test:side-effects."
);

if (failed) {
  console.error("\nفشل اختبار سلامة صفحة الطلاب غير الموجودين.");
  process.exit(1);
}
console.log("\nكل اختبارات سلامة صفحة الطلاب غير الموجودين نجحت.");
