import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const registry = read('src/components/teacher-pro/student-registry.tsx');
const api = read('src/lib/api.ts');
const studentsRoute = read('src/app/api/students/route.ts');
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
    registry.includes('const base = Number(student.baseOpportunities || 0)') &&
    (registry.match(/registryOpportunityText\(student\)/g) || []).length >= 2 &&
    !registry.includes('activeChapterForCourse(student.courseId)'),
);
check('سجل الطلاب يملك فلتر صحة/مشاكل واضح', registry.includes('RegistryIssueFilter') && registry.includes('registryIssueFilterLabels') && registry.includes('filterRegistryIssue'));
check('API الطلاب يدعم registryIssue كفلتر قاعدة بيانات لا كفلتر كاش فقط', api.includes('registryIssue?: string') && api.includes('registryIssue: query.registryIssue') && studentsRoute.includes('buildRegistryIssueWhere'));
check('تعديل الطالب في سجل الطلاب صار server-first عبر studentApi.update وليس updateStudent من الكاش', registry.includes('await studentApi.update(editDialog.id') && !registry.includes('const result = updateStudent('));
check('أرشفة الطالب في سجل الطلاب صارت server-first عبر studentApi.remove وليس deleteStudent من الكاش', registry.includes('await studentApi.remove(deleteDialog.id)') && !registry.includes('const ok = deleteStudent('));
check('إجراءات الفصل/إعادة التفعيل لا تستدعي store optimistic القديم من سجل الطلاب', !registry.includes('dismissStudent(') && !registry.includes('reactivateStudent('));
check('يوجد API status-action لإجراءات حالة الطالب الحساسة', statusRoute.includes('export async function POST') && statusRoute.includes('db.$transaction') && statusRoute.includes('studentNote.create') && statusRoute.includes('opportunityLog.create'));
check('واجهة سجل الطلاب تستدعي statusAction للفصل وإعادة التفعيل من الخادم', api.includes('statusAction') && registry.includes('studentApi.statusAction') && registry.includes('action: "dismiss"') && registry.includes('action: "reactivate"'));
check('الواجهة توقف التعديل والفصل والأرشفة عند عرض نسخة محلية مؤقتة', registry.includes('registryServerUnavailable') && registry.includes('لا يمكن أرشفة طالب أثناء عرض نسخة محلية مؤقتة') && registry.includes('لا يمكن فصل طالب أثناء عرض نسخة محلية مؤقتة'));
check('أرشفة الطالب في API محفوظة داخل transaction مع ملاحظة و audit log', studentsRoute.includes('db.$transaction') && studentsRoute.includes('studentNote.create') && studentsRoute.includes('auditLog.create'));
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
