import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const assert = (condition, message) => {
  if (!condition) {
    console.error(`✖ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${message}`);
  }
};

const registerView = read("src/components/teacher-pro/student-register.tsx");
const studentsRoute = read("src/app/api/students/route.ts");
const api = read("src/lib/api.ts");
const contextPath = "src/app/api/students/register-context/route.ts";
const contextRoute = existsSync(join(root, contextPath))
  ? read(contextPath)
  : "";
const codeSequence = read("src/lib/student-code-sequence.ts");
const migration = read(
  "prisma/migrations/20260712190000_atomic_student_codes_and_active_chapter_guard/migration.sql",
);
const packageJson = JSON.parse(read("package.json"));
const serializableTransaction = read("src/lib/serializable-transaction.ts");

assert(
  registerView.includes("studentRegisterApi.context()"),
  "صفحة تسجيل الطالب تحمل سياق التسجيل من API قاعدة البيانات",
);
assert(
  registerView.includes("studentApi.add({"),
  "صفحة تسجيل الطالب تحفظ الطالب Server-first عبر studentApi.add",
);
assert(
  !/const\s*\{[^}]*\baddStudent\b[^}]*\}\s*=\s*useTeacherStore/s.test(
    registerView,
  ),
  "صفحة تسجيل الطالب لا تستخدم addStudent المحلي المتفائل",
);
assert(
  !registerView.includes("activeChapterForCourse"),
  "صفحة تسجيل الطالب لا تعتمد على activeChapterForCourse من الكاش المحلي",
);
const addCall = registerView.slice(
  registerView.indexOf("studentApi.add({"),
  registerView.indexOf("});", registerView.indexOf("studentApi.add({")) + 3,
);
assert(
  !/\bopportunities\s*:/.test(addCall) &&
    !/\bbaseOpportunities\s*:/.test(addCall),
  "العميل لا يرسل opportunities/baseOpportunities عند التسجيل",
);
assert(
  registerView.includes("selectedCourseHasChapterConflict") &&
    registerView.includes("selectedCourseCannotRegister"),
  "الواجهة تمنع التسجيل عند وجود تعارض فصل نشط",
);
assert(existsSync(join(root, contextPath)), "يوجد API خاص بسياق تسجيل الطالب");
assert(
  contextRoute.includes('requirePermission(req, "students.add")'),
  "API سياق التسجيل محمي بصلاحية students.add",
);
assert(
  contextRoute.includes('source: "database"') &&
    contextRoute.includes("activeChapterCount"),
  "API سياق التسجيل يرجع مصدر قاعدة البيانات وعدد الفصول النشطة",
);
assert(
  api.includes("studentRegisterApi") &&
    api.includes("StudentRegisterContextResponse"),
  "طبقة API تحتوي أنواع ودالة سياق التسجيل",
);
assert(
  /requirePermissionPrincipal\(\s*req,\s*"students\.add"/s.test(studentsRoute),
  "حفظ الطالب يستخدم principal من السيرفر لتسجيل audit log",
);
assert(
  studentsRoute.includes("withSerializableTransaction") &&
    studentsRoute.includes("transactionCourse") &&
    studentsRoute.includes("transactionChoiceValidation") &&
    serializableTransaction.includes("TransactionIsolationLevel.Serializable"),
  "التسجيل يعيد قراءة الدورة والفصل داخل transaction ذرية عند تغيّر الإعدادات بالتزامن",
);
assert(
  studentsRoute.includes("allocateStudentCodes(tx, 1)") &&
    studentsRoute.includes("retryStudentCodeConflict") &&
    !studentsRoute.includes("code: body.code"),
  "السيرفر يولّد كود الطالب من Sequence ذرية ويعيد المحاولة عند تعارض legacy",
);
assert(
  codeSequence.includes(`nextval('"Student_code_seq"')`) &&
    codeSequence.includes("isStudentCodeUniqueConflict") &&
    codeSequence.includes("maxAttempts = 5") &&
    migration.includes('CREATE SEQUENCE IF NOT EXISTS "Student_code_seq"'),
  "Sequence كود الطالب مهيأة بترحيل قاعدة البيانات مع retry تلقائي",
);
assert(
  studentsRoute.includes("course.active === false"),
  "السيرفر يرفض التسجيل في دورة موقوفة عن التسجيل",
);
assert(
  studentsRoute.includes("activeCourseChapters.length > 1"),
  "السيرفر يرفض التسجيل عند وجود أكثر من فصل نشط للدورة",
);
assert(
  /getInitialOpportunities\(\s*transactionCourse,\s*tx,/s.test(studentsRoute) &&
    studentsRoute.includes(
      "opportunities: initialOpportunitiesResult.opportunities",
    ) &&
    studentsRoute.includes(
      "baseOpportunities: initialOpportunitiesResult.baseOpportunities",
    ),
  "السيرفر يعيد قراءة الفصل النشط داخل نفس transaction ويحسب فرص البداية منه",
);
assert(
  studentsRoute.includes(
    "await tx.opportunityLog.deleteMany({ where: { studentId: id } })",
  ) &&
    studentsRoute.includes("const student = await tx.student.update") &&
    !studentsRoute.includes(
      "await db.opportunityLog.deleteMany({ where: { studentId: id } })",
    ),
  "نقل الطالب كطالب جديد يحذف سجل الفرص ويحدّث الطالب داخل transaction واحدة",
);
assert(
  packageJson.scripts?.["test:student-register-integrity"] ===
    "node scripts/test-student-register-integrity.mjs",
  "package.json يحتوي سكربت test:student-register-integrity",
);

if (process.exitCode) {
  console.error("\nStudent register integrity checks failed.");
  process.exit(process.exitCode);
}

console.log("\nStudent register integrity checks passed.");
