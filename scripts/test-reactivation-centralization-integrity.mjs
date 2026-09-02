#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
let failed = false;
const check = (condition, message) => {
  if (condition) console.log(`✅ ${message}`);
  else { failed = true; console.error(`❌ ${message}`); }
};

const management = read("src/components/teacher-pro/dismissed-management.tsx");
const registry = read("src/components/teacher-pro/student-registry.tsx");
const registryResults = read("src/components/teacher-pro/student-registry-results.tsx");
const opportunities = read("src/components/teacher-pro/opportunities.tsx");
const followUp = read("src/components/teacher-pro/follow-up.tsx");
const bulkAdjust = read("src/app/api/opportunities/bulk-adjust/route.ts");
const bulkTargets = read("src/app/api/opportunities/bulk-targets/route.ts");
const bulkPreview = read("src/lib/bulk-opportunity-preview-server.ts");
const api = read("src/lib/api.ts");
const store = read("src/lib/teacher-store.ts");
const transition = read("src/app/api/course-chapters/second-chapter-transition/route.ts");
const chapters = read("src/components/teacher-pro/chapters.tsx");
const statusAction = read("src/app/api/students/status-action/route.ts");
const academicRepair = read("src/app/api/students/academic-repair/route.ts");
const engine = read("src/lib/academic-engine.ts");

check(
  management.includes('action: "reactivate"') &&
  management.includes("expectedMutationToken") &&
  management.includes("students.edit") &&
  management.includes("canReactivate") &&
  management.includes("استرجاع الطالب") &&
  statusAction.includes("REACTIVATION_OPPORTUNITY_GRANT"),
  "إدارة المفصولين تستخدم المسار الخادمي الوحيد لاسترجاع المفصول بفرصتين",
);

check(
  !registry.includes('action: "reactivate"') &&
  registry.includes('action: "restore"') &&
  registryResults.includes("onRestore") &&
  registryResults.includes("استعادة من الأرشيف") &&
  !registryResults.includes("إعادة تفعيل"),
  "سجل الطلاب يحتفظ باستعادة المؤرشف فقط ولا يسترجع المفصول",
);


check(
  !opportunities.includes("reactivateDismissedOnAdd") &&
  opportunities.includes("تُضاف لهم الفرص فقط دون تغيير حالتهم") &&
  !bulkAdjust.includes("reactivateDismissedOnAdd") &&
  !bulkTargets.includes("reactivateDismissedOnAdd") &&
  !bulkPreview.includes("reactivateDismissedOnAdd") &&
  !api.includes("reactivateDismissedOnAdd"),
  "الإضافة الجماعية لا تملك أي علم أو مسار لإعادة تفعيل المفصول",
);

check(
  bulkAdjust.includes('log.action !== "إعادة تفعيل"') &&
  bulkAdjust.includes("RETIRED_BULK_STATUS_TRANSITION") &&
  bulkAdjust.includes("requiresRefresh: true") &&
  !bulkAdjust.includes('data: {\n              status: "نشط"') &&
  !bulkAdjust.includes("migrateDismissedPendingGradesAfterActivation"),
  "مسار bulk-adjust القديم لا يستطيع تمرير إعادة تفعيل أو ترحيل درجات مفصول",
);

check(
  !exists("src/app/api/student-notes/pledges/route.ts") &&
  !exists("src/app/api/student-notes/pledge-stats/route.ts") &&
  !followUp.includes("FollowUpPledgesView") &&
  !followUp.includes("pledgeApi"),
  "ميزة التعهد القديمة محذوفة ولا توفر مساراً موازياً للاسترجاع",
);

check(
  !store.includes("reactivateStudent:") &&
  !store.includes("reactivateDismissedOnAdd") &&
  !store.includes("إعادة تفعيل تلقائية بعد إضافة فرصة جماعية"),
  "كود Zustand الميت لمسارات الاسترجاع القديمة محذوف",
);


check(
  academicRepair.match(/retiredDismissedReactivationPath:\s*true/g)?.length === 1 &&
  academicRepair.includes("استرجاع أي طالب مفصول يتم حصراً من صفحة إدارة المفصولين") &&
  academicRepair.includes("preservedDismissedStudents") &&
  academicRepair.includes("حارس مركزية الاسترجاع") &&
  academicRepair.includes("withSerializableTransaction") &&
  !academicRepair.includes("migrateDismissedPendingGradesAfterActivation") &&
  !academicRepair.includes('status: "نشط"') &&
  !academicRepair.includes("restoredStudents"),
  "الصيانة تصلح حماية المفصول ذرياً دون استرجاع والمسار التاريخي القديم متقاعد",
);

check(
  engine.includes('student.status === "مفصول" && !dismissed') &&
  engine.includes("never reactivate them implicitly") &&
  engine.includes('status: "مفصول"'),
  "المحرك نفسه يحفظ حالة المفصول أمام كل إعادة احتساب غير صريحة",
);

check(
  transition.includes("activeStudentIds") &&
  transition.includes("dismissedPreserved") &&
  transition.includes("archivedPreserved") &&
  transition.includes("data: activeStudents.map") &&
  !transition.includes('action: "إعادة تفعيل"') &&
  !transition.includes("reactivatedStudents") &&
  chapters.includes("مفصولون يبقون مفصولين") &&
  chapters.includes("مؤرشفون يبقون مؤرشفين"),
  "انتقال الفصل الثاني لا يعيد تفعيل المفصول أو المؤرشف كمسار خلفي",
);

const componentDir = path.join(root, "src", "components", "teacher-pro");
const reactivateCallers = fs.readdirSync(componentDir)
  .filter((name) => name.endsWith(".tsx"))
  .filter((name) => read(path.join("src", "components", "teacher-pro", name)).includes('action: "reactivate"'));
check(
  reactivateCallers.length === 1 && reactivateCallers[0] === "dismissed-management.tsx",
  `استدعاء reactivate في الواجهات محصور بإدارة المفصولين فقط (${reactivateCallers.join(", ") || "لا يوجد"})`,
);

if (failed) {
  console.error("\nفشل اختبار مركزية استرجاع المفصول.");
  process.exit(1);
}
console.log("\nكل اختبارات مركزية استرجاع المفصول نجحت.");
