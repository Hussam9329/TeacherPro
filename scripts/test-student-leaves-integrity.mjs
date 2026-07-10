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

const followUp = read("src/components/teacher-pro/follow-up.tsx");
const route = read("src/app/api/student-leaves/route.ts");
const api = read("src/lib/api.ts");
const pkg = JSON.parse(read("package.json"));

must(
  followUp.includes("studentLeaveApi") &&
    followUp.includes("/api/student-leaves?") &&
    followUp.includes("setLeaveRowsFromDb"),
  "صفحة الإجازات تقرأ الإجازات من قاعدة البيانات داخل حالة مستقلة",
  "صفحة الإجازات يجب أن تعرض إجازات DB لا كاش studentLeaves فقط.",
);

must(
  followUp.includes("AbortController") &&
    followUp.includes("signal: controller.signal") &&
    followUp.includes("return () => controller.abort()"),
  "تحميل الإجازات يستخدم AbortController لمنع رجوع نتائج قديمة",
  "طلبات صفحة الإجازات يجب أن تُلغى عند تغيير الصفحة أو المزامنة.",
);

must(
  followUp.includes("studentLeaveApi.add") &&
    !followUp.includes("addStudentLeave"),
  "حفظ الإجازة Server-first عبر studentLeaveApi.add وليس addStudentLeave المحلي",
  "لا يجوز استخدام addStudentLeave المحلي في تبويب الإجازات.",
);

must(
  followUp.includes("studentLeaveApi.remove") &&
    !followUp.includes("deleteStudentLeave"),
  "حذف الإجازة Server-first عبر studentLeaveApi.remove وليس deleteStudentLeave المحلي",
  "لا يجوز استخدام deleteStudentLeave المحلي في تبويب الإجازات.",
);

must(
  followUp.includes("leaveRowsFromDb.some") &&
    followUp.includes("هذا الطالب لديه إجازة مسجلة بنفس النطاق حسب قاعدة البيانات"),
  "فحص التكرار يعتمد على الإجازات القادمة من قاعدة البيانات",
  "فحص تكرار الإجازة يجب ألا يعتمد على كاش محلي قديم.",
);

must(
  followUp.includes("leaveError") &&
    followUp.includes("disabled={leaveSaving || leaveLoading || Boolean(leaveError)}") &&
    followUp.includes("disabled={deleting || leaveLoading || Boolean(leaveError)}"),
  "الإجراءات الحساسة تتوقف إذا فشل تحميل الإجازات من الخادم",
  "يجب منع الحفظ والحذف عند فشل تحميل بيانات الخادم.",
);

must(
  followUp.includes("backedUpGrades") &&
    followUp.includes("restoredGradeCount") &&
    followUp.includes("استرجاع"),
  "الواجهة تعرض أثر حذف/حفظ الإجازة على الدرجات المحفوظة احتياطياً",
  "صفحة الإجازات يجب أن توضح حذف الدرجات أو استرجاعها بعد إجراءات الإجازة.",
);

must(
  followUp.includes("leaveStats") &&
    followUp.includes("leaveTypeFilter") &&
    followUp.includes("leaveSearch") &&
    followUp.includes("leavesForDisplay"),
  "صفحة الإجازات تملك إحصائيات وفلاتر وبحث واضحة للمستخدم",
  "صفحة الإجازات يجب أن تحتوي بحث، فلتر نوع، وإحصائيات DB.",
);

must(
  followUp.includes("emitTeacherProDataChanged") &&
    followUp.includes("student-leave-created") &&
    followUp.includes("student-leave-deleted"),
  "إجراءات الإجازات تبث مزامنة لباقي النظام بعد نجاح الخادم",
  "حفظ/حذف الإجازة يجب أن يحدّث الصفحات المرتبطة مثل الدرجات والفرص والداشبورد.",
);

must(
  route.includes("db.$transaction") &&
    route.includes("backupGradesForLeave") &&
    route.includes("restoreGradesForLeave") &&
    route.includes("recalculateStudentsAcademicState"),
  "API الإجازات يحفظ/يحذف داخل transaction مع نسخ احتياطي للدرجات وإعادة احتساب",
  "API الإجازات يجب أن يحمي الدرجات ويعيد الاحتساب داخل transaction.",
);

must(
  route.includes("requirePermission(req, \"follow-up.manage\")") &&
    route.includes("writeRequestAuditLog"),
  "API الإجازات محمي بالصلاحيات ويسجل Audit log",
  "API الإجازات يجب أن يتطلب صلاحيات المتابعة ويسجل تدقيقاً.",
);

must(
  api.includes("export const studentLeaveApi") &&
    api.includes('apiPost("student-leaves"') &&
    api.includes('apiDelete("student-leaves"'),
  "طبقة API الأمامية تحتوي studentLeaveApi للحفظ والحذف",
  "طبقة API يجب أن تحتوي studentLeaveApi.add/remove.",
);

must(
  pkg.scripts?.["test:student-leaves-integrity"] ===
    "node scripts/test-student-leaves-integrity.mjs",
  "سكريبت اختبار الإجازات مضاف إلى package.json",
  "يجب إضافة test:student-leaves-integrity إلى package.json.",
);

must(
  String(pkg.scripts?.["test:side-effects"] || "").includes(
    "test:student-leaves-integrity",
  ),
  "اختبار side-effects يشمل صفحة الإجازات",
  "يجب أن يشمل الفحص الشامل اختبار الإجازات.",
);

if (failed) {
  console.error("\nفشل اختبار سلامة صفحة الإجازات. راجع الرسائل أعلاه.");
  process.exit(1);
}

console.log("\nكل اختبارات سلامة صفحة الإجازات نجحت.");
