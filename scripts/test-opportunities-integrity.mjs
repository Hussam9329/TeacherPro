import fs from 'fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const checks = [];
const check = (condition, message) => checks.push({ condition, message });

const opportunitiesView = read('src/components/teacher-pro/opportunities.tsx');
const exportDialog = read('src/components/teacher-pro/export-dialog.tsx');
const apiLayer = read('src/lib/api.ts');
const studentRoute = read('src/app/api/students/route.ts');
const statsRoute = read('src/app/api/opportunities/stats/route.ts');
const bulkTargetsRoute = read('src/app/api/opportunities/bulk-targets/route.ts');
const bulkAdjustRoute = read('src/app/api/opportunities/bulk-adjust/route.ts');
const bulkPreviewServer = read('src/lib/bulk-opportunity-preview-server.ts');
const studentActionRoute = read('src/app/api/opportunities/student-action/route.ts');
const opportunityLogsRoute = read('src/app/api/opportunity-logs/route.ts');
const opportunitySnapshotServer = read('src/lib/student-opportunity-snapshot-server.ts');
const opportunityBalance = read('src/lib/opportunity-balance.ts');
const academicEngine = read('src/lib/academic-engine.ts');
const teacherStore = read('src/lib/teacher-store.ts');
const gradeEntry = read('src/components/teacher-pro/grade-entry.tsx');
const gradeRecords = read('src/components/teacher-pro/grade-records.tsx');
const gradeExportRoute = read('src/app/api/grades/export/route.ts');
const packageJson = read('package.json');

check(
  opportunitiesView.includes('opportunityMode: true'),
  'صفحة إدارة الفرص تطلب Snapshot الفصل النشط من الخادم مع كل طالب',
);
check(
  opportunitiesView.includes('opportunityStatsApi.studentAction') &&
    !opportunitiesView.includes('adjustOpportunities,') &&
    !opportunitiesView.includes('resetOpportunities,') &&
    !opportunitiesView.includes('undoOpportunityLog,'),
  'الإجراءات الفردية لم تعد تعتمد على كاش Zustand وتستخدم API خادمي آمن',
);
check(
  opportunitiesView.includes('hasSingleServerActiveChapter') &&
    opportunitiesView.includes('activeChapterConflictCount'),
  'الواجهة تكشف غياب/تعارض الفصل النشط ولا تفتح إجراءات خطرة بلا فصل صالح',
);
check(
  opportunitiesView.includes('opportunityLogApi') &&
    opportunitiesView.includes('studentId: detailsStudentId'),
  'تفاصيل الطالب تجلب سجل الفرص من قاعدة البيانات حسب الطالب ولا تكتفي بسجل الصفحة الحالي',
);
check(
  studentActionRoute.includes('withSerializableTransaction') &&
    studentActionRoute.includes('recalculateStudentsAcademicState') &&
    studentActionRoute.includes('getSingleActiveChapterForCourse') &&
    studentActionRoute.includes('writeRequestAuditLog'),
  'API الإجراء الفردي يحفظ الحركة داخل transaction ويعيد الاحتساب ويسجل Audit',
);
check(
  studentActionRoute.includes('activeLinks.length > 1') &&
    studentActionRoute.includes('لا يمكن تعديل الفرص لأن هذه الدورة تحتوي على أكثر من فصل نشط'),
  'الخادم يمنع تعديل الفرص عند وجود أكثر من فصل نشط لنفس الدورة',
);
check(
  apiLayer.includes('studentAction: (payload') &&
    apiLayer.includes('opportunities/student-action'),
  'طبقة API الأمامية تدعم إجراءات الفرص الفردية server-first',
);
check(
  studentRoute.includes('"opportunities.view"') &&
    studentRoute.includes('opportunityMode') &&
    studentRoute.includes('attachStudentOpportunitySnapshots') &&
    opportunitySnapshotServer.includes('activeChapterConflictCount') &&
    opportunitySnapshotServer.includes('isOpportunityOverLimit'),
  'API الطلاب يدعم وضع إدارة الفرص ويرجع حالة الفصل والسقف من المصدر الموحد',
);
check(
  statsRoute.includes('noActiveChapterWhere') &&
    statsRoute.includes('activeChapterConflicts') &&
    statsRoute.includes('overLimit') &&
    statsRoute.includes('fullOpportunities') &&
    statsRoute.includes('belowFullOpportunities'),
  'إحصائيات إدارة الفرص تعرض مشاكل المحرك: بلا فصل، تعارض، فرص كاملة، فرص ناقصة، فوق السقف',
);
check(
  bulkTargetsRoute.includes('buildBulkOpportunityPreview') &&
    bulkAdjustRoute.includes('buildBulkOpportunityPreview') &&
    bulkPreviewServer.includes('attachStudentOpportunitySnapshotsWithClient') &&
    bulkPreviewServer.includes('opportunityHealth === "ready"') &&
    bulkPreviewServer.includes('student.isOpportunityFull') &&
    !bulkPreviewServer.includes('fullOpportunityLimitForStudent'),
  'معاينة العملية الجماعية تستخدم نفس Snapshot الفصل النشط ولا تعتمد على الأساس المخزن',
);
check(
  bulkAdjustRoute.includes('mode === "filter"') &&
    bulkAdjustRoute.includes('recalculateStudentsAcademicState') &&
    bulkAdjustRoute.includes('confirmImpact'),
  'التنفيذ الجماعي يطبق على كل المطابقين من قاعدة البيانات مع إعادة احتساب وتأكيد أثر',
);
check(
  opportunityLogsRoute.includes("studentId = String(searchParams.get('studentId')") &&
    opportunityLogsRoute.includes('include:') &&
    opportunityLogsRoute.includes('student: { select:'),
  'سجل الفرص يدعم جلب سجل طالب محدد مع بيانات الطالب والامتحان',
);

