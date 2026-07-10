import fs from 'node:fs';

const files = {
  chaptersView: 'src/components/teacher-pro/chapters.tsx',
  chaptersOverview: 'src/app/api/chapters/overview/route.ts',
  chaptersRoute: 'src/app/api/chapters/route.ts',
  courseChaptersRoute: 'src/app/api/course-chapters/route.ts',
  activateRoute: 'src/app/api/course-chapters/activate/route.ts',
  fixZeroRoute: 'src/app/api/students/fix-zero-opportunities/route.ts',
  api: 'src/lib/api.ts',
  packageJson: 'package.json',
};

const read = (file) => fs.readFileSync(file, 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
};

const chaptersView = read(files.chaptersView);
const chaptersOverview = read(files.chaptersOverview);
const chaptersRoute = read(files.chaptersRoute);
const courseChaptersRoute = read(files.courseChaptersRoute);
const activateRoute = read(files.activateRoute);
const fixZeroRoute = read(files.fixZeroRoute);
const api = read(files.api);
const packageJson = read(files.packageJson);

assert(
  chaptersOverview.includes("source: 'database'") && chaptersOverview.includes('db.course.findMany') && chaptersOverview.includes('db.student.findMany') && chaptersOverview.includes('db.courseChapter.findMany') && chaptersOverview.includes('db.opportunityLog.findMany'),
  'تبويبة الفصول تملك API ملخص من قاعدة البيانات يشمل الدورات والطلاب والروابط وسجلات الفرص',
);
assert(
  chaptersOverview.includes('deleteSafety') && chaptersOverview.includes('canDelete') && chaptersOverview.includes('blockers') && chaptersOverview.includes('archiveCount'),
  'API الفصول يرجع حالة حذف آمنة وأرشيف الربط وأسباب المنع من قاعدة البيانات',
);
assert(
  chaptersOverview.includes('coursesWithMultipleActiveChapters') && chaptersOverview.includes('coursesWithoutActiveChapter') && chaptersOverview.includes('studentsZeroZeroWithActive') && chaptersOverview.includes('studentsAboveChapterCap'),
  'API الفصول يرجع مؤشرات الصحة: بلا فصل نشط، أكثر من فصل نشط، 0/0، وفوق السقف',
);
assert(
  api.includes('ChapterOverviewResponse') && api.includes('overview: (options: ApiGetOptions = {})') && api.includes('chapters/overview'),
  'طبقة API الأمامية تدعم ملخص الفصول مع AbortController',
);
assert(
  api.includes('add: (chapter: { name: string; opportunities: number })') && !api.includes('add: (chapter: { id: string; name: string; opportunities: number })'),
  'إضافة الفصل لا تطلب ID محلي وهمي من الواجهة',
);
assert(
  api.includes('courseChapterApi') && api.includes('add: (cc: {') && api.includes('courseId: string;') && api.includes('chapterId: string;') && !api.includes('id: string;\n    courseId: string;\n    chapterId: string;\n    active: boolean'),
  'ربط الفصل بالدورة لا يرسل ID محلي أو حالة تفعيل وهمية',
);
assert(
  api.includes('activate: (') && api.includes('course-chapters/activate') && api.includes('confirmImpact'),
  'تفعيل/إلغاء الفصل له API خاص يتطلب تأكيد أثر العملية',
);
assert(
  activateRoute.includes('db.$transaction') && activateRoute.includes('updateMany') && activateRoute.includes('active: false') && activateRoute.includes('recalculateStudentsAcademicState'),
  'تفعيل الفصل يتم server-first داخل transaction ويعطل الفصول الأخرى ويعيد الاحتساب',
);
assert(
  activateRoute.includes('buildArchive(nonArchivedStudents)') && activateRoute.includes("status !== 'مؤرشف'") && activateRoute.includes("status !== 'مفصول'"),
  'الأرشفة وتحديث الفرص تتم من قاعدة البيانات وتستثني المؤرشفين وتتعامل مع المفصولين بوضوح',
);
assert(
  courseChaptersRoute.includes('updateMany({') && courseChaptersRoute.includes('id: { not: String(id) }') && courseChaptersRoute.includes('active: false'),
  'مسار تحديث ربط الفصل يمنع بقاء أكثر من فصل نشط لنفس الدورة حتى للنداءات القديمة',
);
assert(
  courseChaptersRoute.includes('parseArchiveEntries(link.archive)') && courseChaptersRoute.includes('confirmImpact') && courseChaptersRoute.includes('أرشيف فرص'),
  'حذف ربط الفصل محمي إذا كان مفعلًا أو يحمل أرشيف فرص',
);
assert(
  chaptersRoute.includes('linkedCourseChapters') && chaptersRoute.includes('linkedOpportunityLogs') && !chaptersRoute.includes('await tx.courseChapter.deleteMany({ where: { chapterId: id } })'),
  'حذف الفصل لا يمسح روابطه بصمت ولا يحذف تاريخ الفرص بدون فحص أثر',
);
assert(
  chaptersView.includes('chapterApi.overview') && chaptersView.includes('new AbortController()') && chaptersView.includes('controller.abort()') && chaptersView.includes('quietAbort: true'),
  'صفحة الفصول تلغي طلبات التحميل القديمة ولا تعتمد على طلبات متداخلة',
);
assert(
  chaptersView.includes('const { loadSectionDataFromServer } = useTeacherStore();') && !chaptersView.includes('addChapter,') && !chaptersView.includes('toggleChapter,') && !chaptersView.includes('deleteCourseChapter,'),
  'صفحة الفصول لا تبني عملياتها من كاش Zustand القديم',
);
assert(
  chaptersView.includes('courseChapterApi.activate') && chaptersView.includes('تنفيذ بعد معاينة الأثر') && chaptersView.includes('server-first'),
  'تفعيل وإلغاء الفصل في الواجهة يتم بعد معاينة أثر واضحة وبطلب server-first',
);
assert(
  chaptersView.includes('deleteSafety.canDelete') && chaptersView.includes('محمي من الحذف') && chaptersView.includes('أرشيف'),
  'الواجهة تعرض حماية الحذف وأسباب منع حذف الفصل أو الربط',
);
assert(
  chaptersView.includes('renderLoadingSkeleton') && chaptersView.includes('animate-pulse'),
  'صفحة الفصول تملك Skeleton Loading واضح وسلس',
);
assert(
  chaptersView.includes('searchText') && chaptersView.includes('courseFilter') && chaptersView.includes('chapterFilter') && chaptersView.includes('تصفير الفلاتر'),
  'صفحة الفصول تملك بحث وفلاتر مفهومة للدورات والفصول',
);
assert(
  chaptersView.includes('معاينة وإصلاح') && chaptersView.includes('/api/students/fix-zero-opportunities') && chaptersView.includes('الطلاب النشطين فقط'),
  'إصلاح فرص 0/0 صار بعد معاينة ويشرح أنه للطلاب النشطين فقط',
);
assert(
  fixZeroRoute.includes("status: 'نشط'") && fixZeroRoute.includes('Archived/dismissed students are skipped'),
  'إصلاح 0/0 يستثني المفصولين والمؤرشفين ولا يعيد لهم فرصاً بالخطأ',
);
assert(
  packageJson.includes('"test:chapters-integrity"'),
  'يوجد أمر اختبار خاص بسلامة تبويبة الفصول داخل package.json',
);

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة تبويبة الفصول والفرص. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة تبويبة الفصول والفرص نجحت.');
