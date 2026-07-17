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
const candidates = read("src/app/api/student-calls/candidates/route.ts");
const stats = read("src/app/api/student-calls/stats/route.ts");
const leaves = read("src/app/api/student-leaves/route.ts");
const repair = read("scripts/repair-grace-period-data.ts");
const repairHelper = read("src/lib/grace-period-repair-server.ts");
const academicRepair = read("src/app/api/students/academic-repair/route.ts");
const schemaGuard = read("src/lib/academic-schema.ts");

check(
  "المصدر الموحد يطبق 3 أيام تلقائية ويجعل السماح اليدوي بديلاً عنها",
  grace.includes("AUTOMATIC_NEW_STUDENT_GRACE_DAYS = 3") &&
    grace.includes('source: "manual"') &&
    grace.includes('source: "automatic"'),
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
  "التسجيل والتعديل يدعمان اختيار تاريخ التسجيل أو اليوم",
  students.includes("normalizeGracePeriodStartMode") &&
    students.includes("resolveManualGraceStartDate") &&
    register.includes("gracePeriodStartMode") &&
    registry.includes("gracePeriodStartMode"),
);
check(
  "التعديل العادي لا يعيد بدء السماح دون تغيير الأيام أو اختيار صريح",
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
  "إصلاح الإنتاج يحذف الغياب والمكالمات المتضررة ثم يعيد الاحتساب داخل transaction",
  repairHelper.includes('status: "غائب"') &&
    repairHelper.includes("studentCall.deleteMany") &&
    repairHelper.includes("grade.deleteMany") &&
    repair.includes("recalculateStudentsAcademicState") &&
    repair.includes("withSerializableTransaction"),
);
check(
  "الإصلاح الإداري الشامل يحذف الغياب المحمي قبل إعادة الاحتساب",
  academicRepair.includes("removeProtectedAbsencesForStudents") &&
    academicRepair.includes('where: { status: "غائب" }') &&
    academicRepair.includes("deletedGrades") &&
    academicRepair.includes("deletedCalls"),
);
check(
  "حارس قاعدة البيانات يضيف عمود بدء السماح عند الحاجة",
  schemaGuard.includes('ADD COLUMN IF NOT EXISTS "gracePeriodStartDate"'),
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