check(
  opportunitiesView.includes('statsBelowFullOpportunities') &&
    opportunitiesView.includes('طلاب فرصهم المحفوظة ناقصة') &&
    opportunitiesView.includes('طلاب بلا فصل نشط') &&
    opportunitiesView.includes('طلاب ضمن تعارض فصول'),
  'واجهة إدارة الفرص تعرض بطاقة الفرص الناقصة وتوضح أن مشاكل الفصول تخص الدورات لا الطلاب',
);

check(
  opportunitySnapshotServer.includes('Current balance always comes from Student.opportunities') &&
    opportunitySnapshotServer.includes('const opportunityLimit = activeChapter?.opportunities ?? null') &&
    opportunitySnapshotServer.includes('attachStudentOpportunitySnapshotsWithClient'),
  'عقدة الفرص الموحدة تثبت أن الرصيد من الطالب والسقف من الفصل النشط وتعمل داخل transaction',
);
check(
  opportunityBalance.includes('formatOpportunityBalance') &&
    opportunityBalance.includes('Object.prototype.hasOwnProperty.call(source, "opportunityLimit")'),
  'منسق العرض الموحد يحترم السقف الخادمي الصريح ولا يخفي الرصيد عند غياب السقف',
);

check(
  opportunityBalance.includes('dismissalTrigger: penalty > 0 && before === 0') &&
    academicEngine.includes('applyOpportunityPenalty') &&
    academicEngine.includes('hasZeroBalanceViolationMarker') &&
    bulkAdjustRoute.includes('ZERO_BALANCE_VIOLATION_MARKER') &&
    !academicEngine.includes('dismissalType'),
  'قانون الفرص موحد: الوصول إلى صفر لا يفصل، والفصل فقط عند عقوبة جديدة تبدأ والرصيد صفر',
);
check(
  teacherStore.includes('manualPenaltyEffect?.dismissalTrigger') &&
    teacherStore.includes('penaltyEffectsByStudentId.get(student.id)?.dismissalTrigger'),
  'الخصم اليدوي الفردي والجماعي يستخدم رصيد ما قبل الحدث ولا يفصل عند مجرد الوصول إلى صفر',
);
check(
  gradeEntry.includes('applyOpportunityPenalty') &&
    gradeRecords.includes('applyOpportunityPenalty') &&
    gradeExportRoute.includes('بدون فرص، غير مفصول'),
  'تحذيرات تعديل الدرجات والتصدير تعرض نفس قانون الصفر بدون تنبؤ فصل خاطئ',
);

check(
  exportDialog.includes('GRACE_DEFERRED_REPORT_STATUS = "لا يحاسب الطالب ( ضمن فترة السماح )"') &&
    exportDialog.includes('"درجة مؤجلة خلال فترة السماح"') &&
    exportDialog.includes('"درجة مؤجلة خلال فترة سماح الطالب"') &&
    exportDialog.includes('String(grade.status || "").trim() !== "درجة"') &&
    exportDialog.includes('const { notes: _notes, ...reportGrade } = grade'),
  'تقرير HTML يحول فقط حالة «درجة» المؤجلة خلال السماح، ويتعرف على صيغتي النظام ولا يحقن الملاحظات في الملف',
);
check(
  !exportDialog.includes('<th>ملاحظات</th>') &&
    !exportDialog.includes("+ '<td>' + esc(g.notes) + '</td>'") &&
    exportDialog.includes('colspan="6"'),
  'تفاصيل تقرير HTML لا تحتوي عمود الملاحظات وتستخدم عدد الأعمدة الصحيح بعد حذفه',
);

check(
  packageJson.includes('test:opportunities-integrity'),
  'يوجد أمر اختبار خاص بسلامة تبويبة إدارة الفرص داخل package.json',
);

const failed = checks.filter((item) => !item.condition);
for (const item of checks) {
  console.log(`${item.condition ? '✅' : '❌'} ${item.message}`);
}

if (failed.length > 0) {
  console.error(`\nفشل ${failed.length} فحص/فحوصات في سلامة إدارة الفرص.`);
  process.exit(1);
}

console.log('\nكل اختبارات سلامة تبويبة إدارة الفرص نجحت.');
