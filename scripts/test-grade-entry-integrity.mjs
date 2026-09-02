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
const gradeEntryStats = read("src/lib/grade-entry-stats.ts");
const gradeEntryOfflineOutbox = read("src/lib/grade-entry-offline-outbox.ts");
const academicTypes = read("src/lib/academic-types.ts");
const teacherLayout = read("src/components/teacher-pro/layout.tsx");
const api = read("src/lib/api.ts");
const gradesRoute = read("src/app/api/grades/route.ts");
const gradeWriteback = read("src/lib/academic-grade-writeback-server.ts");
const entrySheetRoute = read("src/app/api/grades/entry-sheet/route.ts");
const markMissingAbsentRoute = read("src/app/api/grades/mark-missing-absent/route.ts");
const correctionSheetsRoute = read("src/app/api/correction-sheets/route.ts");
const telegramSubmissionsRoute = read(
  "src/app/api/telegram-exam-submissions/route.ts",
);
const teacherStore = read("src/lib/teacher-store.ts");
const profileDialog = read("src/components/teacher-pro/student-profile-dialog.tsx");
const profileLogRoute = read("src/app/api/students/profile-log/route.ts");
const profileStatsRoute = read("src/app/api/students/profile-stats/route.ts");
const pkg = JSON.parse(read("package.json"));

must(
  gradeEntry.includes('import { countAllManualGradesForExam } from "@/lib/grade-entry-stats"') &&
    !gradeEntry.includes("manualNumericGradeCount") &&
    gradeEntry.includes('data-manual-grade-count="true"') &&
    gradeEntry.includes("الأوراق المدخلة يدوياً") &&
    gradeEntryStats.includes("purelyAutomaticStatuses") &&
    gradeEntryStats.includes("numericStudentIds") &&
    gradeEntryStats.includes("pendingStudentIds"),
  "عداد الإدخال اليدوي يعرض الرقمية والمعلقة وما قبل التسجيل ويستبعد الحالات التلقائية",
  "يجب أن يعتمد العداد الموحد الحالي دون إبقاء العداد الرقمي القديم الميت.",
);

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
    gradeEntry.includes("reconcileFailedGradeSave") &&
    gradeEntry.includes("غير محفوظ — أعد المحاولة") &&
    gradeEntry.includes("mergeServerGradeIntoEntrySheet") &&
    gradeEntry.includes("draftRevisionRef") &&
    gradeEntry.includes("gradeSaveChainsRef") &&
    gradeEntry.includes('phase: "dirty"') &&
    gradeEntry.includes('phase: "error"') &&
    gradeEntry.includes('phase: "saved"'),
  "الحفظ يميز المسودة والحفظ والفشل، ويتحقق من DB ويسلسل طلبات الطالب",
  "يجب منع شارة الحفظ الوهمية ومصالحة الفشل وتسلسل طلبات الصف الواحد.",
);

must(
  gradeEntry.includes("stageGradeEntryOfflineSave") &&
    gradeEntry.includes("markGradeEntryOfflineAttempted") &&
    gradeEntry.includes("confirmGradeEntryOfflineAttempt") &&
    gradeEntry.includes('phase: "queued"') &&
    gradeEntry.includes("محفوظ محلياً — بانتظار الإنترنت") &&
    gradeEntry.includes("getGradeEntryOfflineSaves(selectedExamId)") &&
    gradeEntry.includes("subscribeGradeEntryOffline"),
  "تسجيل الدرجات يحفظ آخر قيمة محلياً ويستعيدها ويعرض حالة انتظار الإنترنت",
  "يجب أن تستمر الدرجة محلياً عبر انقطاع الشبكة وإعادة فتح ورقة الإدخال.",
);


