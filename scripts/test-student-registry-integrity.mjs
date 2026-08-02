import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const registry = read('src/components/teacher-pro/student-registry.tsx');
const registryResults = read('src/components/teacher-pro/student-registry-results.tsx');
const registryHelpers = read('src/components/teacher-pro/student-registry-helpers.ts');
const api = read('src/lib/api.ts');
const studentsRoute = read('src/app/api/students/route.ts');
const studentsExportRoute = read('src/app/api/students/export/route.ts');
const studentsStatsRoute = read('src/app/api/students/stats/route.ts');
const registryIssueHelper = read('src/lib/student-registry-issue-server.ts');
const registryFiltersHelper = read('src/lib/student-registry-filters-server.ts');
const studentListFilters = read('src/lib/student-list-filters.ts');
const opportunitySnapshots = read('src/lib/student-opportunity-snapshot-server.ts');
const exportDialog = read('src/components/teacher-pro/export-dialog.tsx');
const deleteImpact = read('src/lib/student-delete-impact.ts');
const statusRoutePath = path.join(root, 'src/app/api/students/status-action/route.ts');
const statusRoute = fs.existsSync(statusRoutePath) ? fs.readFileSync(statusRoutePath, 'utf8') : '';
const pkg = JSON.parse(read('package.json'));

const checks = [];
function check(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
}

