#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

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

const runtimeFiles = walk(path.join(root, "src"));
const runtimeSource = runtimeFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const schema = read("prisma/schema.prisma");
const statusAction = read("src/app/api/students/status-action/route.ts");
const pledgeRoute = read("src/app/api/student-notes/pledges/route.ts");
const engine = read("src/lib/academic-engine.ts");
const management = read("src/components/teacher-pro/dismissed-management.tsx");
const filters = read("src/lib/dismissed-student-filters-server.ts");
const migration = read("prisma/migrations/20260828034500_single_dismissal_policy/migration.sql");
const pkg = JSON.parse(read("package.json"));

const forbiddenRuntimeTerms = [
  "فصل مؤقت",
  "فصل نهائي",
  "فرصة أخيرة بعد تعهد",
  "عدم الالتزام بالتعهد السابق",
  "dismissalType",
];
check(
  forbiddenRuntimeTerms.every((term) => !runtimeSource.includes(term)),
  "كود التشغيل لا يحتوي أي منطق أو تسمية لأنواع الفصل القديمة",
);

check(
  !schema.includes("dismissalType"),
  "Prisma runtime schema لا يعرّف حقلاً لنوع الفصل",
);

check(
  statusAction.includes('status: "مفصول"') &&
    statusAction.includes('action: "رصيد إعادة التفعيل"') &&
    statusAction.includes("amount: 2") &&
    statusAction.includes("opportunities: 2") &&
    !statusAction.includes("dismissalType"),
  "إعادة التفعيل العامة تعيد الطالب نشطاً برصيد فرصتين بلا نوع فصل",
);

check(
  pledgeRoute.includes('action: "رصيد بعد تعهد"') &&
    pledgeRoute.includes("amount: 2") &&
    pledgeRoute.includes("opportunities: 2") &&
    !pledgeRoute.includes("dismissalType"),
  "التعهد يعيد الطالب برصيد فرصتين فقط ولا يغيّر نوع فصل",
);

check(
  engine.includes('log.action === "رصيد بعد تعهد"') &&
    engine.includes('log.action === "رصيد إعادة التفعيل"') &&
    engine.includes("opportunities = 2") &&
    !engine.includes("dismissalType"),
  "المحرك الأكاديمي يعيد تشغيل كل إعادة تفعيل على رصيد فرصتين موحد",
);

check(
  management.includes('"مفصول سابقاً"') &&
    management.includes('useState<"all" | "current" | "former">("all")') &&
    filters.includes('scope === "former"') &&
    filters.includes('scope === "all"'),
  "إدارة المفصولين تعرض المفصول الحالي والمفصول سابقاً كوسم تاريخي فقط",
);

check(
  migration.includes('SET "dismissalType" = NULL') &&
    migration.includes('SET "dismissalType" = \'\'') &&
    migration.includes("'رصيد بعد تعهد'") &&
    migration.includes('"amount" = 2') &&
    migration.includes('UPDATE "StudentEnrollmentArchive"') &&
    migration.includes('UPDATE "CourseChapter"') &&
    migration.includes("'عدم الالتزام بالتعهد السابق - '") &&
    migration.includes("'الفصل الثاني للطالب - '"),
  "ترحيل التوافق يصفر التصنيفات القديمة ويحوّل التعهد إلى فرصتين وينظف الأرشيف من تصعيد الفصل القديم",
);

check(
  pkg.scripts?.["test:single-dismissal-policy-integrity"] ===
    "node scripts/test-single-dismissal-policy-integrity.mjs" &&
    String(pkg.scripts?.["test:side-effects"] || "").includes(
      "test:single-dismissal-policy-integrity",
    ),
  "اختبار سياسة الفصل الموحد مربوط بحزمة الآثار الجانبية",
);

if (failed) {
  console.error("\nفشل اختبار سياسة الفصل الموحد.");
  process.exit(1);
}
console.log("\nكل اختبارات سياسة الفصل الموحد نجحت.");
