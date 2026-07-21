import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (label, condition) => checks.push({ label, ok: Boolean(condition) });

const studentsRoute = read("src/app/api/students/route.ts");
const studentImpactRoute = read("src/app/api/students/update-impact/route.ts");
const studentRegistry = read("src/components/teacher-pro/student-registry.tsx");
const coursesRoute = read("src/app/api/courses/route.ts");
const coursesView = read("src/components/teacher-pro/courses.tsx");
const chaptersRoute = read("src/app/api/chapters/route.ts");
const chaptersView = read("src/components/teacher-pro/chapters.tsx");
const courseChapterAction = read("src/app/api/course-chapters/activate/route.ts");
const bulkAdjust = read("src/app/api/opportunities/bulk-adjust/route.ts");
const bulkTargets = read("src/app/api/opportunities/bulk-targets/route.ts");
const bulkPreview = read("src/lib/bulk-opportunity-preview-server.ts");
const opportunitiesView = read("src/components/teacher-pro/opportunities.tsx");
const examsRoute = read("src/app/api/exams/route.ts");
const examsView = read("src/components/teacher-pro/exam-records.tsx");
const api = read("src/lib/api.ts");
const outbox = read("src/lib/mutation-outbox.ts");
const replayPolicy = read("src/lib/mutation-replay-policy.ts");
const courseOverview = read("src/app/api/courses/overview/route.ts");
const academicEngine = read("src/lib/academic-engine.ts");
const academicGradeWriteback = read("src/lib/academic-grade-writeback-server.ts");
const studentLeavesRoute = read("src/app/api/student-leaves/route.ts");
const gradesRoute = read("src/app/api/grades/route.ts");
const gradeRecords = read("src/components/teacher-pro/grade-records.tsx");
const gradeEntry = read("src/components/teacher-pro/grade-entry.tsx");
const opportunityLogsRoute = read("src/app/api/opportunity-logs/route.ts");
const teacherStore = read("src/lib/teacher-store.ts");
const pkg = JSON.parse(read("package.json"));
const academicExamSnapshotSource = examsRoute.slice(
  examsRoute.indexOf("function academicExamSnapshot"),
  examsRoute.indexOf("function hasAcademicExamChange"),
);

check(
  "معاينة الطالب والحفظ يستخدمان تاريخ بدء السماح نفسه ولا يعيدان توليد اليوم عند التنفيذ",
  studentRegistry.includes("academicImpactPreviewGraceStartDate") &&
    studentsRoute.includes("academicImpactPreviewGraceStartDate") &&
    studentsRoute.includes("? academicImpactPreviewGraceStartDate"),
);
check(
  "Token أثر الطالب يُبنى ويُراجع داخل SERIALIZABLE transaction",
  studentImpactRoute.includes("withSerializableTransaction") &&
    studentsRoute.includes("withSerializableTransaction") &&
    studentsRoute.includes("currentPreviewToken !== academicImpactPreviewToken"),
);
check(
  "كل تعديل طالب يحمل fingerprint للسجل ويُرفض عند تعديل متزامن",
  studentsRoute.includes("studentMutationToken") &&
    studentsRoute.includes("rawExpectedMutationToken") &&
    studentsRoute.includes("تغير سجل الطالب بعد فتحه للتعديل") &&
    studentRegistry.includes("expectedMutationToken: editOriginalStudent?.mutationToken"),
);
check(
  "تعديل حقول الطالب العادية لا يعيد تشغيل إعادة الاحتساب الأكاديمي",
  studentsRoute.includes("transactionAcademicInputsChanged") &&
    studentsRoute.includes("if (!transactionResetEnrollment && transactionAcademicInputsChanged)"),
);
check(
  "تعديل سبب/ملاحظات الإجازة لا يسترجع ويحذف الدرجات أو يعيد الاحتساب",
  studentLeavesRoute.includes("leaveAcademicScopeKey") &&
    studentLeavesRoute.includes("if (!academicScopeChanged)") &&
    studentLeavesRoute.includes("academicRecalculation: null") &&
    (studentLeavesRoute.match(/withSerializableTransaction/g) || []).length >= 4,
);
check(
  "تعديل الدرجة يحمل updatedAt ويُرفض عند تعديل متزامن قبل أي كتابة",
  gradesRoute.includes("GradeWriteConflictError") &&
    gradesRoute.includes("freshTargetGrade.updatedAt.toISOString()") &&
  gradesRoute.includes("requiresFreshGrade: true") &&
    gradeRecords.includes("expectedUpdatedAt: grade.updatedAt") &&
    gradeRecords.includes("expectedUpdatedAt: currentGrade?.updatedAt") &&
    gradeEntry.includes("expectedUpdatedAt: currentGrade?.updatedAt") &&
    gradeEntry.includes("expectMissing: !currentGrade") &&
    gradesRoute.includes("expectMissing && existingGrade"),
);
check(
  "Store الدرجات يحافظ على updatedAt كاملاً حتى لا ينتج تعارض 409 وهمي",
  teacherStore.includes("const preserveGradeTimestamp") &&
    teacherStore.includes("updatedAt: preserveGradeTimestamp(g.updatedAt)") &&
    !teacherStore.includes("updatedAt: g.updatedAt\n      ? baghdadDateKey"),
);