const registryUi = `${registry}\n${registryResults}\n${registryHelpers}`;
check('سجل الطلاب يستخدم روابط واتساب ويب https://wa.me وليس whatsapp://', registryUi.includes('https://wa.me/') && !registryUi.includes('whatsapp://'));
check('سجل الطلاب يستخدم روابط تليكرام https://t.me وليس tg://', registryUi.includes('https://t.me/') && !registryUi.includes('tg://'));
check('تحميل سجل الطلاب يستخدم AbortController فعلياً لمنع رجوع نتائج قديمة', registry.includes('new AbortController()') && registry.includes('controller.abort()') && registry.includes('quietAbort: true'));
check('قائمة سجل الطلاب تطلب opportunityMode حتى تصل Badges الصحة من قاعدة البيانات', registry.includes('opportunityMode: true'));
check(
  'سجل الطلاب يعرض رصيد الفرص المحفوظ مثل صفحة المكالمات ولا يربطه بكاش الفصل المحلي',
  registryResults.includes('formatOpportunityBalance(student, { separator: " / " })') &&
    (registryResults.match(/formatOpportunityBalance\(student/g) || []).length >= 2 &&
    !registryResults.includes('activeChapterForCourse(student.courseId)'),
);
check('سجل الطلاب يملك فلتر صحة/مشاكل واضح', registry.includes('RegistryIssueFilter') && registry.includes('registryIssueFilterLabels') && registry.includes('filterRegistryIssue'));
check(
  'قائمة الطلاب والتصدير يشتركان في فلتر registryIssue نفسه من قاعدة البيانات',
  api.includes('registryIssue?: string') &&
    api.includes('registryIssue: query.registryIssue') &&
    studentsRoute.includes('buildStudentRegistryWhere(searchParams)') &&
    studentsExportRoute.includes('buildStudentRegistryWhere(searchParams)') &&
    registryFiltersHelper.includes('buildStudentRegistryIssueWhere(searchParams)') &&
    registryIssueHelper.includes('active-chapter-conflict') &&
    registryIssueHelper.includes('opportunity-over-limit'),
);
check(
  'القائمة والإحصائيات والتصدير تستخدم بحثاً وموقعاً موحدين',
  studentsRoute.includes('buildStudentRegistryWhere(searchParams)') &&
    studentsExportRoute.includes('buildStudentRegistryWhere(searchParams)') &&
    studentsStatsRoute.includes('buildStudentRegistrySearchWhere') &&
    studentsStatsRoute.includes('buildStudentRegistryLocationWhere') &&
    registryFiltersHelper.includes('buildStudentRegistrySearchWhere') &&
    registryFiltersHelper.includes('buildStudentRegistryLocationWhere') &&
    registryFiltersHelper.includes('{ name: { contains: query') &&
    registryFiltersHelper.includes('telegramKey: { startsWith: telegram'),
);
check(
  'الإجمالي العام يشمل المؤرشفين ولا يمكن أن يقل عن نتائج فلتر المؤرشفين',
  studentsStatsRoute.includes('db.student.count(),') &&
    studentsStatsRoute.includes('systemTotal') &&
    studentsStatsRoute.includes('scope: "all"'),
);
check(
  'صحة الفصل متبادلة: مفقود وتعارض وسقف صفر، والفرص الكاملة لا تشمل فوق السقف',
  registryIssueHelper.includes('studentRegistryNoActiveChapterWhere') &&
    registryIssueHelper.includes('zero-opportunity-limit') &&
    registryIssueHelper.includes('links.length > 1') &&
    registryIssueHelper.includes('registryIssue === "opportunity-full" ? cap') &&
    !registryIssueHelper.includes('registryIssue === "opportunity-full" ? { gte: cap }') &&
    opportunitySnapshots.includes('? current === opportunityLimit'),
);
check(
  'مواقع بغداد الفرعية ومرادفات المحافظات وأونلاين متاحة ومتطابقة',
  studentListFilters.includes('...BAGHDAD_COURSE_SITES') &&
    studentListFilters.includes('"ذي قار"') &&
    studentListFilters.includes('"الناصرية"') &&
    studentListFilters.includes('"الكتروني"') &&
    registryFiltersHelper.includes('getStudentFilterLocationAliases'),
);
check(
  'تصدير CSV وExcel يمنع تفسير بيانات الطالب كمعادلات spreadsheet',
  exportDialog.includes('function protectSpreadsheetCell') &&
    exportDialog.includes('/^\\s*[=+\\-@]/') &&
    exportDialog.includes('const str = protectSpreadsheetCell(value)') &&
    exportDialog.includes('return protectSpreadsheetCell(value)'),
);
check('تعديل الطالب في سجل الطلاب صار server-first عبر studentApi.update وليس updateStudent من الكاش', registry.includes('await studentApi.update(editDialog.id') && !registry.includes('const result = updateStudent('));
check('أرشفة الطالب في سجل الطلاب صارت server-first ومرتبطة ببصمة المعاينة', registry.includes('await studentApi.remove(deleteDialog.id, { previewToken })') && registry.includes('deleteImpact?.previewToken') && !registry.includes('const ok = deleteStudent('));
check('إجراءات الفصل/إعادة التفعيل لا تستدعي store optimistic القديم من سجل الطلاب', !registry.includes('dismissStudent(') && !registry.includes('reactivateStudent('));
check('يوجد API status-action لإجراءات حالة الطالب الحساسة', statusRoute.includes('export async function POST') && (statusRoute.includes('db.$transaction') || statusRoute.includes('withSerializableTransaction')) && statusRoute.includes('studentNote.create') && statusRoute.includes('opportunityLog.create'));
check('إجراءات حالة الطالب تتحقق من Snapshot الواجهة داخل المعاملة', statusRoute.includes('assertExpectedStudentSnapshot(') && statusRoute.includes('stale-student-snapshot') && statusRoute.includes('already-active'));
check('واجهة سجل الطلاب تستدعي statusAction للفصل وإعادة التفعيل من الخادم', api.includes('statusAction') && registry.includes('studentApi.statusAction') && registry.includes('action: "dismiss"') && (registry.includes('action: "reactivate"') || registry.includes('isArchived ? "restore" : "reactivate"')));
check('الواجهة توقف التعديل والفصل والأرشفة عند عرض نسخة محلية مؤقتة', registry.includes('registryServerUnavailable') && registry.includes('لا يمكن أرشفة طالب أثناء عرض نسخة محلية مؤقتة') && registry.includes('لا يمكن فصل طالب أثناء عرض نسخة محلية مؤقتة'));
check('أرشفة الطالب في API محفوظة داخل transaction ومقيدة ببصمة علاقاتها', studentsRoute.includes('withSerializableTransaction') && studentsRoute.includes('previewToken !== impact.previewToken') && deleteImpact.includes('buildMutationPreviewToken') && studentsRoute.includes('studentNote.create') && studentsRoute.includes('auditLog.create'));
check('الأرشفة لا تستبدل سبب الفصل السابق', !studentsRoute.includes('dismissalReason: "أرشفة إدارية"'));
check(
  'واجهة السجل تحفظ الفلاتر والصفحة والعرض وتعرض خطأ العدادات مع إعادة المحاولة',
  registry.includes('hydratedRegistryStorageKey') &&
    registry.includes('registryStateStorageKey') &&
    registry.includes('studentStatsError') &&
    registry.includes('setStudentStatsRefreshKey') &&
    registry.includes('setFilterRegistryIssue("no-active-chapter")') &&
    registry.includes('hasActiveRegistryFilters'),
);
check('اختبار سجل الطلاب مضاف إلى package.json', pkg.scripts?.['test:student-registry-integrity'] === 'node scripts/test-student-registry-integrity.mjs');
check('اختبار side-effects يشمل سجل الطلاب أيضاً', String(pkg.scripts?.['test:side-effects'] || '').includes('test:student-registry-integrity'));

let failed = 0;
for (const item of checks) {
  if (item.ok) {
    console.log(`✅ ${item.label}`);
  } else {
    failed += 1;
    console.error(`❌ ${item.label}`);
  }
}

if (failed) {
  console.error('\nفشل اختبار سلامة سجل الطلاب. راجع الرسائل أعلاه.');
  process.exit(1);
}
console.log('\nكل اختبارات سلامة سجل الطلاب نجحت.');
