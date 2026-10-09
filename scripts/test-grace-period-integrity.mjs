#!/usr/bin/env node
// Static guard for the rebuilt grace system: one GracePeriod table, one engine,
// one management screen. Fails if any retired grace behavior comes back.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let failed = false;
function check(condition, message) {
  if (condition) console.log(`✅ ${message}`);
  else {
    failed = true;
    console.error(`❌ ${message}`);
  }
}

const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const sources = walk(path.join(root, "src")).map((file) => ({ file: rel(file), text: fs.readFileSync(file, "utf8") }));
const filesMatching = (pattern) => sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file).sort();

// 1. Retired modules and routes are gone.
const retired = [
  "src/lib/student-grace.ts",
  "src/lib/grade-entry-grace.ts",
  "src/lib/grace-grade-activation.ts",
  "src/lib/grace-period-repair-server.ts",
  "src/lib/grade-smart-note-grace-expiry-server.ts",
  "src/lib/student-grace-history-server.ts",
  "src/app/api/internal/grace-smart-notes/settle/route.ts",
  // The one-time transfer from the old system is finished and removed.
  "src/lib/legacy-grace-conversion.ts",
  "src/lib/legacy-grace-conversion-server.ts",
  "src/app/api/grace-periods/legacy/route.ts",
  "src/components/teacher-pro/legacy-grace-conversion-panel.tsx",
];
for (const file of retired) check(!exists(file), `الملف القديم محذوف: ${file}`);
const retiredImports = filesMatching(
  /from\s+["'][^"']*(?:student-grace|grade-entry-grace|grace-grade-activation|grace-period-repair-server|grade-smart-note-grace-expiry-server|student-grace-history-server)["']/,
);
check(retiredImports.length === 0, `لا يوجد استيراد لوحدات السماح القديمة ${retiredImports.join(", ")}`);
const retiredNames = filesMatching(
  /\b(?:getStudentGraceWindow|isExamInsideGracePeriod|isGradeInsideGracePeriod|endStudentGracePeriod|settleGraceSmartNotes|GRACE_DEFERRED_[A-Z_]+|DEFAULT_GRACE_DAYS)\b/,
);
check(retiredNames.length === 0, `لا توجد دوال أو ثوابت السماح القديمة ${retiredNames.join(", ")}`);

// 2. Old Student grace columns are only named to strip or refuse them.
const legacyColumnReaders = filesMatching(/\b(?:accountingGraceDays|gracePeriodStartDate|gracePeriodEndedAt|gracePeriodHistory)\b/);
const allowedLegacyReaders = new Set([
  "src/lib/grace-periods-server.ts",
  "src/app/api/students/route.ts",
]);
check(
  legacyColumnReaders.every((file) => allowedLegacyReaders.has(file)),
  `حقول السماح القديمة لا يقرأها أي كود ${legacyColumnReaders.filter((file) => !allowedLegacyReaders.has(file)).join(", ")}`,
);
check(!read("src/lib/mutation-replay-policy.ts").includes("/api/grace-periods/legacy"), "لا يبقى أي أثر لمسار النقل القديم");
check(!read("src/components/teacher-pro/grace-periods-dialog.tsx").includes("نقل فترات السماح من النظام القديم"), "زر «نقل فترات السماح من النظام القديم» أُزيل");
const studentsRoute = read("src/app/api/students/route.ts");
check(
  /LEGACY_STUDENT_GRACE_FIELDS|accountingGraceDays",\s*\n\s*"gracePeriodStartDate/.test(studentsRoute) &&
    !/data:\s*{[^}]*accountingGraceDays/.test(studentsRoute),
  "مسار الطلاب يرفض حقول السماح القديمة ولا يكتبها",
);

// New students: an automatic 3-day period from the registration day, added
// in the same transaction that registers them, singly or in bulk.
check(
  read("src/lib/grace-periods.ts").includes("export const NEW_STUDENT_GRACE_DAYS = 3;") &&
    read("src/lib/new-student-grace-server.ts").includes('source: "manual",') &&
    read("src/lib/new-student-grace-server.ts").includes("gracePeriodEndFromDays(startDate, NEW_STUDENT_GRACE_DAYS)") &&
    read("src/lib/new-student-grace-server.ts").includes("baghdadDateKey(registeredAt)") &&
    read("src/app/api/students/route.ts").includes("await addNewStudentGracePeriods(tx, [createdStudent], {") &&
    read("src/app/api/students/bulk/route.ts").includes("await addNewStudentGracePeriods(tx, createdStudents, {") &&
    read("src/components/teacher-pro/grace-periods-dialog.tsx").includes("isNewStudentGracePeriod(period)"),
  "كل طالب جديد (مفرد أو إضافة جماعية) ياخذ فترة سماح تلقائية ٣ أيام من يوم تسجيله بتوقيت بغداد",
);

