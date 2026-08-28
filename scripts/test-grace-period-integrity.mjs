import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (label, condition) => checks.push({ label, ok: Boolean(condition) });

const grace = read("src/lib/student-grace.ts");
const engine = read("src/lib/academic-engine.ts");
const classification = read("src/lib/grade-classification.ts");
const writeback = read("src/lib/academic-grade-writeback-server.ts");
const students = read("src/app/api/students/route.ts");
const updateImpact = read("src/app/api/students/update-impact/route.ts");
const register = read("src/components/teacher-pro/student-register.tsx");
const registry = read("src/components/teacher-pro/student-registry.tsx");
const registryHelpers = read("src/components/teacher-pro/student-registry-helpers.ts");
const registryResults = read("src/components/teacher-pro/student-registry-results.tsx");
const studentProfile = read("src/components/teacher-pro/student-profile-dialog.tsx");
const candidates = read("src/app/api/student-calls/candidates/route.ts");
const stats = read("src/app/api/student-calls/stats/route.ts");
const leaves = read("src/app/api/student-leaves/route.ts");
const repair = read("scripts/repair-grace-period-data.ts");
const repairHelper = read("src/lib/grace-period-repair-server.ts");
const academicRepair = read("src/app/api/students/academic-repair/route.ts");
const schemaReadiness = read("src/lib/schema-readiness.ts");
const schema = read("prisma/schema.prisma");
const gradesRoute = read("src/app/api/grades/route.ts");
const gradeEntry = read("src/components/teacher-pro/grade-entry.tsx");
const graceActivation = read("src/lib/grace-grade-activation.ts");
const dashboardStats = read("src/app/api/stats/route.ts");

