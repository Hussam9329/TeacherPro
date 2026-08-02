import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const registry = read('src/components/teacher-pro/student-registry.tsx');
const api = read('src/lib/api.ts');
const studentsRoute = read('src/app/api/students/route.ts');
const studentsExportRoute = read('src/app/api/students/export/route.ts');
const registryIssueHelper = read('src/lib/student-registry-issue-server.ts');
const exportDialog = read('src/components/teacher-pro/export-dialog.tsx');
const deleteImpact = read('src/lib/student-delete-impact.ts');
const statusRoutePath = path.join(root, 'src/app/api/students/status-action/route.ts');
const statusRoute = fs.existsSync(statusRoutePath) ? fs.readFileSync(statusRoutePath, 'utf8') : '';
const pkg = JSON.parse(read('package.json'));

const checks = [];
function check(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
}

check('سجل الطلاب يستخدم روابط واتساب ويب https://wa.me وليس whatsapp://', registry.includes('https://wa.me/') && !registry.includes('whatsapp://'));
check('سجل الطلاب يستخدم روابط تليكرام https://t.me وليس tg://', registry.includes('https://t.me/') && !registry.includes('tg://'));
check('تحميل سجل الطلاب يستخدم AbortController فعلياً لمنع رجوع نتائج قديمة', registry.includes('new AbortController()') && registry.includes('controller.abort()') && registry.includes('quietAbort: true'));
check('قائمة سجل الطلاب تطلب opportunityMode حتى تصل Badges الصحة من قاعدة البيانات', registry.includes('opportunityMode: true'));
check(
  'سجل الطلاب يعرض رصيد الفرص المحفوظ مثل صفحة المكالمات ولا يربطه بكاش الفصل المحلي',
  registry.includes('function registryOpportunityText(student: Student)') &&
    registry.includes('formatOpportunityBalance(student, { separator: " / " })') &&
    (registry.match(/registryOpportunityText\(student\)/g) || []).length >= 2 &&
    !registry.includes('activeChapterForCourse(student.courseId)'),
);
check('سجل الطلاب يملك فلتر صحة/مشاكل واضح', registry.includes('RegistryIssueFilter') && registry.includes('registryIssueFilterLabels') && registry.includes('filterRegistryIssue'));
check(
  'قائمة الطلاب والتصدير يشتركان في فلتر registryIssue نفسه من قاعدة البيانات',
  api.includes('registryIssue?: string') &&
    api.includes('registryIssue: query.registryIssue') &&
    studentsRoute.includes('buildStudentRegistryIssueWhere(searchParams)') &&
    studentsExportRoute.includes('buildStudentRegistryIssueWhere(searchParams)') &&
    registryIssueHelper.includes('active-chapter-conflict') &&
    registryIssueHelper.includes('opportunity-over-limit'),
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
