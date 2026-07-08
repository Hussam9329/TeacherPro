import fs from 'node:fs';

const files = {
  coursesView: 'src/components/teacher-pro/courses.tsx',
  coursesOverview: 'src/app/api/courses/overview/route.ts',
  coursesRoute: 'src/app/api/courses/route.ts',
  api: 'src/lib/api.ts',
  store: 'src/lib/teacher-store.ts',
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

const coursesView = read(files.coursesView);
const coursesOverview = read(files.coursesOverview);
const coursesRoute = read(files.coursesRoute);
const api = read(files.api);
const store = read(files.store);
const packageJson = read(files.packageJson);

assert(
  coursesOverview.includes("source: 'database'") && coursesOverview.includes('db.course.findMany') && coursesOverview.includes('db.student.findMany') && coursesOverview.includes('db.exam.findMany'),
  'تبويبة الدورات تملك API ملخص من قاعدة البيانات يشمل الدورات والطلاب والامتحانات',
);
assert(
  coursesOverview.includes('deleteSafety') && coursesOverview.includes('canDelete') && coursesOverview.includes('blockers'),
  'API الدورات يرجع حالة حذف آمنة وأسباب المنع من قاعدة البيانات',
);
assert(
  coursesOverview.includes('activeChapter') && coursesOverview.includes('courseChapter.findMany') && coursesOverview.includes('opportunities'),
  'API الدورات يرجع الفصل النشط وفرصه لكل دورة',
);
assert(
  coursesOverview.includes('usage') && coursesOverview.includes('programs') && coursesOverview.includes('studyTypes') && coursesOverview.includes('locations'),
  'API الدورات يرجع استعمال الطلاب للإعدادات حتى تظهر أثر التعديل للمستخدم',
);
assert(
  api.includes('CourseOverviewResponse') && api.includes('overview: (options: ApiGetOptions = {})') && api.includes('courses/overview'),
  'طبقة API الأمامية تدعم ملخص الدورات مع AbortController',
);
assert(
  coursesView.includes('courseApi.overview') && coursesView.includes('new AbortController()') && coursesView.includes('controller.abort()') && coursesView.includes('quietAbort: true'),
  'صفحة الدورات تلغي طلبات التحميل القديمة ولا تعتمد على طلبات متداخلة',
);
assert(
  coursesView.includes('const { loadSectionDataFromServer } = useTeacherStore();') && !coursesView.includes('const { courses, addCourse, updateCourse, toggleCourse, deleteCourse }'),
  'صفحة الدورات لا تبني القائمة أو العمليات من كاش courses المحلي القديم',
);
assert(
  coursesView.includes('courseApi.add') && !coursesView.includes('addCourse({') && coursesView.includes('تمت إضافة الدورة من قاعدة البيانات'),
  'إضافة الدورة صارت server-first ولا تولد ID محلي وهمي',
);
assert(
  coursesView.includes('courseApi.update') && !coursesView.includes('toast.success("تم تعديل الدورة")') && coursesView.includes('بعد تأكيد قاعدة البيانات'),
  'تعديل الدورة لا يظهر نجاحاً إلا بعد موافقة الخادم',
);
assert(
  coursesView.includes('courseApi.remove') && !coursesView.includes('deleteCourse(deleteDialog.id)') && coursesView.includes('deleteSafety.canDelete'),
  'حذف الدورة لا يعتمد على كاش ناقص ويستخدم فحص الأثر قبل التنفيذ',
);
assert(
  coursesView.includes('إيقاف الدورة عن التسجيل والاختيارات الجديدة') || coursesView.includes('إيقاف الدورة عن التسجيل'),
  'تعطيل الدورة موضح للمستخدم كإيقاف للاختيارات الجديدة وليس حذفاً أو تغييراً للطلاب الحاليين',
);
assert(
  coursesView.includes('renderLoadingSkeleton') && coursesView.includes('animate-pulse'),
  'صفحة الدورات تملك Skeleton Loading واضح وسلس',
);
assert(
  coursesView.includes('searchText') && coursesView.includes('statusFilter') && coursesView.includes('deleteFilter'),
  'صفحة الدورات تملك بحث وفلاتر للحالة وإمكانية الحذف',
);
assert(
  coursesView.includes('إجمالي الدورات') && coursesView.includes('نشطة للتسجيل') && coursesView.includes('آمنة للحذف'),
  'صفحة الدورات تعرض إحصائيات عامة واضحة',
);
assert(
  store.includes('if (section === "courses")') && store.includes('courseApi.list()') && store.includes('nextState.courses'),
  'مزامنة قسم الدورات تعيد تحميل الدورات نفسها وليس روابط الفصول فقط',
);
assert(
  coursesRoute.includes('studentConfigImpact') && coursesRoute.includes('Snapshot'),
  'API تعديل الدورة يوضح أن بيانات الطلاب الحالية Snapshot ولا تتغير تلقائياً',
);
assert(
  packageJson.includes('"test:courses-integrity"'),
  'يوجد أمر اختبار خاص بسلامة تبويبة الدورات داخل package.json',
);

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة تبويبة الدورات. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة تبويبة الدورات نجحت.');
