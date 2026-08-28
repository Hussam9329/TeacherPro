#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
let failed = false;

function must(condition, success, failure = success) {
  if (condition) console.log(`✅ ${success}`);
  else {
    failed = true;
    console.error(`❌ ${failure}`);
  }
}

const layout = read("src/components/teacher-pro/layout.tsx");
const management = read("src/components/teacher-pro/dismissed-management.tsx");
const store = read("src/lib/teacher-store.ts");
const serverAuth = read("src/lib/server-auth.ts");
const canonicalList = read("src/app/api/dismissed-management/list/route.ts");
const canonicalHistory = read("src/app/api/dismissed-management/history/route.ts");
const canonicalStats = read("src/app/api/dismissed-management/stats/route.ts");
const legacyList = read("src/app/api/dismissed-students/list/route.ts");
const legacyHistory = read("src/app/api/dismissed-students/history/route.ts");
const legacyDetails = read("src/app/api/dismissed-students/details/route.ts");
const legacyStats = read("src/app/api/dismissed-students/stats/route.ts");
const pkg = JSON.parse(read("package.json"));

must(
  !exists("src/components/teacher-pro/dismissed-students.tsx") &&
    !layout.includes('id: "dismissed-students"') &&
    !layout.includes('import { DismissedStudentsView }') &&
    !layout.includes('"dismissed-students": DismissedStudentsView'),
  "التبويب والمكوّن القديمان محذوفان من الواجهة والخريطة",
);

must(
  !store.includes('| "dismissed-students"') &&
    !store.includes('"dismissed-students": "students.view"') &&
    layout.includes("value === 'dismissed-students'") &&
    layout.includes("return 'dismissed-management'") &&
    store.includes('state.currentSection === "dismissed-students"') &&
    store.includes('? "dismissed-management"'),
  "روابط وحالة المتصفح القديمة تنتقل إلى إدارة المفصولين دون إبقاء Section ميت",
);

must(
  management.includes("/api/dismissed-management/list?") &&
    management.includes("/api/dismissed-management/history?") &&
    management.includes("/api/dismissed-management/stats?") &&
    !management.includes("/api/dismissed-students/"),
  "واجهة إدارة المفصولين تستخدم namespace الرسمي فقط",
);

must(
  canonicalList.includes('requirePermission(req, "students.view")') &&
    canonicalHistory.includes("requirePermissionPrincipal") &&
    canonicalStats.includes('requirePermission(req, "students.view")') &&
    canonicalStats.includes("buildDismissedStudentWhere") &&
    canonicalStats.includes("withPledge") &&
    canonicalStats.includes("withoutPledge"),
  "مسارات القائمة والسجل والإحصائيات الرسمية محمية وتشارك الفلاتر الخادمية",
);

must(
  legacyList.includes("@/app/api/dismissed-management/list/route") &&
    legacyHistory.includes("@/app/api/dismissed-management/history/route") &&
    legacyStats.includes("@/app/api/dismissed-management/stats/route") &&
    legacyDetails.includes("توافق قراءة فقط") &&
    legacyDetails.includes("export async function GET") &&
    !legacyDetails.includes("export async function POST") &&
    !legacyDetails.includes("export async function PUT"),
  "مسارات القراءة القديمة تبقى طبقة توافق بلا منطق تعديل مكرر",
);

must(
  management.includes('params.set("notesFilter", notesFilter)') &&
    management.includes('params.set("pledgeFilter", pledgeFilter)') &&
    management.includes("handleSaveDismissalNote") &&
    management.includes('student.status !== "مفصول"') &&
    management.includes("expectedMutationToken: student.mutationToken") &&
    management.includes("canEditDismissalNotes") &&
    management.includes('reason: "dismissed-management-note"'),
  "ملاحظات الفصل والفلاتر نُقلت إلى الإدارة مع صلاحية وSnapshot ومنع تعديل المفصول السابق",
);

must(
  serverAuth.includes('"page.dismissed-students.view"') &&
    store.includes("SECTION_PERMISSION_EQUIVALENTS") &&
    store.includes('"dismissed-management": ["page.dismissed-students.view"]') &&
    store.includes("user.permissions.includes(permission)"),
  "صلاحية العرض القديمة تمنح وصولاً انتقالياً فقط دون منح صلاحية التعديل",
);

const reactivateCallers = fs
  .readdirSync(path.join(root, "src/components/teacher-pro"))
  .filter((file) => file.endsWith(".tsx"))
  .filter((file) => read(`src/components/teacher-pro/${file}`).includes('action: "reactivate"'));
must(
  reactivateCallers.length === 1 && reactivateCallers[0] === "dismissed-management.tsx",
  "إعادة التفعيل ما زالت مركزية في إدارة المفصولين فقط",
);

must(
  pkg.scripts?.["test:dismissed-legacy-removal-integrity"] ===
      "node scripts/test-dismissed-legacy-removal-integrity.mjs" &&
    String(pkg.scripts?.["test:side-effects"] || "").includes(
      "test:dismissed-legacy-removal-integrity",
    ),
  "اختبار حذف التبويب القديم مربوط باختبارات الآثار الجانبية",
);

if (failed) {
  console.error("\nفشل اختبار حذف تبويب المفصولين القديم بأمان.");
  process.exit(1);
}
console.log("\nكل اختبارات حذف تبويب المفصولين القديم بأمان نجحت.");
