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
assert(
  candidates.includes('badges: callBadgesForGrade') &&
    candidates.includes('غائب وتم الخصم') &&
    !candidates.includes('غائب بدون خصم: فترة سماح') &&
    !candidates.includes('غائب بدون خصم: إجازة') &&
    candidates.includes('غائب بدون خصم: الامتحان بدون خصم'),
  'API المكالمات لا يحوّل غياب السماح/الإجازة إلى بطاقة اتصال، ويشرح الحالات المحاسبية الحقيقية فقط',
);
assert(
  candidates.includes('filter === "discounted"') &&
    candidates.includes('isDeductedImpact(impactKind)') &&
    stats.includes('filter === "discounted"') &&
    stats.includes('isDeductedImpact(impactKind)'),
  'فلتر المخصومين يعتمد على الأثر الأكاديمي الحقيقي ويشمل الغياب المخصوم لا الدرجات فقط',
);
assert(
  candidates.includes('filter === "absent"') &&
    candidates.includes('return kind === "absent"') &&
    stats.includes('filter === "absent"') &&
    stats.includes('return kind === "absent"'),
  'فلتر الغائبين يعتمد على التصنيف الأكاديمي الموحد ويستبعد الغياب المحمي',
);
assert(
  candidates.includes('gracePeriodStartDate: true') &&
    stats.includes('gracePeriodStartDate: true') &&
    candidates.includes('NON_DISPLAY_CALL_KINDS.has(kind)'),
  'المكالمات تجلب تاريخ بدء السماح اليدوي وتستبعد التصنيفات المحمية من العرض',
);
assert(
  followUp.includes('renderCallImpactBadges') &&
    followUp.includes('callBadgeToneClass') &&
    followUp.includes('غائب وتم الخصم') === false,
  'الواجهة تعرض Badges القادمة من قاعدة البيانات ولا تعيد تصنيع منطق الخصم محلياً',
);




assert(
  followUp.includes('callLoading && visibleCallRows.length === 0') &&
    followUp.includes('callRowsRef.current.length === 0') &&
    followUp.includes('بقيت آخر بيانات ناجحة ظاهرة') &&
    followUp.includes('callCandidatesRequestSequenceRef') &&
    followUp.includes('optimistic-call-') &&
    followUp.includes('mergeSavedCall(payload, status ? optimisticCall : null, !status)'),
  'جدول المكالمات يبقى ظاهراً أثناء التحديث الخلفي ولا يُمسح عند فشل أو تداخل الطلبات',
);
assert(
  followUp.includes('scopes: ["follow-up", "students", "dashboard", "logs"]'),
  'صدى حفظ المكالمة يستهلك كل نطاقات studentCalls ولا يعيد تحميل التبويب من server-version',
);

assert(
  followUp.includes('callMutationVersionRef') &&
    followUp.includes('mutationVersionAtRequestStart') &&
    followUp.includes('dispatchLocal: false') &&
    followUp.includes('scopes: ["follow-up", "students", "dashboard", "logs"]'),
  'حفظ حالة الاتصال محمي من طلبات Sync الأقدم ولا يعيد تحميل نفس التبويب فوراً',
);

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة تبويبة المكالمات. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة تبويبة المكالمات نجحت.');