must(
  academicTypes.includes("export const GRADE_STATUSES = [") &&
    academicTypes.includes("export type GradeStatus = (typeof GRADE_STATUSES)[number]") &&
    gradeEntry.includes('import type { GradeStatus } from "@/lib/academic-types"') &&
    gradeEntry.includes("status: GradeStatus;") &&
    gradeEntryOfflineOutbox.includes('import { GRADE_STATUSES, type GradeStatus } from "./academic-types"') &&
    gradeEntryOfflineOutbox.includes("export type OfflineGradeStatus = GradeStatus") &&
    ["درجة", "غائب", "غش", "مجاز", "ضمن فترة السماح", "قبل تسجيل الطالب"].every(
      (status) => academicTypes.includes(`"${status}"`),
    ),
  "حالات تسجيل الدرجات والـOffline Outbox تستخدم نوع GradeStatus المركزي نفسه",
  "يجب ألا يكون للـOffline Outbox اتحاد حالات أضيق من حالات تسجيل الدرجات؛ هذا يمنع فشل TypeScript وقت Vercel build.",
);
must(
  gradeEntryOfflineOutbox.includes('const STORAGE_KEY = "teacherpro-grade-entry-offline-v2"') &&
    gradeEntryOfflineOutbox.includes("let flushTimer: number | null = null") &&
    !gradeEntryOfflineOutbox.includes("ReturnType<typeof window.setTimeout>") &&
    gradeEntryOfflineOutbox.includes('window.addEventListener("online"') &&
    gradeEntryOfflineOutbox.includes("currentMatchesAttempted") &&
    gradeEntryOfflineOutbox.includes("currentMatchesBaseline") &&
    gradeEntryOfflineOutbox.includes('state: "conflict"') &&
    gradeEntryOfflineOutbox.includes("desiredMatchesServerGrade") &&
    gradeEntryOfflineOutbox.includes("confirmGradeEntryOfflineAttempt") &&
    gradeEntryOfflineOutbox.includes("flushGradeEntryOfflineSaves"),
  "طابور الدرجات المؤجل يستخدم مؤقت متصفح صحيح ويصالح الرد المفقود دون الكتابة فوق تعديل أحدث",
  "المزامنة المؤجلة يجب أن تستخدم رقم مؤقت المتصفح وتتحقق من الخادم قبل الإرسال وتحفظ التعارض للمراجعة.",
);

must(
  teacherLayout.includes("flushGradeEntryOfflineSaves") &&
    teacherLayout.includes('window.addEventListener("online", flushOfflineGrades)') &&
    teacherLayout.includes('window.addEventListener("focus", flushOfflineGrades)'),
  "المزامنة المؤجلة تعمل على مستوى التطبيق عند رجوع الإنترنت أو العودة للتبويب",
  "يجب ألا تعتمد مزامنة الدرجات المؤجلة على بقاء صفحة تسجيل الدرجات مفتوحة فقط.",
);

must(
  gradeEntry.includes("stageGradeEntryOfflineSave") &&
    gradeEntry.includes("markGradeEntryOfflineAttempted") &&
    gradeEntry.includes("confirmGradeEntryOfflineAttempt") &&
    gradeEntry.includes('phase: "queued"') &&
    gradeEntry.includes("محفوظ محلياً — بانتظار الإنترنت") &&
    gradeEntry.includes("getGradeEntryOfflineSaves(selectedExamId)") &&
    gradeEntry.includes("subscribeGradeEntryOffline"),
  "تسجيل الدرجات يحفظ آخر قيمة محلياً ويستعيدها ويعرض حالة انتظار الإنترنت",
  "يجب أن تستمر الدرجة محلياً عبر انقطاع الشبكة وإعادة فتح ورقة الإدخال.",
);

must(
  gradeEntryOfflineOutbox.includes('const STORAGE_KEY = "teacherpro-grade-entry-offline-v2"') &&
    gradeEntryOfflineOutbox.includes('window.addEventListener("online"') &&
    gradeEntryOfflineOutbox.includes("currentMatchesAttempted") &&
    gradeEntryOfflineOutbox.includes("currentMatchesBaseline") &&
    gradeEntryOfflineOutbox.includes('state: "conflict"') &&
    gradeEntryOfflineOutbox.includes("desiredMatchesServerGrade") &&
    gradeEntryOfflineOutbox.includes("confirmGradeEntryOfflineAttempt") &&
    gradeEntryOfflineOutbox.includes("flushGradeEntryOfflineSaves"),
  "طابور الدرجات المؤجل يصالح الرد المفقود ويمنع الكتابة فوق تعديل أحدث",
  "المزامنة المؤجلة يجب أن تتحقق من الخادم قبل الإرسال وتحفظ التعارض للمراجعة.",
);

