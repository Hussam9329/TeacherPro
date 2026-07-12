#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failed = false;
function pass(message) {
  console.log(`✅ ${message}`);
}
function fail(message) {
  failed = true;
  console.error(`❌ ${message}`);
}
function must(condition, okMessage, failMessage = okMessage) {
  if (condition) pass(okMessage);
  else fail(failMessage);
}

const gradeEntry = read("src/components/teacher-pro/grade-entry.tsx");
const api = read("src/lib/api.ts");
const gradesRoute = read("src/app/api/grades/route.ts");
const gradeWriteback = read("src/lib/academic-grade-writeback-server.ts");
const entrySheetRoute = read("src/app/api/grades/entry-sheet/route.ts");
const profileDialog = read("src/components/teacher-pro/student-profile-dialog.tsx");
const profileLogRoute = read("src/app/api/students/profile-log/route.ts");
const profileStatsRoute = read("src/app/api/students/profile-stats/route.ts");
const pkg = JSON.parse(read("package.json"));

must(
  gradeEntry.includes("gradeApi") &&
    gradeEntry.includes("gradeApi.add") &&
    gradeEntry.includes("gradeApi.remove") &&
    gradeEntry.includes("gradeApi.removeAbsentByExam"),
  "صفحة تسجيل الدرجات تستخدم gradeApi للحفظ والحذف وإلغاء الغياب من الخادم",
  "يجب أن تكون عمليات تسجيل الدرجات Server-first عبر gradeApi.",
);

must(
  !/addGrade\s*,/.test(gradeEntry) &&
    !/deleteGrade\s*,/.test(gradeEntry) &&
    !/clearAbsentGradesForExam\s*,/.test(gradeEntry),
  "صفحة تسجيل الدرجات لا تستخدم عمليات store المحلية المتفائلة للدرجات",
  "لا يجوز أن تعتمد صفحة تسجيل الدرجات على addGrade/deleteGrade/clearAbsentGradesForExam من Zustand.",
);

must(
  gradeEntry.includes("AbortController") &&
    gradeEntry.includes("signal: controller.signal") &&
    gradeEntry.includes("controller.abort()") &&
    api.includes("get: (examId: string, options: ApiGetOptions = {})"),
  "ورقة إدخال الدرجات تلغي طلبات التحميل القديمة عبر AbortController",
  "يجب دعم AbortController في gradeEntrySheetApi واستخدامه في الصفحة.",
);

must(
  gradeEntry.includes("!result.ok || result.queued") &&
    gradeEntry.includes("لم يتم اعتماد أي تغيير محلي") &&
    gradeEntry.includes("mergeServerGradeIntoEntrySheet"),
  "الحفظ لا يظهر نجاحاً ولا يحدّث الورقة إلا بعد موافقة الخادم",
  "يجب رفض النجاح الوهمي عند فشل/queue طلب حفظ الدرجة.",
);

must(
  gradeEntry.includes("Promise.all") &&
    gradeEntry.includes("mark-missing-absent") &&
    gradeEntry.includes("تم تسجيل") &&
    !gradeEntry.includes("ستتم المزامنة تلقائياً"),
  "التسجيل الجماعي للغياب صار Server-first وليس محلياً ثم مزامنة لاحقة",
  "تسجيل غير المدخلين كغائبين يجب أن يمر عبر الخادم لكل طالب أو API خادمي.",
);

must(
  gradeEntry.includes("emitTeacherProDataChanged") &&
    gradeEntry.includes("grade-entry-save") &&
    gradeEntry.includes("grade-entry-delete") &&
    gradeEntry.includes("grade-entry-clear-absent"),
  "صفحة تسجيل الدرجات تبث مزامنة لباقي النظام بعد أي تغيير مؤكد",
  "يجب بث مزامنة بعد حفظ/حذف/إلغاء غياب الدرجات.",
);

must(
  gradesRoute.includes("syncAcademicGradeWriteback") &&
    gradesRoute.includes("db.$transaction") &&
    gradesRoute.includes("writeRequestAuditLog") &&
    gradeWriteback.includes("client.grade.upsert") &&
    gradeWriteback.includes("recalculateStudentsAcademicState") &&
    gradeWriteback.includes("studentId_examId"),
  "API حفظ الدرجة يستخدم العقدة الموحدة داخل transaction مع upsert وإعادة احتساب وتدقيق",
  "API الدرجات يجب أن يحسم التكرار وإعادة الاحتساب والتدقيق من العقدة الخادمية الموحدة.",
);

