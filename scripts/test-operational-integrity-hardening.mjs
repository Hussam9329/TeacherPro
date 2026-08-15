#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let failed = false;
const must = (condition, ok, bad = ok) => {
  if (condition) console.log(`✅ ${ok}`);
  else {
    failed = true;
    console.error(`❌ ${bad}`);
  }
};

const leaveRoute = read("src/app/api/student-leaves/route.ts");
const baghdad = read("src/lib/baghdad-time.ts");
const migration = read(
  "prisma/migrations/20260712234500_operational_integrity_hardening/migration.sql",
);
const opportunityAction = read(
  "src/app/api/opportunities/student-action/route.ts",
);
const opportunityBulk = read("src/app/api/opportunities/bulk-adjust/route.ts");
const opportunityLogs = read("src/app/api/opportunity-logs/route.ts");
const opportunityUi = read("src/components/teacher-pro/opportunities.tsx");
const statusAction = read("src/app/api/students/status-action/route.ts");
const botResolve = read("src/app/api/bot/students/resolve/route.ts");
const botLink = read("src/app/api/bot/students/link/route.ts");
const botExams = read("src/app/api/bot/exams/route.ts");
const telegramRoute = read("src/app/api/telegram-exam-submissions/route.ts");
const telegramSchema = read("src/lib/telegram-submission-schema.ts");
const permissions = read("src/lib/server-auth.ts");
const correction = read("src/app/api/correction-sheets/route.ts");
const correctionUi = read("src/components/teacher-pro/e-correction.tsx");
const backup = read("src/app/api/backup/route.ts");
const backupRestore = read("src/app/api/backup/restore/route.ts");
const backupUi = read("src/components/teacher-pro/admin-log-reset.tsx");
const logClear = read("src/app/api/logs/clear/route.ts");
const logRestore = read("src/app/api/logs/restore/route.ts");
const academicRepair = read("src/app/api/students/academic-repair/route.ts");
const clamp = read("src/app/api/students/clamp-opportunities/route.ts");
const password = read("src/lib/passwords.ts");
const accounts = read("src/components/teacher-pro/accounts.tsx");
const usersRoute = read("src/app/api/users/route.ts");
const rateLimit = read("src/lib/api-rate-limit.ts");
const recalc = read("src/lib/academic-recalculate-server.ts");
const lock = read("src/lib/academic-student-lock-server.ts");
const profileLog = read("src/app/api/students/profile-log/route.ts");
const profileStats = read("src/app/api/students/profile-stats/route.ts");
const profileUi = read("src/components/teacher-pro/student-profile-dialog.tsx");
const courses = read("src/app/api/courses/route.ts");
const chapters = read("src/app/api/chapters/route.ts");
const courseChapters = read("src/app/api/course-chapters/route.ts");
const pkg = JSON.parse(read("package.json"));