// 3. GracePeriod rows are written only by the management screen, and the
// automatic period of a new student is only ever added (never changed).
const graceWriters = filesMatching(/\bgracePeriod\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/);
const newStudentGrace = read("src/lib/new-student-grace-server.ts");
check(
  graceWriters.sort().join(",") === "src/lib/grace-period-plan-server.ts,src/lib/new-student-grace-server.ts" &&
    !/\bgracePeriod\.(?:createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(newStudentGrace),
  `كتابة فترات السماح محصورة بإدارة فترة السماح وإضافة سماح الطالب الجديد (${graceWriters.join(", ")})`,
);

// 4. Nothing writes the retired «ضمن فترة السماح» placeholder any more.
const placeholderWriters = sources
  .filter(({ text }) => /status:\s*["']ضمن فترة السماح["']/.test(text))
  .map(({ file }) => file);
check(placeholderWriters.length === 0, `لا يوجد كود يكتب «ضمن فترة السماح» في خلية الدرجة ${placeholderWriters.join(", ")}`);
const writeback = read("src/lib/academic-grade-writeback-server.ts");
check(
  /=== "ضمن فترة السماح"\) \{[\s\S]{0,300}?409/.test(writeback),
  "حفظ الدرجات يرفض كتابة الحالة القديمة",
);

// 5. One engine: the rule depends only on the student periods and the exam date.
const engineSource = read("src/lib/grace-periods.ts");
check(/export function isStudentInGracePeriod\(/.test(engineSource), "الدالة المركزية isStudentInGracePeriod موجودة");
check(engineSource.includes('GRACE_PERIOD_EXCUSE_LABEL = "مجاز — فترة سماح"'), "التسمية الموحدة «مجاز — فترة سماح»");
check(
  engineSource.includes("يوجد للطالب فترة سماح تتداخل مع الفترة المحددة. يرجى تعديل الفترة الموجودة بدلاً من إنشاء فترة جديدة."),
  "رسالة التداخل مطابقة للنص المطلوب",
);
check(!/createdAt|registration|grade|leave/i.test(engineSource.match(/export function isDateInGracePeriod[\s\S]*?\n}\n/)?.[0] || "x"), "قاعدة السماح لا تعتمد على التسجيل أو الدرجات أو الإجازات");
for (const file of ["src/lib/academic-engine.ts", "src/lib/grade-classification.ts", "src/lib/exam-utils.ts"]) {
  check(/isExamInStudentGracePeriod|findExamGracePeriod/.test(read(file)), `${file} يستخدم محرك السماح الجديد`);
}

// 6. Single management entry point, next to «اغلاق الكودات».
const dashboard = read("src/components/teacher-pro/dashboard.tsx");
const closeCodes = dashboard.indexOf("اغلاق الكودات");
const manageGrace = dashboard.search(/tp-dashboard__shortcut-label">\s*إدارة فترة السماح/);
check(closeCodes > 0 && manageGrace > closeCodes, "زر «إدارة فترة السماح» بجانب «اغلاق الكودات» في لوحة التحكم");
check(exists("src/components/teacher-pro/grace-periods-dialog.tsx"), "نافذة إدارة فترة السماح موجودة");
const dialogImporters = filesMatching(/grace-periods-dialog["']/);
check(
  dialogImporters.join(",") === "src/components/teacher-pro/dashboard.tsx",
  `نافذة الإدارة تُفتح من لوحة التحكم فقط (${dialogImporters.join(", ")})`,
);
const graceApiCallers = filesMatching(/["'`]\/api\/grace-periods/).filter((file) => !file.startsWith("src/app/api/"));
check(
  graceApiCallers.every((file) =>
    ["src/lib/grace-periods-client.ts"].includes(file),
  ),
  `واجهة فترات السماح تُستدعى من شاشة الإدارة فقط (${graceApiCallers.join(", ")})`,
);

// 7. Database: new table with overlap guard; old trigger neutralized, old columns kept.
const migrationDir = "prisma/migrations/20260925120000_grace_period_table";
const migration = read(`${migrationDir}/migration.sql`);
check(/CREATE TABLE "GracePeriod"/.test(migration), "جدول GracePeriod منشأ");
check(/"endDate" >= "startDate"/.test(migration), "قيد: النهاية لا تسبق البداية");
check(/GRACE_PERIOD_OVERLAP/.test(migration), "قاعدة البيانات تمنع تداخل الفترات");
check(
  /CREATE OR REPLACE FUNCTION "tp_end_active_grace_on_numeric_grade"\(\)[\s\S]*?BEGIN\s*RETURN NEW;\s*END/.test(migration),
  "المشغّل القديم الذي ينهي السماح عند إدخال درجة أصبح بلا أثر",
);
check(!/\bDROP\b/i.test(migration), "لا حذف لحقول النظام القديم قبل التحقق من النقل");
const schema = read("prisma/schema.prisma");
check(/model GracePeriod \{/.test(schema) && /cancelledAt\s+DateTime\?/.test(schema), "نموذج GracePeriod يحفظ الإلغاء بدل الحذف");
check(!/model GracePeriod \{[\s\S]*?\bstatus\b[\s\S]*?\n\}/.test(schema), "حالة الفترة تُحسب ولا تُخزَّن");
const readinessGate = read("src/lib/schema-readiness.ts").match(/REQUIRED_DATABASE_MIGRATION =\s*'([^']+)'/)?.[1] || "";
check(readinessGate >= "20260925120000_grace_period_table", "التطبيق ينتظر ترحيل جدول السماح (أو ترحيلاً أحدث منه)");
const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
check(
  JSON.stringify(policy).includes("20260925120000_grace_period_table"),
  "سياسة الترحيل تتضمن ترحيل جدول السماح",
);

// 8. Smart list: الكل / المستمرة / المنتهية, read-only, ongoing includes the last day.
const listRoute = read("src/app/api/grace-periods/list/route.ts");
const dialog = read("src/components/teacher-pro/grace-periods-dialog.tsx");
check(
  ["فترات السماح (الكل)", "فترات السماح (المستمرة)", "فترات السماح (المنتهية)"].every((label) => engineSource.includes(label)) &&
    dialog.includes("GRACE_PERIOD_LIST_FILTERS.map"),
  "فلترة ذكية: فترات السماح (الكل) / (المستمرة) / (المنتهية)",
);
check(
  /cancelledAt:\s*null/.test(listRoute) &&
    /endDate:\s*\{\s*gte:\s*todayColumn\s*\}/.test(listRoute) &&
    /endDate:\s*\{\s*lt:\s*todayColumn\s*\}/.test(listRoute) &&
    !/\.(?:create|update|delete|upsert)\w*\(/.test(listRoute),
  "القائمة للقراءة فقط: الملغاة مستبعدة، والمستمرة تشمل اليوم الأخير",
);
check(listRoute.includes("requireAnyPermission(req, GRACE_VIEW_PERMISSIONS)"), "القائمة تتطلب صلاحية عرض فترات السماح أو عرض الطلاب");

// «موظف فترات السماح»: the dashboard and everything about grace periods, nothing else.
{
  const catalog = read("src/lib/permission-catalog.ts");
  const dashboard = read("src/components/teacher-pro/dashboard.tsx");
  const graceRoute = read("src/app/api/grace-periods/route.ts");
  const searchRoute = read("src/app/api/grace-periods/search/route.ts");
  check(
    catalog.includes('id: "grace-periods.view",') && catalog.includes('id: "grace-periods.manage",') &&
      catalog.includes('id: "role_grace",') && catalog.includes('name: "موظف فترات السماح",') &&
      catalog.includes('permissions: ["system.dashboard", "grace-periods.view", "grace-periods.manage"],') &&
      catalog.includes('export const GRACE_VIEW_PERMISSIONS = ["grace-periods.view", "students.view"];') &&
      catalog.includes('export const GRACE_MANAGE_PERMISSIONS = ["grace-periods.manage", "students.edit"];') &&
      graceRoute.includes("requireAnyPermission(req, GRACE_VIEW_PERMISSIONS)") &&
      graceRoute.includes("requireAnyPermissionPrincipal(req, GRACE_MANAGE_PERMISSIONS)") &&
      searchRoute.includes("requireAnyPermission(req, GRACE_VIEW_PERMISSIONS)") &&
      dashboard.includes('Boolean(actor?.permissions?.includes("grace-periods.view"))') &&
      dashboard.includes('actor.permissions?.includes("grace-periods.manage")'),
    "دور «موظف فترات السماح» يفتح لوحة النظام و«إدارة فترة السماح» كاملة بدون باقي النظام، ومن عنده عرض/تعديل الطلاب يبقى مثل قبل",
  );
}

// 9. Archived and dismissed students can never receive or change a grace period.
const planServer = read("src/lib/grace-period-plan-server.ts");
check(/ARCHIVED_STATUS = "مؤرشف"/.test(planServer) && /student\.status === ARCHIVED_STATUS[\s\S]{0,120}throw new GraceChangeError/.test(planServer), "الخادم يرفض أي تعديل سماح لطالب مؤرشف");
check(/DISMISSED_STATUS = "مفصول"/.test(planServer) && /student\.status === DISMISSED_STATUS[\s\S]{0,160}throw new GraceChangeError/.test(planServer), "الخادم يرفض أي تعديل سماح لطالب مفصول حتى يوقع تعهداً");
check(
  (dialog.match(/data-locked=\{lock\?\.kind \|\| "none"\}/g) || []).length === 3 &&
    (dialog.match(/disabled=\{loading \|\| Boolean\(lock\)\}/g) || []).length === 2 &&
    (dialog.match(/disabled=\{busy \|\| Boolean\(lock\)\}/g) || []).length === 2 &&
    dialog.includes('"مؤرشف": { kind: "archived"') &&
    dialog.includes('"مفصول": { kind: "dismissed"') &&
    dialog.includes("الطالب مفصول — يحتاج إرجاع أولاً"),
  "الطالب المؤرشف والمفصول يظهران معطلَين (بلونين مختلفين) في البحث والقائمة وأزرار الإضافة والتعديل",
);

// 10. The next student in one tap (phones): the search stays on top, «خروج»
// and «سجّل طالب ثاني» go back to it focused, and digits are read in either script.
const dialogCss = read("src/components/teacher-pro/grace-periods-dialog.css");
const searchAt = dialog.indexOf('className="tp-modal__section tp-grace__search"');
check(
  searchAt > 0 && searchAt < dialog.indexOf("{!data && (") &&
    /\.tp-grace__search\s*\{[^}]*position:\s*sticky/.test(dialogCss) &&
    /onClick=\{\(\) => leaveStudent\(false\)\}[\s\S]{0,200}خروج/.test(dialog) &&
    /onClick=\{\(\) => leaveStudent\(true\)\}[\s\S]{0,120}سجّل طالب ثاني/.test(dialog) &&
    /function leaveStudent[\s\S]{0,300}input\.focus\(\)/.test(dialog),
  "البحث ثابت فوق، و«خروج» و«سجّل طالب ثاني» يرجعان له جاهزاً للكتابة",
);
check(
  /function cleanDays[\s\S]{0,120}toLatinDigits\(value\)/.test(dialog) &&
    /inputMode="numeric"/.test(dialog) &&
    !/type="number"/.test(dialog) &&
    /const trimmedQuery = toLatinDigits\(query\)\.trim\(\)/.test(dialog) &&
    /const latin = toLatinDigits\(query\)/.test(read("src/lib/student-registry-filters-server.ts")),
  "الأرقام تُقبل عربية أو إنكليزية: عدد الأيام والبحث بالكود",
);
check(
  /const QUICK_GRACE_DAYS = \[[\d, ]+\]\.filter\(\(days\) => days <= MAX_GRACE_PERIOD_DAYS\)/.test(dialog),
  "المدد الجاهزة لا تتجاوز الحد الأعلى لفترة السماح",
);

// 11. Tests are wired.
const pkg = JSON.parse(read("package.json"));
check(pkg.scripts["test:grace-period-integrity"]?.includes("test-grace-periods-behavior.mjs"), "اختبارات سلوك السماح الجديدة ضمن الحزمة");

if (failed) process.exit(1);
console.log("\nنظام فترة السماح الجديد سليم.");