must(
  gradesRoute.includes("deleteMany") &&
    gradesRoute.includes('status === "غائب"') &&
    gradesRoute.includes("حذف غيابات امتحان وإعادة احتساب الطلاب"),
  "API حذف الغياب الجماعي يحذف من قاعدة البيانات ويعيد احتساب الطلاب",
  "إلغاء الغياب الجماعي يجب أن يكون خادمياً ويعيد الاحتساب.",
);

must(
  entrySheetRoute.includes("source: \"database\"") &&
    entrySheetRoute.includes("courseChapters") &&
    entrySheetRoute.includes("studentLeaves") &&
    entrySheetRoute.includes("opportunityLogs"),
  "API ورقة الإدخال يرجع سياق الطالب الكامل من قاعدة البيانات",
  "ورقة الإدخال تحتاج الطلاب/الدرجات/الإجازات/الفصول/سجلات الفرص من DB.",
);

must(
  profileDialog.includes('type StudentFileTab = "details" | "grades" | "exams" | "opportunities" | "followup" | "actions" | "archives" | "timeline"') &&
    profileDialog.includes('label: "المكالمات"') &&
    profileDialog.includes('label: "الإجازات"') &&
    profileDialog.includes('label: "التعهدات"') &&
    profileDialog.includes('label: "السجل الزمني"'),
  "ملف الطالب يملك مسارات واضحة للدرجات والغيابات والفرص والمكالمات والإجازات والتعهدات والسجل الزمني",
  "ملف الطالب يجب أن يحتوي تبويبات/كروت صريحة لكل مسار منطقي للطالب.",
);

must(
  profileDialog.includes('tab === "followup"') &&
    profileDialog.includes("مكالمات الطالب") &&
    profileDialog.includes("إجازات الطالب") &&
    profileDialog.includes("تعهدات ولي الأمر") &&
    profileDialog.includes("ملاحظات الطالب"),
  "ملف الطالب يعرض المتابعة والتعهدات والملاحظات داخل تبويب واضح",
  "يجب أن تكون المكالمات والإجازات والتعهدات والملاحظات ظاهرة داخل ملف الطالب.",
);

must(
  profileDialog.includes('tab === "timeline"') &&
    profileDialog.includes("اللوغ الكامل للطالب") &&
    profileDialog.includes("fullStudentLog"),
  "ملف الطالب يحتوي السجل الزمني الكامل داخل تبويب مستقل",
  "السجل الزمني الكامل يجب أن يكون مساراً مستقلاً داخل ملف الطالب.",
);

must(
  profileLogRoute.includes("...studentCalls.map((call) => call.examId)") &&
    profileLogRoute.includes("...studentLeaves.map((leave) => leave.examId)") &&
    profileLogRoute.includes("...opportunityLogs.map((log) => log.examId)"),
  "API ملف الطالب يجلب امتحانات الدرجات والمكالمات والإجازات وسجلات الفرص",
  "لوغ ملف الطالب يجب ألا يعتمد على امتحانات الدرجات فقط.",
);

must(
  profileStatsRoute.includes("callsCount") &&
    profileStatsRoute.includes("leavesCount") &&
    profileStatsRoute.includes("pledgesCount") &&
    profileStatsRoute.includes("timelineCount") &&
    profileStatsRoute.includes("deductions"),
  "إحصائيات ملف الطالب تشمل المكالمات والإجازات والتعهدات والخصومات والسجل الزمني",
  "كروت ملف الطالب يجب أن تأتي من إحصائيات DB لكل مسار مهم.",
);

must(
  pkg.scripts?.["test:grade-entry-integrity"] === "node scripts/test-grade-entry-integrity.mjs",
  "سكريبت test:grade-entry-integrity مضاف إلى package.json",
  "يجب إضافة سكريبت رسمي لاختبار تسجيل الدرجات.",
);

must(
  String(pkg.scripts?.["test:side-effects"] || "").includes("test:grade-entry-integrity"),
  "اختبار side-effects يشمل تسجيل الدرجات",
  "يجب أن يشمل test:side-effects اختبار تسجيل الدرجات.",
);

if (failed) {
  console.error("\nفشل اختبار سلامة صفحة تسجيل الدرجات وملف الطالب.");
  process.exit(1);
}

console.log("\nكل اختبارات سلامة صفحة تسجيل الدرجات وملف الطالب نجحت.");
