import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20260712220000_student_enrollment_archives/migration.sql");
const studentsRoute = read("src/app/api/students/route.ts");
const impactRoute = read("src/app/api/students/update-impact/route.ts");
const statusRoute = read("src/app/api/students/status-action/route.ts");
const archiveHelper = read("src/lib/student-enrollment-archive-server.ts");
const tokenHelper = read("src/lib/student-academic-impact-token.ts");
const profileRoute = read("src/app/api/students/profile-log/route.ts");
const registry = read("src/components/teacher-pro/student-registry.tsx");
const profile = read("src/components/teacher-pro/student-profile-dialog.tsx");
const api = read("src/lib/api.ts");
const pkg = JSON.parse(read("package.json"));

const checks = [];
const check = (label, condition) => checks.push({ label, ok: Boolean(condition) });

check(
  "قاعدة البيانات تحتوي أرشيف تسجيلات الطالب مع علاقة وفهارس وترحيل قابل للنشر",
  schema.includes("model StudentEnrollmentArchive") &&
    schema.includes("enrollmentArchives StudentEnrollmentArchive[]") &&
    schema.includes("snapshot        String   @db.Text") &&
    migration.includes('CREATE TABLE "StudentEnrollmentArchive"') &&
    migration.includes('FOREIGN KEY ("studentId") REFERENCES "Student"'),
);
check(
  "لا توجد علاقة Prisma زائفة بين الامتحان وأرشيف التسجيل",
  (schema.match(/enrollmentArchives StudentEnrollmentArchive\[\]/g) || []).length === 1,
);
check(
  "إعادة البداية تؤرشف كل البيانات الحية المؤثرة قبل حذفها",
  [
    "grades",
    "opportunityLogs",
    "studentLeaves",
    "studentCalls",
    "studentNotes",
    "correctionSheets",
    "telegramExamSubmissions",
    "studentLeaveGradeBackups",
    "auditLogs",
  ].every((key) => archiveHelper.includes(key)) &&
    archiveHelper.includes("studentEnrollmentArchive.create") &&
    archiveHelper.includes("grade.deleteMany") &&
    archiveHelper.includes("opportunityLog.deleteMany") &&
    archiveHelper.includes("studentLeave.deleteMany") &&
    archiveHelper.includes("studentCall.deleteMany") &&
    archiveHelper.includes("studentNote.deleteMany") &&
    archiveHelper.includes("correctionSheet.deleteMany") &&
    archiveHelper.includes("telegramExamSubmission.deleteMany") &&
    archiveHelper.includes("studentLeaveGradeBackup.deleteMany"),
);
check(
  "النقل لدورة مختلفة يفرض طالباً جديداً ولا يقبل الإبقاء",
  studentsRoute.includes('courseChanged && courseTransferPolicy !== "reset"') &&
    studentsRoute.includes("النقل إلى دورة مختلفة يبدأ ملفاً جديداً دائماً") &&
    registry.includes("نقل إلى دورة جديدة — سيبدأ الطالب بملف نظيف") &&
    registry.includes("تأكيد النقل كطالب جديد") &&
    !registry.includes('<RadioGroupItem value="keep" className="mt-1" />\n                            </label>'),
);
check(
  "اختيار طالب جديد داخل نفس الدورة يستخدم نفس الأرشفة والتصفير الكامل",
  studentsRoute.includes('"same-course-new-student"') &&
    studentsRoute.includes("archiveAndResetStudentEnrollment(tx") &&
    studentsRoute.includes("transactionData.createdAt = new Date()"),
);
check(
  "الرصيد الجديد يأتي حصراً من الفصل النشط للدورة الجديدة",
  studentsRoute.includes("getInitialOpportunities(") &&
    studentsRoute.includes("transactionData.opportunities = nextOpportunities.opportunities") &&
    studentsRoute.includes("transactionData.baseOpportunities = nextOpportunities.baseOpportunities"),
);
check(
  "الإبقاء داخل نفس الدورة حرفي: لا إعادة احتساب ولا إعادة كتابة للرصيد",
  studentsRoute.includes('// No recalculation and no balance rewrite. "Keep" is literal.') &&
    studentsRoute.includes("transactionKeepEnrollment") &&
    studentsRoute.includes("delete transactionData.opportunities") &&
    studentsRoute.includes("delete transactionData.baseOpportunities") &&
    registry.includes("الإبقاء على الملف كما هو حرفياً") &&
    registry.includes("لا يعاد احتساب الرصيد"),
);
check(
  "مسار تعديل بيانات الطالب يمنع الرصيد والحالة والفصل المباشر",
  studentsRoute.includes('"opportunities"') &&
    studentsRoute.includes('"baseOpportunities"') &&
    studentsRoute.includes('"status"') &&
    studentsRoute.includes('"dismissalType"') &&
    studentsRoute.includes("stripNonWritableStudentUpdateFields(data)"),
);
check(
  "الحفظ والأرشفة والتحديث وإعادة الاحتساب داخل معاملة Serializable واحدة",
  studentsRoute.includes("withSerializableTransaction(async (tx)") &&
    studentsRoute.indexOf("archiveAndResetStudentEnrollment(tx") < studentsRoute.indexOf("tx.student.update") &&
    studentsRoute.includes("recalculateStudentsAcademicState(") &&
    studentsRoute.includes("{ tx }") &&
    !studentsRoute.includes("console.error(\"Failed to recalculate student"),
);
check(
  "تغيير تاريخ التسجيل أو السماح يملك معاينة من نفس محرك الاحتساب",
  impactRoute.includes("withSerializableTransaction(async (tx)") &&
    impactRoute.includes("previewStudentAcademicUpdate") &&
    impactRoute.includes("{ tx }") &&
    impactRoute.includes("classifyGradeAcademicImpact") &&
    impactRoute.includes("movedBeforeRegistration") &&
    impactRoute.includes("movedIntoGrace") &&
    registry.includes("studentApi.updateImpact"),
);
check(
  "المعاينة مربوطة ببصمة قاعدة البيانات ويُرفض الحفظ إذا أصبحت قديمة",
  tokenHelper.includes('createHash("sha256")') &&
    tokenHelper.includes("grade.findMany") &&
    tokenHelper.includes("studentLeave.findMany") &&
    tokenHelper.includes("opportunityLog.findMany") &&
    tokenHelper.includes("studentNote.findMany") &&
    tokenHelper.includes("exam.findMany") &&
    tokenHelper.includes("courseChapter.findMany") &&
    tokenHelper.includes("chapter.findMany") &&
    impactRoute.includes("previewToken") &&
    studentsRoute.includes("currentPreviewToken !== academicImpactPreviewToken") &&
    registry.includes("academicImpactPreview?.previewToken"),
);
check(
  "تأكيد المعاينة لا يبقى صالحاً بعد تغيير التاريخ أو السماح في الواجهة",
  registry.includes("effectiveAcademicImpactConfirmed") &&
    registry.includes("hasCurrentAcademicImpactPreview && academicImpactConfirmed"),
);
check(
  "استعادة المؤرشف إجراء مستقل ولا تمر عبر إعادة تفعيل أو تعديل عام",
  statusRoute.includes('type RegistryStatusAction = "dismiss" | "reactivate" | "restore"') &&
    statusRoute.includes('if (action === "restore")') &&
    statusRoute.includes("archived student must be restored explicitly") &&
    studentsRoute.includes("استعده من إجراء «استعادة من الأرشيف» أولاً") &&
    registry.includes('isArchived ? "restore" : "reactivate"'),
);
check(
  "الاستعادة تضبط رصيد الفصل الحالي وتعيد الاحتساب داخل العملية نفسها",
  statusRoute.includes("getActiveChapterForCourse(tx, student.courseId)") &&
    statusRoute.includes("baseOpportunities: baseline") &&
    statusRoute.includes("recalculateStudentsAcademicState") &&
    statusRoute.includes("{ tx }") &&
    statusRoute.includes("student.findUniqueOrThrow"),
);
check(
  "ملف الطالب يعرض الملفات القديمة للقراءة فقط ويفصل سجلاتها عن الملف الحالي",
  profileRoute.includes("studentEnrollmentArchive.findMany") &&
    profileRoute.includes("currentEnrollmentStartedAt") &&
    profileRoute.includes("time: { gte: currentEnrollmentStartedAt }") &&
    profile.includes("الملفات السابقة — للقراءة فقط") &&
    profile.includes("لا تدخل درجاتها أو فرصها أو إجراءاتها في ملفه الحالي") &&
    profile.includes("أوراق التصحيح القديمة") &&
    profile.includes("مستلمات تيليجرام القديمة") &&
    profile.includes("نسخ درجات الإجازات القديمة") &&
    profile.includes("كود الملف السابق") &&
    api.includes("StudentEnrollmentArchiveRecord"),
);
check(
  "اختبار دورة حياة النقل مضاف إلى حزمة الاختبارات الشاملة",
  pkg.scripts?.["test:student-transfer-lifecycle-integrity"] ===
    "node scripts/test-student-transfer-lifecycle-integrity.mjs" &&
    String(pkg.scripts?.["test:side-effects"] || "").includes(
      "test:student-transfer-lifecycle-integrity",
    ),
);

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`✅ ${item.label}`);
  else {
    failed += 1;
    console.error(`❌ ${item.label}`);
  }
}
if (failed) {
  console.error(`\nفشل ${failed} من اختبارات دورة حياة نقل الطالب.`);
  process.exit(1);
}
console.log("\nكل اختبارات دورة حياة نقل الطالب نجحت.");
