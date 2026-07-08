import fs from 'node:fs';

const files = {
  followUp: 'src/components/teacher-pro/follow-up.tsx',
  candidates: 'src/app/api/student-calls/candidates/route.ts',
  stats: 'src/app/api/student-calls/stats/route.ts',
  callsRoute: 'src/app/api/student-calls/route.ts',
  api: 'src/lib/api.ts',
  classification: 'src/lib/grade-classification.ts',
  prisma: 'prisma/schema.prisma',
  callUniqueMigration: 'prisma/migrations/20260708162000_student_call_unique_key/migration.sql',
  profileLog: 'src/app/api/students/profile-log/route.ts',
  profileDialog: 'src/components/teacher-pro/student-profile-dialog.tsx',
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

const followUp = read(files.followUp);
const candidates = read(files.candidates);
const stats = read(files.stats);
const callsRoute = read(files.callsRoute);
const api = read(files.api);
const classification = read(files.classification);
const prisma = read(files.prisma);
const callUniqueMigration = read(files.callUniqueMigration);
const profileLog = read(files.profileLog);
const profileDialog = read(files.profileDialog);

assert(
  followUp.includes('const callRows = callRowsFromDb;'),
  'تبويبة المكالمات تعرض الصفوف القادمة من قاعدة البيانات فقط',
);
assert(
  !followUp.includes('const callRows = useMemo<CallStudentRow'),
  'لا يوجد بناء محلي لصفوف المكالمات من كاش الطلاب/الدرجات',
);
assert(
  !followUp.includes('[...studentCalls, ...callPageStudentCalls]'),
  'حالات المكالمات داخل التبويبة لا تختلط مع كاش studentCalls العام',
);
assert(
  followUp.includes('callCourseExamsApi') && followUp.includes('callCourseExamsFromDb'),
  'قائمة امتحانات تبويبة المكالمات تأتي من API قاعدة البيانات',
);
assert(
  followUp.includes('studentCallApi.upsert') && callsRoute.includes('db.$transaction'),
  'حفظ المكالمات يستخدم upsert آمن داخل transaction',
);
assert(
  callsRoute.includes('findFirst') && callsRoute.includes('deleteMany'),
  'منع تكرار سجل المكالمة لنفس الطالب/الامتحان/السبب',
);
assert(
  candidates.includes('rows,') && candidates.includes('source: "database"'),
  'API المرشحين يرجع rows جاهزة من قاعدة البيانات',
);
assert(
  candidates.includes('sortTime: new Date(exam.date).getTime()'),
  'آخر امتحان/آخر امتحانين يعتمد على تاريخ الامتحان لا updatedAt',
);
assert(
  !followUp.includes('طلاب المحاسبة') && !followUp.includes('"academic-accounting";'),
  'خيار طلاب المحاسبة محذوف من فلاتر تبويبة المكالمات',
);
assert(
  candidates.includes('filter === "failed"') &&
    candidates.includes('kind === "failed" || kind === "academic-accounting"') &&
    stats.includes('kind === "failed" || kind === "academic-accounting"'),
  'فلتر الراسبين غير المخصومين يشمل طلاب المحاسبة ويستثني المخصومين',
);
assert(
  followUp.includes('https://wa.me/') || followUp.includes('whatsappLink(phone || "")'),
  'روابط واتساب تستخدم https://wa.me المناسب للديسكتوب والموبايل',
);
assert(
  !followUp.includes('whatsapp://send'),
  'لا توجد روابط whatsapp:// داخل تبويبة المكالمات',
);


assert(
  prisma.includes('@@unique([studentId, examId, category])') &&
    callUniqueMigration.includes('StudentCall_studentId_examId_category_key'),
  'قاعدة البيانات تملك قيد Unique حقيقي للمكالمات حسب الطالب/الامتحان/السبب',
);
assert(
  callUniqueMigration.includes('COALESCE("examId",') &&
    callUniqueMigration.includes('StudentCall_studentId_examId_category_coalesced_key'),
  'قيد Unique يغطي أيضاً ملاحظات المكالمات ذات examId الفارغ',
);
assert(
  api.includes('ApiGetOptions') &&
    api.includes('signal: options.signal') &&
    followUp.includes('new AbortController()') &&
    followUp.includes('controller.abort()') &&
    followUp.includes('quietAbort: true'),
  'طلبات بحث/تحميل تبويبة المكالمات تُلغى فعلياً عبر AbortController عند تغيير الفلتر أو البحث',
);
assert(
  followUp.includes('renderCallLoadingSkeleton') &&
    followUp.includes('aria-busy="true"') &&
    followUp.includes('animate-pulse'),
  'حالة التحميل داخل كروت المكالمات صارت Skeleton واضحة بدل رسالة نصية فقط',
);
assert(
  profileLog.includes('const exams = examIds.length') &&
    profileLog.includes('exams,') &&
    profileDialog.includes('databaseExams') &&
    profileDialog.includes('profileExams'),
  'ملف الطالب المفتوح من المكالمات يجلب امتحانات سجل الطالب من قاعدة البيانات حتى لا يعتمد على كاش الامتحانات العام',
);
assert(
  callsRoute.includes('isUniqueConstraintError') &&
    callsRoute.includes('A second tab/request created the same logical call') &&
    callsRoute.includes('racedExisting'),
  'حفظ المكالمات يتحمل تعارض الطلبات المتزامنة بدون خطأ للمستخدم',
);

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة تبويبة المكالمات. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة تبويبة المكالمات نجحت.');
