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

const page = read("src/components/teacher-pro/exam-new.tsx");
const route = read("src/app/api/exams/route.ts");
const contextRoute = read("src/app/api/exams/create-context/route.ts");
const api = read("src/lib/api.ts");
const pkg = JSON.parse(read("package.json"));

must(
  page.includes("examCreateContextApi") &&
    page.includes("useTeacherProSyncKey") &&
    page.includes("AbortController"),
  "صفحة إضافة امتحان تحمل سياق الإضافة من قاعدة البيانات مع AbortController",
  "يجب أن تعتمد صفحة إضافة امتحان على create-context من DB وتلغي الطلبات القديمة.",
);

must(
  page.includes("examApi.add") &&
    !page.includes("addExam,") &&
    !page.includes("addExam(buildExamPayload"),
  "إضافة الامتحان Server-first عبر examApi.add وليس addExam المحلي",
  "لا يجوز حفظ الامتحان من صفحة إضافة امتحان عبر store optimistic.",
);

must(
  page.includes("selectedCourseBlockers") &&
    page.includes("canSelectForExam") &&
    page.includes("blockers"),
  "الواجهة تمنع اختيار الدورات غير الصالحة حسب سياق قاعدة البيانات",
  "يجب أن تمنع الواجهة الدورات الموقوفة أو بلا فصل أو ذات تعارض فصول.",
);

must(
  page.includes("لا يمكن حفظ الامتحان بسبب مشاكل الدورات") &&
    page.includes("انتظر تحميل سياق إضافة الامتحان من قاعدة البيانات"),
  "التحقق المحلي يوقف الحفظ عند غياب سياق الخادم أو وجود مشاكل دورات",
  "يجب أن يمنع validateForm الحفظ قبل تحميل سياق DB أو عند وجود blockers.",
);

must(
  page.includes("emitTeacherProDataChanged") &&
    page.includes("exam-created") &&
    page.includes("تمت إضافة الامتحان من قاعدة البيانات"),
  "بعد نجاح الخادم يتم بث مزامنة واضحة لباقي النظام",
  "يجب بث مزامنة بعد إضافة الامتحان حتى تعترف باقي الصفحات بالتغيير.",
);

must(
  api.includes("export interface ExamCreateContextResponse") &&
    api.includes("examCreateContextApi") &&
    api.includes('apiGet<ExamCreateContextResponse>("exams/create-context"'),
  "طبقة API الأمامية تحتوي سياق إضافة الامتحان",
  "يجب إضافة examCreateContextApi إلى src/lib/api.ts.",
);

must(
  contextRoute.includes('requirePermission(req, "exams.add")') &&
    contextRoute.includes("db.course.findMany") &&
    contextRoute.includes("db.courseChapter.findMany") &&
    contextRoute.includes("activeStudents") &&
    contextRoute.includes("canSelectForExam") &&
    contextRoute.includes('source: "database"'),
  "API سياق إضافة الامتحان يرجع الدورات والفصول والطلاب من قاعدة البيانات",
  "يجب أن يرجع create-context الدورات الصالحة/المحجوبة وعدادات الطلاب من DB.",
);

must(
  route.includes("courseSelectionProblems") &&
    route.includes("موقوفة عن التسجيل") &&
    route.includes("بلا فصل نشط") &&
    route.includes("فصول نشطة"),
  "API إضافة الامتحان يرفض الدورة الموقوفة أو بلا فصل أو ذات تعارض فصول",
  "يجب أن تكون حماية الدورات في السيرفر وليس الواجهة فقط.",
);

must(
  route.includes("يجب اختيار منطقة واحدة على الأقل") &&
    route.includes("selectedMainSites"),
  "API إضافة الامتحان يتحقق من اختيار منطقة واحدة على الأقل",
  "يجب أن يرفض السيرفر امتحاناً بلا موقع رئيسي.",
);

must(
  route.includes("writeRequestAuditLog") &&
    route.includes("إضافة امتحان من قاعدة البيانات") &&
    route.includes("source: 'database'"),
  "API إضافة الامتحان يسجل Audit ويرجع مصدر قاعدة البيانات",
  "يجب تسجيل إضافة الامتحان في audit log وإرجاع source=database.",
);

must(
  pkg.scripts &&
    pkg.scripts["test:exam-new-integrity"] === "node scripts/test-exam-new-integrity.mjs",
  "سكريبت test:exam-new-integrity مضاف إلى package.json",
  "يجب إضافة سكريبت رسمي لاختبار صفحة إضافة امتحان.",
);

must(
  pkg.scripts &&
    String(pkg.scripts["test:side-effects"] || "").includes("test:exam-new-integrity"),
  "اختبار side-effects يشمل صفحة إضافة امتحان",
  "يجب أن يشمل test:side-effects اختبار صفحة إضافة امتحان.",
);

if (failed) {
  console.error("\nفشل اختبار سلامة صفحة إضافة امتحان. راجع الرسائل أعلاه.");
  process.exit(1);
}

console.log("\nكل اختبارات سلامة صفحة إضافة امتحان نجحت.");