must(
  teacherLayout.includes("flushGradeEntryOfflineSaves") &&
    teacherLayout.includes('window.addEventListener("online", flushOfflineGrades)') &&
    teacherLayout.includes('window.addEventListener("focus", flushOfflineGrades)'),
  "المزامنة المؤجلة تعمل على مستوى التطبيق عند رجوع الإنترنت أو العودة للتبويب",
  "يجب ألا تعتمد مزامنة الدرجات المؤجلة على بقاء صفحة تسجيل الدرجات مفتوحة فقط.",
);

must(
  gradeEntry.includes("return entrySheetGrades.filter") &&
    gradeEntry.includes("confirmedGradesRef") &&
    !teacherStore.includes("function mergePendingGradeSavesIntoGrades") &&
    teacherStore.includes("discardLegacyPendingGradeSaves();"),
  "ورقة الإدخال تجعل نتيجة DB مرجع الدرجات ولا تعرض كاشاً وهمياً",
  "يجب ألا تُدمج درجات محلية قديمة فوق ورقة الإدخال القادمة من DB.",
);

must(
  gradesRoute.includes("expectedUpdatedAt") &&
    gradesRoute.includes("وجود id يعني أن الطلب يستهدف هذا السجل حصراً") &&
    api.includes("expectedUpdatedAt?: string") &&
    api.includes("{ studentId, examId, expectedUpdatedAt }"),
  "حذف الدرجة محمي بنسخة السجل ولا يسقط إلى حذف درجة أحدث بالطالب والامتحان",
  "يجب حماية الحذف بـupdatedAt ومنع fallback الخطر عند وجود id.",
);

must(
  gradesRoute.includes(
    "allowDismissedExistingGradeCorrection: Boolean(existingGrade)",
  ),
  "تصحيح درجة موجودة لطالب مفصول مسموح دون السماح بإنشاء درجة جديدة له",
  "يجب أن يطابق الخادم سماح الواجهة بتصحيح الدرجة التي سببت الفصل.",
);

must(
  correctionSheetsRoute.includes('const deleteGrade = deleteGradeRaw === "true"') &&
    telegramSubmissionsRoute.includes('const deleteGrade = deleteGradeRaw === "true"'),
  "حذف ورقة التصحيح أو مستلم تيليجرام لا يحذف درجة الطالب افتراضياً",
  "يجب ألا تمسح المسارات المساندة درجة عُدلت يدوياً دون طلب صريح.",
);

