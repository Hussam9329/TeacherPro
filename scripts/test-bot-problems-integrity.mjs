#!/usr/bin/env node
// «مشاكل البوت»: a notebook in its own dashboard window. It is the admin's,
// or an account's given the «مشاكل البوت» permission; each problem is dated on
// save; a student can have many; and it shows up nowhere else.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failed = false;
const must = (condition, message) => {
  if (condition) console.log(`✅ ${message}`);
  else { failed = true; console.error(`❌ ${message}`); }
};

const schema = read("prisma/schema.prisma");
const model = schema.slice(schema.indexOf("model BotProblem {"), schema.indexOf("}", schema.indexOf("model BotProblem {")));
const migrationName = "20261004120000_bot_problems";
const migration = read(`prisma/migrations/${migrationName}/migration.sql`);
const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
const route = read("src/app/api/bot-problems/route.ts");
const search = read("src/app/api/bot-problems/students/route.ts");
const dialog = read("src/components/teacher-pro/bot-problems-dialog.tsx");
const dashboard = read("src/components/teacher-pro/dashboard.tsx");
const catalog = read("src/lib/permission-catalog.ts");
const serverAuth = read("src/lib/server-auth.ts");
const backup = read("src/app/api/backup/route.ts");

// The data: one row per problem, dated by the database, many per student.
must(model.includes("createdAt      DateTime  @default(now())"), "تاريخ المشكلة يتسجل تلقائياً عند الحفظ");
must(!/@@unique|@unique/.test(model), "يحق تسجيل أكثر من مشكلة لنفس الطالب");
must(model.includes("resolvedAt     DateTime?"), "المشكلة حالية حتى تنعلم محلولة");
must(/CREATE TABLE "BotProblem"/.test(migration) && !/^\s*(?:UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/im.test(migration) && !/UNIQUE/i.test(migration),
  "الترحيل يضيف جدولاً جديداً فقط ولا يغيّر بيانات موجودة");
must(policy[migrationName]?.kind === "expand" &&
  policy[migrationName]?.checksum === createHash("sha256").update(migration).digest("hex"),
  "الترحيل مسجل بسياسة النشر مع بصمته");
// The readiness gate names the newest schema migration, this one or a later one.
const requiredMigration = /REQUIRED_DATABASE_MIGRATION =\s*'([^']+)'/.exec(read("src/lib/schema-readiness.ts"))?.[1] || "";
must(requiredMigration >= migrationName, "النظام ينتظر هذا الترحيل قبل العمل");

// Who sees it: the admin, or whoever is given «مشاكل البوت».
must(catalog.includes('id: "bot-problems.manage"') && catalog.includes('label: "مشاكل البوت"') &&
  /id: "bot-problems.manage",[\s\S]{0,120}level: "manage"/.test(catalog),
  "صلاحية «مشاكل البوت» موجودة بالصلاحيات (ما تنطى لدور المشاهدة تلقائياً)");
must(catalog.includes('p !== "bot-problems.manage"'), "دور المشرف الافتراضي ما ياخذها تلقائياً؛ الأدمن بس");
must(serverAuth.includes('"bot-problems.manage": []'), "ما تنفتح من أي صلاحية ثانية");
for (const [name, source] of [["القائمة والإضافة والحل", route], ["بحث الطالب", search]]) {
  const handlers = source.match(/export async function (?:GET|POST|PATCH)/g) || [];
  const guarded = source.match(/requirePermissionPrincipal\(req, BOT_PROBLEMS_PERMISSION\)/g) || [];
  must(handlers.length > 0 && guarded.length === handlers.length, `${name}: كل طلب يتحقق من صلاحية «مشاكل البوت»`);
}
must(dashboard.includes('actor.permissions?.includes("bot-problems.manage")') &&
  dashboard.includes('actor.roleId === "role_admin"') &&
  /\{canUseBotProblems && \(\s*<button[\s\S]{0,700}مشاكل البوت/.test(dashboard),
  "زر «مشاكل البوت» بلوحة النظام يظهر للأدمن ولمن عنده الصلاحية فقط");

// The window: current and solved, a tick per problem, add with a search.
must(dialog.includes('"مشاكل حالية"') && dialog.includes('"مشاكل تم حلها"'), "فلترين: مشاكل حالية ومشاكل تم حلها");
must(dialog.includes("<Checkbox") && dialog.includes("setResolved(problem, checked)"), "جيكبوكس كدام كل مشكلة يحلها أو يرجعها");
must(dialog.includes('filter === "current" ? !problem.resolvedAt'), "المحلولة تختفي من الحالية");
must(dialog.includes("botProblemsApi.searchStudents") && search.includes("buildStudentRegistrySearchWhere") &&
  !search.includes('status: { not'), "إضافة مشكلة تبحث عن الطالب بكل النظام (كل الحالات)");
must(dialog.includes("<textarea") && route.includes("cleanBotProblemReason(body?.reason)"), "سبب المشكلة يتكتب يدوياً");
must(dialog.includes('setFilter("current")') && !/resolvedAt:\s*new Date\(\)[\s\S]{0,40}create/.test(route),
  "بعد الحفظ تصير مشكلة حالية");
must(dialog.includes("formatBaghdadDateTime(problem.createdAt)"), "تاريخ ووقت المشكلة ظاهر على كل مشكلة");

// A notebook: nothing outside its window.
must(!/auditLog/.test(route) && !/auditLog/.test(search), "ما تكتب بالسجلات");
must(!/student\.update|student\.updateMany/.test(route), "ما تغيّر شي بالطالب");
const allowed = new Set([
  "src/app/api/bot-problems/route.ts",
  "src/app/api/bot-problems/students/route.ts",
  "src/app/api/backup/route.ts",
  "src/components/teacher-pro/accounts.tsx", // the table's name in the backup tab
  "src/components/teacher-pro/bot-problems-dialog.tsx",
  "src/components/teacher-pro/dashboard.tsx",
  "src/lib/bot-problems.ts",
  "src/lib/bot-problems-client.ts",
]);
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
});
const leaks = walk("src").filter((file) => /\.(tsx?|css)$/.test(file) && !allowed.has(file))
  .filter((file) => /botProblem|BotProblem|bot-problems-dialog|bot-problems-client|\/api\/bot-problems/.test(read(file)));
must(leaks.length === 0, `ما تطلع بأي مكان غير نافذتها${leaks.length ? `: ${leaks.join(", ")}` : ""}`);
must(backup.includes("'botProblems'") && backup.includes("botProblems: 'BotProblem'"), "تنحفظ بالنسخة الاحتياطية حتى ما تضيع");

if (failed) {
  console.error("\nفشل فحص «مشاكل البوت».");
  process.exit(1);
}
console.log("\n«مشاكل البوت» سليمة.");
