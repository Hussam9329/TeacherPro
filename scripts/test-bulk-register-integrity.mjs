import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
};

const bulkRoute = read('src/app/api/students/bulk/route.ts');
const bulkView = read('src/components/teacher-pro/student-bulk-text-import.tsx');
const api = read('src/lib/api.ts');
const packageJson = JSON.parse(read('package.json'));

assert(
  bulkRoute.includes('course?.active === false') && bulkRoute.includes('هذه الدورة موقوفة عن التسجيل حالياً'),
  'API التسجيل الجماعي يرفض الدورة الموقوفة عن التسجيل',
);
assert(
  bulkRoute.includes('activeLinks.length > 1') && bulkRoute.includes('أكثر من فصل نشط'),
  'API التسجيل الجماعي يرفض تعارض أكثر من فصل نشط للدورة',
);
assert(
  bulkRoute.includes('activeLinks.length === 0') && bulkRoute.includes('warnings.push') && bulkRoute.includes('الطالب سيُسجل بدون فرص'),
  'API التسجيل الجماعي لا يخفي حالة عدم وجود فصل نشط ويرجع تنبيه واضح',
);
assert(
  bulkRoute.includes('include:') && bulkRoute.includes('chapter: { select: { id: true, name: true, opportunities: true } }') && bulkRoute.includes('baseOpportunities: opportunities'),
  'فرص التسجيل الجماعي تُحسب من الفصل النشط في قاعدة البيانات لا من العميل',
);
assert(
  !bulkRoute.includes('const opportunities = activeChapterOppByCourseId.get(courseId) ?? 0') && !bulkRoute.includes('asText(payload.opportunities'),
  'API التسجيل الجماعي لا يستخدم opportunities/baseOpportunities المرسلة من الواجهة',
);
assert(
  bulkRoute.includes('duplicateConditions') && bulkRoute.includes('where: { OR: duplicateConditions }') && !bulkRoute.includes('select: { id: true, name: true, phone: true, telegram: true, code: true }'),
  'فحص التكرار في التسجيل الجماعي موجه بالمفاتيح الفريدة ولا يحمل كل الطلاب فقط للفحص',
);
assert(
  bulkRoute.includes('db.$transaction(async (tx)') && bulkRoute.includes('code: { startsWith: "BIO-" }') && bulkRoute.includes('nextCodeNumber'),
  'توليد أكواد الطلاب في التسجيل الجماعي يتم داخل transaction لتقليل تعارض الأكواد',
);
assert(
  bulkRoute.includes('source: "database"') && bulkRoute.includes('warnings'),
  'استجابة التسجيل الجماعي توضّح أنها من قاعدة البيانات وترجع تنبيهات الفرص',
);

assert(
  bulkView.includes('studentRegisterApi.context()') && bulkView.includes('StudentRegisterContextResponse'),
  'واجهة التسجيل الجماعي تحمل سياق الدورات والفصول من API قاعدة البيانات',
);
assert(
  !bulkView.includes('const { students, courses, loadFromServer') && !bulkView.includes('findCourse(courses,'),
  'واجهة التسجيل الجماعي لا تعتمد على كاش الدورات المحلي لبناء المعاينة',
);
assert(
  bulkView.includes('contextLoading') && bulkView.includes('contextError') && bulkView.includes('disabled={contextLoading || !registerContext}'),
  'زر المعاينة لا يعمل قبل تحميل سياق قاعدة البيانات بوضوح',
);
assert(
  bulkView.includes('course.active === false') && bulkView.includes('موقوفة عن التسجيل') && bulkView.includes('courseRow.activeChapterCount > 1'),
  'المعاينة تلتقط الدورة الموقوفة وتعارض الفصول قبل الإرسال',
);
assert(
  bulkView.includes('courseRow?.activeChapter') && bulkView.includes('تم تجاهل عمود الفرص') && !bulkView.includes('const opportunities = parseInteger(opportunitiesRaw, 0);'),
  'المعاينة توضّح أن فرص البداية من الفصل النشط وليس من عمود النص',
);
assert(
  bulkView.includes('فرص البداية') && bulkView.includes('في بيانات النظام') && bulkView.includes('التسجيل الجماعي لا يعتمد على عمود الفرص'),
  'واجهة التسجيل الجماعي تعرض مصدر فرص البداية للمستخدم بوضوح',
);
assert(
  packageJson.scripts?.['test:bulk-register-integrity'] === 'node scripts/test-bulk-register-integrity.mjs',
  'package.json يحتوي سكربت test:bulk-register-integrity',
);

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة التسجيل الجماعي. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة التسجيل الجماعي نجحت.');
