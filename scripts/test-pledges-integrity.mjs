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
function must(condition, okMessage, failMessage = okMessage) {
  if (condition) pass(okMessage);
  else fail(failMessage);
}

const followUp = read("src/components/teacher-pro/follow-up.tsx");
const api = read("src/lib/api.ts");
const pledgeRoute = read("src/app/api/student-notes/pledges/route.ts");
const pkg = JSON.parse(read("package.json"));

must(
  api.includes("export const pledgeApi") &&
    api.includes("student-notes/pledges") &&
    api.includes("PledgeRowsResponse") &&
    api.includes("PledgeActionResponse"),
  "طبقة API الأمامية تملك pledgeApi لقراءة التعهدات وتنفيذ إجراءاتها من الخادم",
  "يجب إضافة pledgeApi في src/lib/api.ts للتعامل مع صفحة التعهدات من الخادم.",
);

must(
  followUp.includes("pledgeApi") &&
    followUp.includes("pledgeRowsFromDb") &&
    followUp.includes("setPledgeRowsFromDb"),
  "واجهة التعهدات تعتمد على صفوف التعهدات القادمة من قاعدة البيانات",
  "صفحة التعهدات يجب أن تستخدم pledgeApi وتخزن pledgeRowsFromDb بدلاً من بناء كل القائمة من كاش Zustand.",
);

must(
  followUp.includes("AbortController") &&
    followUp.includes("signal: controller.signal") &&
    followUp.includes("return () => controller.abort()"),
  "طلبات التعهدات تُلغى عبر AbortController عند تغير الفلاتر أو البحث",
  "يجب إلغاء طلبات التعهدات القديمة حتى لا تظهر نتائج متأخرة فوق الأحدث.",
);

must(
  !followUp.includes("addStudentNote") &&
    !followUp.includes("deleteStudentNote") &&
    !followUp.includes("reactivateStudent"),
  "واجهة التعهدات لا تستخدم إجراءات Zustand المحلية للتعهد أو إعادة التفعيل",
  "لا يجوز استخدام addStudentNote/deleteStudentNote/reactivateStudent داخل صفحة التعهدات.",
);

must(
  followUp.includes('action: checked ? "pledge-and-reactivate" : "remove-pledge"') &&
    followUp.includes("pledgeApi.action") &&
    followUp.includes("queued"),
  "تثبيت/إلغاء التعهد يتم Server-first عبر API واحد",
  "التعهدات يجب أن تنفذ عبر pledgeApi.action وتتعامل مع فشل الخادم/الطابور بدون نجاح وهمي.",
);

must(
  followUp.includes("pledgeLoading || pledgeError") &&
    followUp.includes("disabled={saving || pledgeLoading || Boolean(pledgeError)}"),
  "الإجراءات الحساسة تتعطل عند تحميل/فشل بيانات التعهدات",
  "يجب منع التبديل أثناء التحميل أو عند فشل تحميل بيانات الخادم.",
);

must(
  followUp.includes("gradeApi.listAll({ studentId: row.student.id })") &&
    followUp.includes("pledgeGradeReport") &&
    followUp.includes("whatsappMessageLink") &&
    followUp.includes("اسم الامتحان:") &&
    followUp.includes("تاريخ الامتحان:") &&
    followUp.includes("درجة الامتحان:"),
  "الضغط على رقم ولي الأمر يفتح واتساب برسالة التعهد وتقرير الدرجات الحقيقي من النظام",
  "يجب تحميل درجات الطالب من API وتجهيز رابط واتساب لرقم ولي الأمر.",
);

must(
  followUp.includes("اسم ولي الأمر: ……………………….") &&
    followUp.includes("اسم الطالب: ……………………….") &&
    followUp.includes("التوقيع: ……………………….") &&
    followUp.includes("التاريخ: …… / …… / …….") &&
    !followUp.includes("اسم الطالب: ${student.name}"),
  "حقول نموذج التعهد تبقى فارغة كما طلب المستخدم ولا يملأ النظام إلا تقرير الدرجات",
  "يجب إبقاء اسم ولي الأمر والطالب والتوقيع والتاريخ كفراغات داخل نص التعهد.",
);

must(
  followUp.includes("debouncedPledgeSearch") &&
    followUp.includes("typeFilter: pledgeTypeFilter") &&
    followUp.includes("statusFilter: pledgeStatusFilter"),
  "البحث وفلاتر نوع الفصل وحالة التعهد تُرسل للخادم",
  "يجب أن تمر فلاتر التعهدات إلى API قاعدة البيانات لا تبقى محلية فقط.",
);

must(
  pledgeRoute.includes('export async function GET') &&
    pledgeRoute.includes('requirePermission(req, "follow-up.view")') &&
    pledgeRoute.includes("buildPledgeRows") &&
    pledgeRoute.includes("source: \"database\""),
  "API قراءة التعهدات يرجع الصفوف والإحصائيات من قاعدة البيانات",
  "يجب وجود GET /api/student-notes/pledges محمي ويقرأ التعهدات من DB.",
);

must(
  pledgeRoute.includes('export async function POST') &&
    pledgeRoute.includes('requirePermissionPrincipal(req, "follow-up.manage")') &&
    pledgeRoute.includes('"pledge-and-reactivate"') &&
    pledgeRoute.includes('"remove-pledge"'),
  "API إجراءات التعهدات محمي ويدعم التثبيت/الإلغاء",
  "يجب وجود POST /api/student-notes/pledges لتنفيذ تثبيت وإلغاء التعهد.",
);

must(
  pledgeRoute.includes("db.$transaction") &&
    pledgeRoute.includes("studentNote.create") &&
    pledgeRoute.includes("student.update") &&
    pledgeRoute.includes("opportunityLog.create") &&
    pledgeRoute.includes("auditLog.create"),
  "تثبيت التعهد مع إعادة التفعيل يتم داخل transaction مع سجل فرص وتدقيق",
  "تثبيت التعهد وإعادة التفعيل يجب أن يكونا عملية خادمية واحدة داخل transaction.",
);

must(
  pledgeRoute.includes("deleteMany") &&
    pledgeRoute.includes("إلغاء تعهد ولي الأمر"),
  "إلغاء التعهد يحذف التعهد المرتبط فقط من قاعدة البيانات مع Audit log",
  "إلغاء التعهد يجب أن يتم من الخادم ولا يمسح تعهدات أخرى بالخطأ.",
);

must(
  pkg.scripts &&
    pkg.scripts["test:pledges-integrity"] === "node scripts/test-pledges-integrity.mjs",
  "سكريبت test:pledges-integrity مضاف إلى package.json",
  "يجب إضافة test:pledges-integrity إلى package.json.",
);

must(
  pkg.scripts &&
    String(pkg.scripts["test:side-effects"] || "").includes("test:pledges-integrity"),
  "اختبار side-effects يشمل صفحة التعهدات",
  "يجب أن يشمل test:side-effects اختبار صفحة التعهدات.",
);

if (failed) {
  console.error("\nفشل اختبار سلامة صفحة التعهدات. راجع الرسائل أعلاه.");
  process.exit(1);
}

console.log("\nكل اختبارات سلامة صفحة التعهدات نجحت.");