check(
  "المصدر الموحد يطبق 3 أيام تلقائية ويجعل السماح اليدوي بديلاً عنها",
  grace.includes("AUTOMATIC_NEW_STUDENT_GRACE_DAYS = 3") &&
    grace.includes('source: "manual"') &&
    grace.includes('source: "automatic"'),
);
check(
  "المصدر الموحد يحسب الأيام المتبقية من تاريخ بغداد ويصفرها عند الانتهاء",
  grace.includes("getStudentGraceStatus") &&
    grace.includes("getStudentGraceDaysRemaining") &&
    grace.includes('state: "active"') &&
    grace.includes('state: "expired"') &&
    grace.includes("window.endExclusive.getTime() - today.getTime()"),
);
check(
  "المحرك والتصنيف يعتمدان المصدر الموحد للسماح",
  engine.includes('from "./student-grace"') &&
    classification.includes('from "@/lib/student-grace"'),
);
check(
  "حفظ الغياب محمي بالسماح اليدوي/التلقائي",
  writeback.includes("isExamWithinStudentGraceWindow") &&
    writeback.includes('status === "غائب"'),
);
check(
  "الدرجة الرقمية تنهي السماح ذرياً وتُحتسب من نفس العملية",
  schema.includes("gracePeriodEndedAt DateTime?") &&
    grace.includes("if (student.gracePeriodEndedAt) return null") &&
    writeback.includes("const shouldEndGrace") &&
    writeback.includes('status === "درجة"') &&
    writeback.includes("score !== null") &&
    writeback.includes("shouldEndGraceForNumericGrade") &&
    graceActivation.includes("isStudentCurrentlyInGrace(input.student, input.now)") &&
    writeback.includes("accountingGraceDays: 0") &&
    writeback.includes("gracePeriodEndedAt: endedAt") &&
    writeback.includes("recalculateStudentsAcademicState") &&
    gradesRoute.includes("reaches the shared writeback") &&
    !gradesRoute.slice(
      gradesRoute.indexOf("async function inspectNumericGradeAttempt"),
      gradesRoute.indexOf("function dateKey"),
    ).includes('category = "GRACE_SCORED"'),
);
check(
  "واجهة الدرجات تشرح إنهاء السماح ولا تعرض الدرجة الجديدة كمعلقة",
  gradeEntry.includes("وتبدأ المحاسبة من نفس") &&
    gradeEntry.includes("تم حفظ الدرجة وإنهاء فترة السماح") &&
    !gradeEntry.includes("const canCaptureGraceScoreDirectly"),
);
check(
  "إحصائيات لوحة التحكم تحترم إنهاء السماح ولا تعيد حمايته بصيغة SQL قديمة",
  dashboardStats.includes('student."gracePeriodEndedAt" IS NOT NULL') &&
    dashboardStats.includes("OR NOT ("),
);
check(
  "التسجيل والتعديل يدعمان اختيار تاريخ التسجيل أو اليوم",
  students.includes("normalizeGracePeriodStartMode") &&
    students.includes("resolveManualGraceStartDate") &&
    register.includes("gracePeriodStartMode") &&
    registry.includes("gracePeriodStartMode"),
);
check(
  "التعديل العادي لا يعيد بدء السماح دون تغيير الأيام أو اختيار صريح",
  students.includes("graceDaysChanged || gracePeriodStartMode") &&
    updateImpact.includes("graceDaysChanged || gracePeriodStartMode") &&
    !students.includes("data.gracePeriodStartDate = new Date()"),
);
check(
  "سجل الطالب يعرض السماح المتبقي لا مدة المنح الأصلية الثابتة",
  registryHelpers.includes('label: "السماح المتبقي"') &&
    registryHelpers.includes("formatStudentGraceRemaining(student)") &&
    registryResults.includes('label="السماح المتبقي"') &&
    !registryResults.includes("student.accountingGraceDays ?? 0") &&
    studentProfile.includes("getStudentGraceDaysRemaining(profileStudent)") &&
    studentProfile.includes("السماح المتبقي: 0 يوم"),
);
check(
  "تجديد السماح بنفس عدد الأيام يبدأ نافذة جديدة ويخضع لمعاينة الأثر",
  registry.includes("editGraceInputTouched") &&
    registry.includes("editGraceRenewalRequested") &&
    registry.includes("editGraceSettingsChanged") &&
    registry.includes("editRegistrationDateChanged || editGraceSettingsChanged") &&
    registry.includes('setGracePeriodStartMode("now")') &&
    registry.includes("تجديد المدة المكتوبة من اليوم") &&
    students.includes("graceDaysChanged || gracePeriodStartMode") &&
    updateImpact.includes("graceDaysChanged || gracePeriodStartMode"),
);
check(
  "قوائم المكالمات تجلب تاريخ بدء السماح وتستبعد المحمي",
  candidates.includes("gracePeriodStartDate: true") &&
    stats.includes("gracePeriodStartDate: true") &&
    candidates.includes("NON_DISPLAY_CALL_KINDS.has(kind)") &&
    !candidates.includes("غائب بدون خصم: فترة سماح"),
);
check(
  "حذف الإجازة لا يعيد غياباً محمياً أو سابقاً للتسجيل",
  leaves.includes("isExamWithinStudentGraceWindow") &&
    leaves.includes("isExamOnOrAfterStudentRegistration") &&
    leaves.includes('backup.status === "غائب"'),
);
check(
  "إصلاح الإنتاج يحول الغيابات المحمية ويحافظ على الدرجات الرقمية السابقة للتسجيل",
  repairHelper.includes('grade.status === "غائب"') &&
    repairHelper.includes('grade.status === "غائب" &&') &&
    !repairHelper.includes('(!options.onlyAbsences || grade.status === "غائب")') &&
    repairHelper.includes("studentCall.deleteMany") &&
    repairHelper.includes('status: "ضمن فترة السماح"') &&
    repairHelper.includes('status: "قبل تسجيل الطالب"') &&
    repairHelper.includes("grade.updateMany") &&
    repair.includes("recalculateStudentsAcademicState") &&
    repair.includes("withSerializableTransaction"),
);
check(
  "الإصلاح الإداري الشامل ينشئ الحالات المحمية ويصحح السجلات ويعيد كل الأثر الأكاديمي",
  academicRepair.includes("repairProtectedAbsencesForStudents") &&
    academicRepair.includes("ensureProtectedGradeMarkers") &&
    academicRepair.includes('scope === "dismissed"') &&
    academicRepair.includes("restoredStudents") &&
    academicRepair.includes('scope === "protected"') &&
    academicRepair.includes('where: { status: { not: "مؤرشف" } }') &&
    academicRepair.includes("deletedGrades") &&
    academicRepair.includes("convertedGrades") &&
    academicRepair.includes("convertedBeforeRegistration") &&
    academicRepair.includes('scope === "grace"') &&
    academicRepair.includes("deletedCalls"),
);
check(
  "حارس قاعدة البيانات لا يغير المخطط ويتطلب migration المصالحة",
  schemaReadiness.includes("20260828034500_single_dismissal_policy") &&
    schemaReadiness.includes('FROM "_prisma_migrations"') &&
    !schemaReadiness.includes("$executeRaw"),
);

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`✅ ${item.label}`);
  else {
    failed += 1;
    console.error(`❌ ${item.label}`);
  }
}
if (failed) process.exit(1);
console.log("\nكل اختبارات سلامة فترة السماح نجحت.");