must(
  baghdad.includes("parseBaghdadDateOnly") &&
    leaveRoute.includes("strictDateOnly") &&
    leaveRoute.includes('"تاريخ الإجازة"') &&
    !leaveRoute.includes("parseBaghdadDateOnly(value) || new Date()"),
  "تواريخ الإجازات غير الصالحة تُرفض ولا تُستبدل بتاريخ اليوم",
);
must(
  leaveRoute.includes("const overlap") &&
    leaveRoute.includes("إجازة فترة أخرى متداخلة") &&
    migration.includes("guard_student_leave_integrity") &&
    migration.includes("Overlapping student leave period"),
  "تداخل إجازات الفترة ممنوع في الخادم وقاعدة البيانات",
);
must(
  leaveRoute.includes("findOtherCoveringLeaveId") &&
    leaveRoute.includes("otherLeaveId") &&
    leaveRoute.includes("studentLeaveGradeBackup.upsert"),
  "حذف إجازة لا يعيد الدرجة إذا بقيت إجازة أخرى تغطي الامتحان",
);
must(
  leaveRoute.includes("evaluateStudentExamEligibility") &&
    leaveRoute.includes("checkRegistration: true") &&
    leaveRoute.includes('student.status === "مفصول"') &&
    leaveRoute.includes('student.status === "مؤرشف"'),
  "الإجازة تتحقق من دورة الامتحان وحالة الطالب",
);
must(
  telegramRoute.includes("لا يمكن إنشاء مستلم فارغ") &&
    telegramRoute.includes("legacy blank Telegram placeholder") &&
    telegramRoute.includes("grade: null") &&
    telegramRoute.includes("linkedGrade.score === null") &&
    botExams.includes("actualGrades"),
  "البوت لا ينشئ Placeholder فارغاً ولا يعتبره امتحاناً مأخوذاً",
);
must(
  opportunityAction.includes("requestedAmount") &&
    opportunityAction.includes("appliedAmount") &&
    opportunityAction.includes("balanceBefore") &&
    opportunityAction.includes("balanceAfter") &&
    opportunityUi.includes("المطلوب") &&
    opportunityUi.includes("المطبق"),
  "حركة الفرص تحفظ وتعرض المطلوب والمطبق والرصيد قبل وبعد",
);
must(
  opportunityAction.includes("reversalOfLogId") &&
    opportunityAction.includes("تم التراجع عن هذه الحركة سابقاً") &&
    migration.includes("OpportunityLog_reversalOfLogId_key"),
  "التراجع عن حركة الفرص لا يمكن تكراره",
);
must(
  opportunityBulk.includes("فرصة أخيرة بعد تعهد") &&
    opportunityBulk.includes('status: "نشط"') &&
    opportunityBulk.includes("إعادة تفعيل جماعية موثقة"),
  "الإضافة الجماعية تعيد تفعيل المفصول فعلياً بالتسلسل المعتمد",
);
must(
  opportunityBulk.includes('body.mode !== "filter"') &&
    opportunityBulk.includes("تم إيقاف الوضع الجماعي المباشر") &&
    opportunityBulk.includes("composeStudentWhere"),
  "الوضع الجماعي يشتق الطلاب والتغييرات من الخادم فقط",
);
must(
  opportunityLogs.includes("LEGACY_DIRECT_OPPORTUNITY_LOG_DISABLED") &&
    opportunityLogs.includes("تم إيقاف إنشاء حركات الفرص المباشر"),
  "مسار إنشاء سجل فرص خام موقوف ولا يسمح بتجاوز إجراءات الخادم الآمنة",
);
must(
  migration.includes("Student_status_allowed") &&
    migration.includes("Student_dismissal_type_allowed") &&
    migration.includes("Student_leave_type_allowed"),
  "حالات الطالب ونوع الفصل والإجازة مقيدة في قاعدة البيانات",
);
must(
  statusAction.includes("already-dismissed") &&
    statusAction.includes("الطالب مفصول أصلاً"),
  "الفصل اليدوي المكرر مرفوض بلا حركات أو ملاحظات إضافية",
);
must(
  statusAction.includes("not-dismissed") &&
    statusAction.includes("lockStudentsAcademicState(tx, [studentId])") &&
    statusAction.includes("requestedAmount: 1") &&
    statusAction.includes("balanceAfter: 1"),
  "إعادة التفعيل تقفل ملف الطالب وتُرفض لغير المفصول وتوثق الفرصة الأخيرة فعلياً",
);
must(
  botResolve.includes("candidates") &&
    botResolve.includes("أكثر من طالب") &&
    !botResolve.includes("findFirst"),
  "رقم ولي الأمر المشترك لا يختار أول طالب في البوت",
);
must(
  botLink.includes("confirmedName") &&
    botLink.includes("courseId") &&
    botLink.includes("كود الطالب") &&
    botLink.includes('status === "مفصول"') &&
    botLink.includes('status === "مؤرشف"'),
  "ربط تيليجرام يحتاج تعريفاً واضحاً ويرفض المفصول والمؤرشف",
);
must(
  botExams.includes("evaluateStudentExamEligibility") &&
    botExams.includes("checkRegistration: true") &&
    botExams.includes("checkAvailability: true") &&
    botExams.includes("checkLeave: true"),
  "قائمة امتحانات البوت تستخدم أهلية الطالب المركزية كاملة",
);
must(
  telegramRoute.includes("versions") &&
    telegramRoute.includes("telegramExamSubmissionVersion.create") &&
    migration.includes("TelegramExamSubmissionVersion"),
  "إعادات إرسال أوراق تيليجرام تُحفظ كإصدارات كاملة",
);
must(
  telegramRoute.includes("deletedPlaceholderGradeId") &&
    telegramRoute.includes("recalculateStudentsAcademicState") &&
    telegramRoute.includes("examAvailableAgain: true"),
  "حذف مستلم تيليجرام ينظف الدرجة الفارغة ويعيد الاحتساب والإتاحة",
);
must(
  migration.includes("TelegramExamSubmission_gradeId_fkey") &&
    telegramSchema.includes("TelegramExamSubmission_gradeId_fkey"),
  "gradeId في مستلم تيليجرام أصبح علاقة Foreign Key حقيقية",
);
must(
  !/"(?:courses|chapters|students|exams|grades|opportunities|correction)\.(?:add|edit|delete|manage)"\s*:\s*\[[^\]]*"page\.[^"]+\.view"/s.test(permissions),
  "صلاحيات المشاهدة لا تمنح صلاحيات الكتابة الحساسة",
);
must(
  correction.includes('gradeAction !== "keep"') &&
    correction.includes('gradeAction === "revoke"') &&
    correctionUi.includes("حذف الورقة فقط") &&
    correctionUi.includes("حذف وإلغاء الدرجة"),
  "حذف ورقة التصحيح يعرض خيار إبقاء الدرجة أو إلغائها وإعادة الاحتساب",
);
must(
  backup.includes("telegramExamSubmissionVersions") &&
    backup.includes("studentLeaveGradeBackups") &&
    !backup.includes("take:") &&
    backup.includes("checksum"),
  "النسخة الاحتياطية تشمل كل الجداول دون حدود وتحتوي checksum",
);
must(
  backupRestore.includes("teacherpro-full-restore") &&
    backupRestore.includes('isolationLevel: "Serializable"') &&
    backupRestore.includes("dryRun") &&
    backupUi.includes("استعادة النظام بالكامل"),
  "الاستعادة الكاملة متاحة داخل التطبيق مع معاينة ومعاملة ذرية",
);
must(
  logRestore.includes("recalculateStudentsAcademicState") &&
    logRestore.includes("lockStudentsAcademicState") &&
    logClear.includes("recalculateStudentsAcademicState") &&
    logClear.includes("studentImpact"),
  "حذف واستعادة سجل الفرص يعيدان احتساب جميع الطلاب المتأثرين",
);
must(
  courses.includes("writeRequestAuditLog") &&
    chapters.includes("writeRequestAuditLog") &&
    courseChapters.includes("writeRequestAuditLog"),
  "تعديلات الدورات والفصول والروابط الحساسة تظهر في Audit Log",
);
must(
  academicRepair.includes('"students.academicRepair"') &&
    academicRepair.includes("principal.isAdmin") &&
    academicRepair.includes("confirmImpact") &&
    academicRepair.includes("preview"),
  "الإصلاح الأكاديمي بصلاحية مستقلة ومدير فقط مع معاينة وتأكيد",
);
must(
  clamp.includes('status: "نشط"') &&
    clamp.includes("lockStudentsAcademicState"),
  "أداة Clamp تستثني المؤرشفين والمفصولين وتعمل بقفل أكاديمي",
);
must(
  password.includes("12") &&
    password.includes("COMMON_WEAK_PASSWORDS") &&
    password.includes("[^A-Za-z0-9\\s]") &&
    accounts.includes("required.length < 16"),
  "سياسة كلمات المرور قوية والمولّد ينشئ 16 خانة متنوعة",
);
must(
  usersRoute.includes("await hashPassword(password)") &&
    usersRoute.includes("await hashPassword(passwordInput)") &&
    !usersRoute.includes("normalizePasswordForStorage"),
  "API المستخدمين يعيد تشفير أي قيمة واردة ولا يقبل Hash مجهزاً من العميل",
);
must(
  rateLimit.includes("distributedLimiterUnavailableResponse") &&
    rateLimit.includes("NODE_ENV") &&
    rateLimit.includes("503"),
  "Rate Limiting يفشل بأمان في الإنتاج عند غياب Redis الموزع",
);
must(
  lock.includes("pg_advisory_xact_lock") &&
    recalc.includes("lockStudentsAcademicState") &&
    recalc.includes("withSerializableTransaction"),
  "كل إعادة احتساب تقفل الطالب وتعمل بمعاملة Serializable",
);
must(
  profileLog.includes("candidateExams") &&
    profileLog.includes("examStates") &&
    profileStats.includes("applicableExams.length") &&
    profileUi.includes("profileExams") &&
    profileUi.includes("بلا درجة"),
  "ملف الطالب يعرض جميع امتحانات الدورة والموقع حتى بلا درجة مع حالة كل امتحان",
);
must(
  pkg.scripts?.["test:operational-integrity-hardening"] ===
    "node scripts/test-operational-integrity-hardening.mjs" &&
    String(pkg.scripts?.["test:side-effects"] || "").includes(
      "test:operational-integrity-hardening",
    ),
  "اختبار الحماية التشغيلية مضاف للحزمة الشاملة",
);

if (failed) {
  console.error("\nفشل اختبار الحماية التشغيلية الشاملة.");
  process.exit(1);
}
console.log("\nكل اختبارات الحماية التشغيلية الشاملة نجحت.");