check(
  "معاينة إعدادات الدورة والحفظ مرتبطان بنفس token وsnapshot الطلاب",
  coursesRoute.includes('buildMutationPreviewToken("course-config-update"') &&
    coursesRoute.includes("currentPreviewState.previewToken") &&
    coursesView.includes("preview.previewToken"),
);
check(
  "معاينة سقف فرص الفصل والحفظ مرتبطان بنفس token",
  chaptersRoute.includes('buildMutationPreviewToken("chapter-opportunity-update"') &&
    chaptersRoute.includes("previewToken !== currentImpact.previewToken") &&
    chaptersView.includes("preview.previewToken"),
);
check(
  "تفعيل وإلغاء تفعيل فصل الدورة يعيدان بناء المعاينة داخل transaction قبل أي كتابة",
  courseChapterAction.includes('buildMutationPreviewToken("course-chapter-action"') &&
    courseChapterAction.includes("currentPreview.previewToken !== previewToken") &&
    courseChapterAction.includes("withSerializableTransaction"),
);
check(
  "عملية الفرص الجماعية تشارك builder واحداً بين GET preview وPOST execution",
  bulkTargets.includes("buildBulkOpportunityPreview") &&
    bulkAdjust.includes("buildBulkOpportunityPreview") &&
    bulkPreview.includes('buildMutationPreviewToken("bulk-opportunity-adjust"') &&
    opportunitiesView.includes("previewToken: bulkTargetStats?.previewToken"),
);
check(
  "حذف حركة فرص مؤثرة مرتبط بـsnapshot أكاديمي ويُراجع داخل transaction",
  opportunityLogsRoute.includes("buildOpportunityLogDeletePreview") &&
    opportunityLogsRoute.includes("buildStudentAcademicImpactToken") &&
    opportunityLogsRoute.includes("submittedPreviewToken !== preview.previewToken") &&
    opportunityLogsRoute.includes("withSerializableTransaction"),
);
check(
  "تغير نطاق أو رصيد فعلي بعد المعاينة يرفض بـ409 قبل كتابة الفرص الجماعية",
  bulkAdjust.includes("submittedPreviewToken !== previewToken") &&
    bulkAdjust.includes("requiresFreshPreview: true") &&
    bulkAdjust.includes("{ status: 409 }"),
);

check(
  "تأكيد تفعيل الامتحان مرتبط بعدد ونسخة الدرجات لا بقيمة boolean عامة",
  examsRoute.includes("activationPreviewToken") &&
    examsRoute.includes("storedGrades") &&
    examsRoute.includes('buildMutationPreviewToken(`exam-activation:${id}`') &&
    examsView.includes("updateExamWithActivationConfirmation") &&
    !examsView.includes("confirmExistingGrades:"),
);
check(
  "كل تعديل امتحان من الواجهة يحمل optimistic snapshot ويُرفض إذا تغير السجل",
  examsRoute.includes("expectedMutationToken") &&
    examsRoute.includes("currentMutationToken") &&
    examsRoute.includes("requiresFreshExam: true") &&
    examsView.includes("expectedMutationToken:") &&
    examsView.includes("?.mutationToken"),
);
check(
  "إعادة تسمية الامتحان لا تعيد حساب الأرصدة والحالة الأكاديمية",
  !academicExamSnapshotSource.includes("name:"),
);
check(
  "استجابة PUT تحفظ تفاصيل 409 حتى تستطيع الواجهة تأكيد snapshot الخادم",
  api.includes("const errorData = await res.clone().json()") &&
    api.includes("data: errorData"),
);

check(
  "حذف الامتحان والدورة والفصل يفحص العلاقات ويحذف داخل SERIALIZABLE transaction واحدة",
  (examsRoute.match(/withSerializableTransaction/g) || []).length >= 2 &&
    (coursesRoute.match(/withSerializableTransaction/g) || []).length >= 3 &&
    (chaptersRoute.match(/withSerializableTransaction/g) || []).length >= 2,
);
check(
  "حذف الدورة محمي من إسقاط أرصدة فصول مؤرشفة",
  coursesRoute.includes("archivedBalances") &&
    courseOverview.includes("chapterStats.archivedBalances"),
);

check(
  "الطلب غير idempotent أو المحمي بـtoken لا يُعاد عند نتيجة اتصال مجهولة",
  replayPolicy.includes('if (method === "DELETE") return false') &&
    replayPolicy.includes('"expectedMutationToken"') &&
    replayPolicy.includes("if (hasGuard) return false") &&
    api.includes("outcomeUnknown: true") &&
    outbox.includes("item.endpoint, item.method, item.payload"),
);
check(
  "طلبات outbox المرفوضة لا تُحذف بصمت بل تُحفظ كسجل فشل ويُعلن التعارض",
  outbox.includes("FAILED_OUTBOX_KEY") &&
    outbox.includes("recordFailedMutation") &&
    outbox.includes("announceTeacherProSyncError"),
);

check(
  "منطق اليوم الأكاديمي يستخدم مفاتيح تاريخ بغداد في المحرك والـStore",
  academicEngine.includes("return baghdadTodayKey()") &&
    academicEngine.includes("return baghdadDateKey(value)") &&
    academicEngine.includes("const gradeEventDate = dayKey(") &&
    academicGradeWriteback.includes("const key = baghdadDateKey(value)") &&
    teacherStore.includes("function dayKey(") &&
    teacherStore.includes("return baghdadDateKey(value)"),
);
check(
  "اختبار توافق preview/save داخل مجموعة اختبارات سلامة النظام",
  pkg.scripts?.["test:preview-save-consistency-integrity"] ===
    "node scripts/test-preview-save-consistency-integrity.mjs" &&
    String(pkg.scripts?.["test:side-effects"] || "").includes(
      "test:preview-save-consistency-integrity",
    ),
);

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`✅ ${item.label}`);
  else {
    failed += 1;
    console.error(`❌ ${item.label}`);
  }
}

if (failed) {
  console.error(`\nفشل ${failed} من اختبارات توافق المعاينة والحفظ.`);
  process.exit(1);
}
console.log("\nكل اختبارات توافق المعاينة والحفظ نجحت.");