must(
  gradeEntry.includes("gradeApi.markMissingAbsent") &&
    gradeEntry.includes("mark-missing-absent") &&
    gradeEntry.includes("تم تسجيل") &&
    !gradeEntry.includes("ستتم المزامنة تلقائياً") &&
    markMissingAbsentRoute.includes("existingGrade") &&
    markMissingAbsentRoute.includes("skippedStudentIds") &&
    markMissingAbsentRoute.includes("syncAcademicGradeWriteback") &&
    markMissingAbsentRoute.includes("deferAcademicRecalculation: true") &&
    markMissingAbsentRoute.includes("recalculateStudentsAcademicState(createdStudentIds, { tx })") &&
    !markMissingAbsentRoute.includes("BULK_WRITE_CONCURRENCY") &&
    gradeEntry.includes("markingAllMissingAbsent") &&
    gradeEntry.includes("جارٍ تسجيل الحالات") &&
    gradeEntry.includes("missingExamStudentsBeforeProtection") &&
    gradeEntry.includes("graceProtectedMissingStudents") &&
    gradeEntry.includes("preRegistrationMissingStudents") &&
    markMissingAbsentRoute.includes('? "قبل تسجيل الطالب"') &&
    markMissingAbsentRoute.includes('createdBeforeRegistration') &&
    markMissingAbsentRoute.includes("createdGrace") &&
    gradeEntry.includes("firstFailureReason"),
  "التسجيل الجماعي يسجل الغياب أو السماح من حالة قاعدة البيانات الحالية ويتجاوز الموجود",
  "يجب أن يسجل الخادم الغائب والسماح وما قبل التسجيل حسب تاريخ الامتحان دون تعارض 409.",
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
  gradeEntry.includes('import { isStudentCurrentlyInGrace } from "@/lib/student-grace"') &&
    gradeEntry.includes("isStudentCurrentlyInGrace(student)") &&
    gradeEntry.includes('data-grace-direct-entry=') &&
    gradeEntry.includes("const studentInGrace") &&
    gradeEntry.includes("وتبدأ المحاسبة من نفس") &&
    gradeEntry.includes("تم حفظ الدرجة وإنهاء فترة السماح") &&
    gradeEntry.includes("payload.graceEnded") &&
    !gradeEntry.includes("const canCaptureGraceScoreDirectly") &&
    !gradeEntry.includes("graceNumericCapture"),
  "طالب السماح يدخل درجة رسمية تنهي السماح وتبدأ المحاسبة فوراً",
  "يجب أن يبقى الحقل مفتوحاً وأن يوضح أن الدرجة نفسها ستُنهي السماح وتُحتسب.",
);

must(
  gradeEntry.includes('["مجاز", "ضمن فترة السماح", "قبل تسجيل الطالب"]') &&
    gradeEntry.includes('graceSmartNote?.category === "GRACE_SCORED"') &&
    gradeEntry.includes('graceSmartNote.status === "PENDING"') &&
    gradeEntry.includes("String(pendingGraceScore)"),
  "واجهة السماح تستعيد الدرجة المعلّقة في الحقل الرقمي بعد إعادة التحميل",
  "يجب ألا يعود حقل درجة السماح فارغاً أو إلى حالة نصية بعد حفظ الدرجة المعلّقة.",
);

must(
  gradesRoute.includes("syncAcademicGradeWriteback") &&
    gradesRoute.includes("withSerializableTransaction") &&
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
    !profileDialog.includes('label: "التعهدات"') &&
    profileDialog.includes('label: "السجل الزمني"'),
  "ملف الطالب يملك مسارات واضحة للدرجات والغيابات والفرص والمكالمات والإجازات والسجل الزمني",
  "ملف الطالب يجب أن يحتوي تبويبات/كروت صريحة لكل مسار منطقي للطالب.",
);

must(
    profileDialog.includes('tab === "followup"') &&
    profileDialog.includes("مكالمات الطالب") &&
    profileDialog.includes("إجازات الطالب") &&
    !profileDialog.includes("تعهدات ولي الأمر") &&
    profileDialog.includes("ملاحظات الطالب"),
  "ملف الطالب يعرض المكالمات والإجازات والملاحظات دون الميزة القديمة",
  "يجب أن تكون المكالمات والإجازات والملاحظات ظاهرة داخل ملف الطالب دون قسم متقاعد.",
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
    !profileStatsRoute.includes("pledgesCount") &&
    profileStatsRoute.includes("timeline: activityStats.timeline") &&
    profileStatsRoute.includes("deductions"),
  "إحصائيات ملف الطالب تشمل المكالمات والإجازات والخصومات والسجل الزمني دون الإحصاء المتقاعد",
  "كروت ملف الطالب يجب أن تأتي من إحصائيات DB لكل مسار مهم.",
);

must(
  String(pkg.scripts?.["test:grade-entry-integrity"] || "").includes(
    "node scripts/test-grade-entry-integrity.mjs",
  ) &&
    String(pkg.scripts?.["test:grade-entry-integrity"] || "").includes(
      "scripts/test-grade-entry-stats-behavior.mjs",
    ),
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
