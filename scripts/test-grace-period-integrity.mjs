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
];
for (const file of retired) check(!exists(file), `الملف القديم محذوف: ${file}`);
const retiredImports = filesMatching(
  /from\s+["'][^"']*(?:student-grace|grade-entry-grace|grace-grade-activation|grace-period-repair-server|grade-smart-note-grace-expiry-server|student-grace-history-server)["']/,
);
check(retiredImports.length === 0, `لا يوجد استيراد لوحدات السماح القديمة ${retiredImports.join(", ")}`);
const retiredNames = filesMatching(
  /\b(?:getStudentGraceWindow|isExamInsideGracePeriod|isGradeInsideGracePeriod|endStudentGracePeriod|settleGraceSmartNotes|GRACE_DEFERRED_[A-Z_]+|DEFAULT_GRACE_DAYS)\b/,
).filter((file) => file !== "src/lib/legacy-grace-conversion.ts");
check(retiredNames.length === 0, `لا توجد دوال أو ثوابت السماح القديمة ${retiredNames.join(", ")}`);

// 2. Old Student grace columns are read only by the one-time conversion.
const legacyColumnReaders = filesMatching(/\b(?:accountingGraceDays|gracePeriodStartDate|gracePeriodEndedAt|gracePeriodHistory)\b/);
const allowedLegacyReaders = new Set([
  "src/lib/legacy-grace-conversion.ts",
  "src/lib/legacy-grace-conversion-server.ts",
  "src/lib/grace-periods-server.ts",
  "src/app/api/students/route.ts",
]);
check(
  legacyColumnReaders.every((file) => allowedLegacyReaders.has(file)),
  `حقول السماح القديمة لا تُقرأ إلا في أداة النقل ${legacyColumnReaders.filter((file) => !allowedLegacyReaders.has(file)).join(", ")}`,
);
const studentsRoute = read("src/app/api/students/route.ts");
check(
  /LEGACY_STUDENT_GRACE_FIELDS|accountingGraceDays",\s*\n\s*"gracePeriodStartDate/.test(studentsRoute) &&
    !/data:\s*{[^}]*accountingGraceDays/.test(studentsRoute),
  "مسار الطلاب يرفض حقول السماح القديمة ولا يكتبها",
);

// 3. GracePeriod rows are written only by the management screen and the conversion.
const graceWriters = filesMatching(/\bgracePeriod\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/);
check(
  graceWriters.join(",") === "src/lib/grace-period-plan-server.ts,src/lib/legacy-grace-conversion-server.ts",
  `كتابة فترات السماح محصورة بإدارة فترة السماح وأداة النقل (${graceWriters.join(", ")})`,
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
const manageGrace = dashboard.indexOf("إدارة فترة السماح</span>");
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
    ["src/lib/grace-periods-client.ts", "src/components/teacher-pro/legacy-grace-conversion-panel.tsx", "src/lib/mutation-replay-policy.ts"].includes(file),
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
check(read("src/lib/schema-readiness.ts").includes("20260925120000_grace_period_table"), "التطبيق ينتظر ترحيل جدول السماح");
const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
check(
  JSON.stringify(policy).includes("20260925120000_grace_period_table"),
  "سياسة الترحيل تتضمن ترحيل جدول السماح",
);

// 8. Legacy conversion: dry run before apply, never replayed offline.
const legacyRoute = read("src/app/api/grace-periods/legacy/route.ts");
check(/dry-run/.test(legacyRoute) && /apply/.test(legacyRoute), "النقل من النظام القديم فيه تشغيل تجريبي ثم تطبيق");
check(/system\.maintenance/.test(legacyRoute), "النقل مقصور على صلاحية الصيانة");
check(read("src/lib/mutation-replay-policy.ts").includes("/api/grace-periods/legacy"), "النقل لا يعاد تشغيله من طابور عدم الاتصال");

// 9. Tests are wired.
const pkg = JSON.parse(read("package.json"));
check(pkg.scripts["test:grace-period-integrity"]?.includes("test-grace-periods-behavior.mjs"), "اختبارات سلوك السماح الجديدة ضمن الحزمة");

if (failed) process.exit(1);
console.log("\nنظام فترة السماح الجديد سليم.");
