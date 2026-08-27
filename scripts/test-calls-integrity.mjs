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
  gradeRange: 'src/lib/call-grade-range.ts',
  contactStatus: 'src/lib/call-contact-status.ts',
  notesFilter: 'src/lib/call-notes-filter.ts',
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
const gradeRange = read(files.gradeRange);
const contactStatus = read(files.contactStatus);
const notesFilter = read(files.notesFilter);

const callPageSizeMatch = followUp.match(/const CALL_PAGE_SIZE = (\d+);/);
const callPageSize = Number(callPageSizeMatch?.[1] || 0);

assert(
  callPageSize > 0 && callPageSize <= 40,
  'صفحة المكالمات تحد عدد البطاقات الثقيلة إلى 40 أو أقل بدون تغيير العدد أو التصدير',
);
assert(
  followUp.includes('React.startTransition(() => {') &&
    followUp.includes('setCallRowsFromDb(nextRows);') &&
    followUp.includes('className="teacherpro-heavy-row rounded-3xl'),
  'تحديث بطاقات المكالمات مجدول كواجهة غير عاجلة وكل بطاقة معزولة عن إعادة تخطيط الصفحة',
);

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
    candidates.includes('return Boolean(absenceSource)') &&
    stats.includes('filter === "absent"') &&
    stats.includes('return Boolean(absenceSource)'),
  'فلتر الغائبين يوحّد الغياب المسجل والمشتق ويستبعد الحالات المحمية',
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

assert(
  followUp.includes('الدرجة من') &&
    followUp.includes('الدرجة إلى') &&
    followUp.includes('debouncedCallGradeFrom') &&
    followUp.includes('debouncedCallGradeTo'),
  'تبويبة المكالمات تحتوي فلتر درجة من/إلى مؤجل حتى لا يرسل طلباً مع كل ضغطة',
);
assert(
  api.includes('gradeFrom: query.gradeFrom') &&
    api.includes('gradeTo: query.gradeTo') &&
    candidates.includes('callGradeMatchesRangeForStatus(grade, gradeRange, statusFilter)') &&
    stats.includes('callGradeMatchesRangeForStatus(grade, gradeRange, statusFilter)'),
  'نطاق الدرجة ينتقل إلى القائمة والتصدير والإحصائيات بنفس المنطق',
);
assert(
  gradeRange.includes('score < range.from') &&
    gradeRange.includes('score > range.to') &&
    gradeRange.includes('grade?.status !== "درجة"'),
  'نطاق الدرجة شامل للحدين ويستبعد الحالات غير الرقمية عند تفعيله',
);
assert(
  followUp.includes('callStatusSupportsGradeRange') &&
    followUp.includes('setCallGradeFrom("");') &&
    followUp.includes('setCallGradeTo("");') &&
    followUp.includes('disabled={!callExamSelected || !callGradeRangeEnabled}'),
  'اختيار الغائبين أو الغش يمسح نطاق الدرجة ويعطّل حقليه للحالات غير الرقمية',
);
assert(
  followUp.includes('gradeFrom: effectiveCallGradeFrom') &&
    followUp.includes('gradeTo: effectiveCallGradeTo'),
  'طلبات القائمة والإحصائيات والتصدير لا ترسل نطاقاً رقمياً متأخراً مع الغائبين أو الغش',
);
assert(
  followUp.includes('حالة التواصل') &&
    followUp.includes('contactStatusFilter: callContactStatusFilter') &&
    api.includes('contactStatusFilter: query.contactStatusFilter'),
  'فلتر حالة التواصل ينتقل من الواجهة إلى القائمة والإحصائيات والتصدير',
);
assert(
  candidates.includes('contactStatusMatchesFilter(contactStatusFilter, contactStatus)') &&
    stats.includes('contactStatusMatchesFilter(contactStatusFilter, contactStatus)') &&
    contactStatus.includes('call.completed ? "تم الاتصال" : ""'),
  'القائمة والإحصائيات تستخدمان منطقاً موحداً ومتوافقاً مع سجلات التواصل القديمة',
);
assert(
  candidates.includes('orderBy: [{ createdAt: "desc" }, { id: "desc" }]') &&
    stats.includes('orderBy: [{ createdAt: "desc" }, { id: "desc" }]'),
  'اختيار أحدث حالة تواصل حتمي ومتطابق بين القائمة والإحصائيات',
);
assert(
  followUp.includes('setCallFilterRefreshKey((current) => current + 1)') &&
    followUp.includes('callContactStatusFilter !== "all"'),
  'تحديث حالة طالب يعيد جلب النتائج عندما لا تعود مطابقة لفلتر التواصل النشط',
);
assert(
  followUp.includes('الملاحظات') &&
    followUp.includes('notesFilter: callNotesFilter') &&
    api.includes('notesFilter: query.notesFilter'),
  'فلتر الملاحظات ينتقل من الواجهة إلى القائمة والإحصائيات والتصدير',
);
assert(
  candidates.includes('notesFilter === "with-notes"') &&
    stats.includes('notesFilter === "with-notes"') &&
    candidates.includes('studentIdsWithNotes.has(student.id)') &&
    stats.includes('studentIdsWithNotes.has(student.id)') &&
    notesFilter.includes('CALL_STUDENT_NOTE_CATEGORY'),
  'القائمة والإحصائيات تعرضان فقط أصحاب الملاحظات اليدوية المحفوظة',
);
assert(
  candidates.includes('studentId: { in: candidateStudentIds }') &&
    stats.includes('studentId: { in: students.map((student) => student.id) }') &&
    candidates.includes('if (notesFilter === "with-notes")') &&
    stats.includes('if (notesFilter === "with-notes" && students.length > 0)'),
  'استعلام الملاحظات لا يعمل إلا عند تفعيل الفلتر ويبقى محصوراً بطلاب الدورة',
);
assert(
  followUp.includes('data?.deleted && callNotesFilter === "with-notes"') &&
    followUp.includes('setCallFilterRefreshKey((current) => current + 1)'),
  'حذف آخر ملاحظة يزيل الطالب من نتائج فلتر أصحاب الملاحظات مباشرة',
);
assert(
  followUp.includes('الطلاب الذين لم تُدخل') &&
    followUp.includes('درجاتهم بعد انتهاء الامتحان'),
  'الواجهة توضح أن الغائبين تشمل أيضاً غير المدخلة درجاتهم بعد انتهاء الامتحان',
);

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة تبويبة المكالمات. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة تبويبة المكالمات نجحت.');
