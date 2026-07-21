import fs from "fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (condition, message) => checks.push({ condition, message });

const snapshot = read("src/lib/student-opportunity-snapshot-server.ts");
const balance = read("src/lib/opportunity-balance.ts");
const studentRoute = read("src/app/api/students/route.ts");
const profileStats = read("src/app/api/students/profile-stats/route.ts");
const candidates = read("src/app/api/student-calls/candidates/route.ts");
const stats = read("src/app/api/opportunities/stats/route.ts");
const bulkTargets = read("src/app/api/opportunities/bulk-targets/route.ts");
const bulkAdjust = read("src/app/api/opportunities/bulk-adjust/route.ts");
const bulkPreview = read("src/lib/bulk-opportunity-preview-server.ts");
const studentAction = read("src/app/api/opportunities/student-action/route.ts");
const academicEngine = read("src/lib/academic-engine.ts");
const academicServer = read("src/lib/academic-recalculate-server.ts");
const academicRepair = read("src/app/api/students/academic-repair/route.ts");
const opportunitiesView = read("src/components/teacher-pro/opportunities.tsx");
const registry = read("src/components/teacher-pro/student-registry.tsx");
const dismissed = read("src/components/teacher-pro/dismissed-students.tsx");
const followUp = read("src/components/teacher-pro/follow-up.tsx");
const profile = read("src/components/teacher-pro/student-profile-dialog.tsx");
const bulkImport = read("src/components/teacher-pro/student-bulk-text-import.tsx");

check(
  snapshot.includes("const current = opportunityNumber(student.opportunities)") &&
    snapshot.includes("const opportunityLimit = activeChapter?.opportunities ?? null") &&
    !snapshot.includes("activeChapter?.opportunities || student.baseOpportunities"),
  "الرصيد الحالي مصدره Student.opportunities والسقف مصدره الفصل النشط فقط",
);
check(
  snapshot.includes("links.length === 1") &&
    snapshot.includes('"active-chapter-conflict"') &&
    snapshot.includes('"missing-active-chapter"') &&
    snapshot.includes('"zero-limit"'),
  "المصدر الموحد يميز الفصل الوحيد عن الغياب والتعارض والسقف الصفري",
);
check(
  snapshot.includes("courseId: { in: courseIds }") &&
    snapshot.includes("attachStudentOpportunitySnapshotsWithClient") &&
    snapshot.match(/courseChapter\.findMany/g)?.length === 1,
  "قراءة السقف مجمعة باستعلام واحد وقابلة للاستخدام داخل transaction بدون N+1",
);
check(
  balance.includes("formatOpportunityBalance") &&
    balance.includes("getOpportunityLimit") &&
    balance.includes('return `${current}${separator}${limit === null ? unavailableLimit : limit}`'),
  "جميع الواجهات تستطيع استعمال منسق موحد للرصيد والسقف",
);
check(
  studentRoute.includes("attachStudentOpportunitySnapshots") &&
    profileStats.includes("attachStudentOpportunitySnapshots") &&
    candidates.includes("attachStudentOpportunitySnapshots"),
  "قائمة الطلاب وملف الطالب والمكالمات ترجع نفس Snapshot الخادمي",
);
check(
  stats.includes("attachStudentOpportunitySnapshots") &&
    stats.includes('student.opportunityHealth !== "ready"') &&
    stats.includes("student.isOpportunityFull") &&
    !stats.includes("student.baseOpportunities ||"),
  "عدادات الفرص تقارن الرصيد بالسقف الموحد ولا تستعمل قيمة أساس قديمة",
);
check(
  bulkTargets.includes("buildBulkOpportunityPreview") &&
    bulkPreview.includes("attachStudentOpportunitySnapshotsWithClient") &&
    bulkPreview.includes('student.opportunityHealth === "ready"') &&
    bulkPreview.includes("student.isOpportunityFull") &&
    bulkPreview.includes("invalidOpportunitySource"),
  "معاينة العمليات الجماعية تستبعد كل طالب بلا مصدر سقف صالح وتشرح السبب",
);
check(
  bulkAdjust.includes("buildBulkOpportunityPreview") &&
    bulkPreview.includes('student.opportunityHealth === "ready"') &&
    bulkPreview.includes("activeChapter: student.activeChapter") &&
    bulkPreview.includes("opportunityLimit: student.opportunityLimit") &&
    bulkAdjust.includes("const activeChapter = student.activeChapter") &&
    !bulkPreview.includes("fullOpportunityLimitForStudent"),
  "تنفيذ العمليات الجماعية يستعمل نفس Snapshot داخل transaction مثل المعاينة",
);
check(
  studentAction.includes("activeChapterResult.activeLink.chapter.opportunities") &&
    !studentAction.includes("student.baseOpportunities || activeChapterResult"),
  "إعادة تعيين طالب واحد تعتمد على سقف الفصل النشط وليس الأساس المخزن",
);
check(
  academicEngine.includes("activeCourseChapterGroups") &&
    academicEngine.includes(".filter(([, links]) => links.length === 1)") &&
    academicEngine.match(/activeChapter\?\.opportunities \?\? student\.baseOpportunities \?\? 0/g)?.length === 3,
  "محرك الاحتساب يفضل الفصل النشط ويمنع اختيار فصل عشوائي عند التعارض",
);
check(
  academicServer.includes("activeLinksByCourseId") &&
    academicServer.includes("if (links.length !== 1) continue"),
  "مزامنة baseOpportunities لا تكتب قيمة عشوائية عند تعارض الفصول",
);
check(
  academicEngine.includes("historicalSettlementDate") &&
    academicEngine.includes("examEventDate <= historicalSettlementDate") &&
    academicRepair.includes('scope === "restore-excess-dismissed"') &&
    academicRepair.includes('action: "إعادة تعيين"') &&
    academicRepair.includes('startsWith: "تسوية تاريخية:"') &&
    !academicRepair.includes('grade.deleteMany'),
  "التسوية التاريخية تُبقي الدرجات محفوظة وتمنع أثرها الرجعي دون حذفها",
);
check(
  [opportunitiesView, registry, dismissed, followUp, profile, bulkImport].every(
    (source) => source.includes("formatOpportunityBalance"),
  ),
  "كل صفحات العرض الرئيسية تستخدم نفس منسق الرصيد والسقف",
);
check(
  opportunitiesView.includes("opportunityMode: true") &&
    registry.includes("opportunityMode: true") &&
    dismissed.includes("opportunityMode: true") &&
    followUp.match(/opportunityMode: true/g)?.length >= 2,
  "كل القوائم التي تعرض الفرص تطلب Snapshot الخادمي صراحة",
);

const failed = checks.filter((item) => !item.condition);
for (const item of checks) {
  console.log(`${item.condition ? "✅" : "❌"} ${item.message}`);
}
if (failed.length > 0) {
  console.error(`\nفشل ${failed.length} فحص/فحوصات في توحيد مصدر الفرص.`);
  process.exit(1);
}
console.log("\nكل اختبارات توحيد مصدر الفرص نجحت.");
