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
  callIdentity: 'src/lib/call-identity.ts',
  callPhoneQr: 'src/lib/call-phone-qr.ts',
  callPhoneQrDialog: 'src/components/teacher-pro/call-phone-qr.tsx',
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
const callIdentity = read(files.callIdentity);
const callPhoneQr = read(files.callPhoneQr);
const callPhoneQrDialog = read(files.callPhoneQrDialog);

const callPageSizeMatch = followUp.match(/const CALL_PAGE_SIZE = (\d+);/);
const callPageSize = Number(callPageSizeMatch?.[1] || 0);

assert(
  callPageSize > 0 && callPageSize <= 40,
  'صفحة المكالمات تحد عدد البطاقات الثقيلة إلى 40 أو أقل بدون تغيير العدد أو التصدير',
);
assert(
  followUp.includes('React.startTransition(() => {') &&
    followUp.includes('setCallRowsFromDb(nextRows);') &&
    followUp.includes('className="teacherpro-heavy-row tp-call-card"'),
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
  'حفظ المكالمة يعيد استخدام سجل منطقي واحد وينظف التكرارات التاريخية عند لمسه',
);
assert(
  callIdentity.includes('per student + exam') &&
    callIdentity.includes('studentExamCallIdentityKey') &&
    callIdentity.includes('studentExamCallIdentityMatches'),
  'هوية مكالمة الامتحان معرفة مركزياً بالطالب + الامتحان بدون Grade ID',
);
assert(
  callsRoute.includes('FOR UPDATE') &&
    callsRoute.includes('category: { not: CALL_STUDENT_NOTE_CATEGORY }') &&
    callsRoute.includes('existing?.category || data.category'),
  'الحفظ يقفل الطالب أثناء المعاملة ويعيد استخدام أي category تاريخية لنفس الطالب/الامتحان بدون إنشاء Duplicate متزامن',
);
assert(
  candidates.includes('isStudentExamCall({ ...call, examId })') &&
    stats.includes('isStudentExamCall({ ...call, examId })') &&
    !candidates.includes('call.category !== exactCategory') &&
    !stats.includes('call.category !== exactCategory'),
  'القائمة والإحصائيات تقرآن حالة التواصل حسب الطالب + الامتحان ولا تربطانها بمعرف Grade الحالي',
);
assert(
  followUp.includes('studentExamCallIdentityKey(call.studentId, call.examId)') &&
    followUp.includes('studentExamCallIdentityMatches(call, payload.studentId, payload.examId)') &&
    !followUp.includes('::${item.callKey}`;'),
  'الواجهة والتصدير والدمج المتفائل تستخدم مفتاح الطالب + الامتحان المستقر بعد Reload أو تغير الدرجة',
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
  followUp.includes('type CallStatusFilter = "all" | "discounted" | "full";') &&
    followUp.includes('all: "كل الحالات",') &&
    followUp.includes('discounted: "المخصومين",') &&
    followUp.includes('full: "الدرجات الكاملة",') &&
    ['الغائبين', 'الراسبين غير المخصومين', 'طلاب الغش', 'الطلاب الناجحين', 'المحميون', 'dismissed: "المفصولين"'].every(
      (label) => !followUp.includes(label),
    ),
  'قائمة «حالة الطالب في الامتحان» فيها كل الحالات والمخصومين والدرجات الكاملة فقط',
);
assert(
  [candidates, stats].every((source) =>
    source.includes('type CallStatusFilter = "all" | "discounted" | "full";') &&
    /function normalizeCallStatusFilter\(value: string \| null\): CallStatusFilter \{[^}]*if \(normalized === "discounted" \|\| normalized === "full"\) return normalized;\s*return "all";\s*\}/.test(source) &&
    source.includes('return kind === "full";') &&
    !source.includes('filter === "absent"') &&
    !source.includes('filter === "failed"') &&
    !source.includes('filter === "passed"') &&
    !source.includes('filter === "protected"') &&
    !source.includes('filter === "dismissed"') &&
    !source.includes('STUDENT_STATUS_DISMISSED')),
  'القائمة والإحصائيات تطبقان الفلاتر الثلاثة نفسها، وأي فلتر قديم من رابط أو تبويبة قديمة يُقرأ «كل الحالات»',
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
  followUp.includes('CallPhoneQr') &&
    followUp.includes('renderQrTile(row, "الطالب", row.student.phone') &&
    followUp.includes('renderQrTile(row, "ولي الأمر", row.student.parentPhone') &&
    followUp.includes('<CallPhoneQr'),
  'كل رقم متوفر في بطاقة المكالمات يملك QR مستقل للطالب أو ولي الأمر',
);
assert(
  callPhoneQrDialog.includes('QRCodeSVG') &&
    callPhoneQrDialog.includes('value={qrValue}') &&
    callPhoneQrDialog.includes('marginSize={4}') &&
    !callPhoneQrDialog.includes('Dialog') &&
    callPhoneQr.includes('`tel:${dialNumber}`') &&
    !callPhoneQrDialog.includes('api.qrserver') &&
    !callPhoneQrDialog.includes('chart.googleapis'),
  'رمز الاتصال ظاهر مباشرة ويُولد محلياً بهامش قابل للمسح ويحوّل الهاتف إلى tel: بلا خدمة خارجية',
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
    api.includes('withReadDeadline(async (signal) =>') &&
    api.includes('}, options.signal)') &&
    read('src/lib/read-deadline.ts').includes('callerSignal?.addEventListener("abort", cancel') &&
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
  candidates.includes('loadActiveGracePeriodsByStudent') &&
    stats.includes('loadActiveGracePeriodsByStudent') &&
    !candidates.includes('gracePeriodStartDate') &&
    !stats.includes('gracePeriodStartDate') &&
    candidates.includes('NON_DISPLAY_CALL_KINDS.has(kind)'),
  'المكالمات تقرأ فترات السماح من إدارة فترة السماح وتستبعد التصنيفات المحمية من العرض',
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
    candidates.includes('callGradeMatchesRange(grade, gradeRange)') &&
    stats.includes('callGradeMatchesRange(grade, gradeRange)') &&
    !gradeRange.includes('callGradeMatchesRangeForStatus'),
  'نطاق الدرجة ينتقل إلى القائمة والتصدير والإحصائيات بنفس المنطق',
);
assert(
  gradeRange.includes('score < range.from') &&
    gradeRange.includes('score > range.to') &&
    gradeRange.includes('grade?.status !== "درجة"'),
  'نطاق الدرجة شامل للحدين ويستبعد الحالات غير الرقمية عند تفعيله',
);
assert(
  followUp.includes('<summary>فلاتر إضافية</summary>') &&
    !followUp.includes('callStatusSupportsGradeRange') &&
    !followUp.includes('callGradeRangeEnabled') &&
    followUp.includes('gradeFrom: debouncedCallGradeFrom') &&
    followUp.includes('gradeTo: debouncedCallGradeTo'),
  'نطاق الدرجة متاح مع كل خيارات الحالة الثلاثة وينتقل للقائمة والإحصائيات والتصدير بعد التأجيل',
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
  /setCallStatsRefreshKey\(\(current\) => current \+ 1\);\s*toast\.success\("تم حفظ إجراء التواصل"\);/.test(followUp) &&
    !/if \(callContactStatusFilter !== "all"\) setCallGradePage\(1\);/.test(followUp) &&
    followUp.includes('callStatsRefreshKey,\n    syncKey,'),
  'حفظ حالة الاتصال يحدّث الأعداد فقط: البطاقات تبقى بمكانها ولا ترجع الصفحة الأولى',
);
assert(
  followUp.includes('contactStatusMatchesFilter(callContactStatusFilter, callStatusForLog(callLogForRow(row)))') &&
    followUp.includes('if (callDepartedCount > 0) setCallFilterRefreshKey((current) => current + 1);'),
  'من خرج من فلتر التواصل يبقى ظاهراً، و«التالي» يعيد تحميل الصفحة نفسها حتى لا يُتخطى أي طالب',
);
assert(
  followUp.includes('if (!result.ok && !result.queued)') &&
    followUp.includes('if (result.queued)') &&
    followUp.includes('حُفظ إجراء التواصل مؤقتاً وسيُرسل تلقائياً عند رجوعه') &&
    followUp.includes('mergeSavedCall(payload, previousCall, !previousCall)'),
  'الواجهة تفرّق بين الفشل الحقيقي والحفظ المؤجل في outbox ولا تتراجع عن الحالة المتفائلة عند انقطاع الشبكة',
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

// ── Simplified calls: short cards, filter buttons, details window ──────────
const dashboardSource = read('src/components/teacher-pro/dashboard.tsx');
const callsDialogSource = read('src/components/teacher-pro/calls-dialog.tsx');
const layoutSource = read('src/components/teacher-pro/layout.tsx');
assert(
  callsDialogSource.includes('<CallsWorkspace variant="window" />') &&
    dashboardSource.includes('إدارة المكالمات') &&
    dashboardSource.includes('<CallsDialog open={callsOpen}') &&
    layoutSource.includes('{ id: "follow-up-calls", title: "المكالمات", icon: PhoneCall }') &&
    followUp.includes('return <CallsWorkspace variant="page" />;'),
  'المكالمات تُفتح من زر «إدارة المكالمات» في لوحة النظام وتبقى تبويبة المكالمات بنفس الواجهة',
);
assert(
  stats.includes('const contactCounts = { ...zeroStats.contactCounts, all: baseMatching.length };') &&
    stats.includes('const matchingStudents = baseMatching.filter((student) => {') &&
    followUp.includes('callContactFilterChips') &&
    followUp.includes('contactCounts?.[chip.countKey]') &&
    api.includes('contactCounts?:'),
  'أزرار حالة التواصل تعرض أعدادها محسوبة بكل الفلاتر عدا فلتر التواصل نفسه',
);
assert(
  candidates.includes('words.every((word) => haystack.some((value) => value.includes(word)))') &&
    stats.includes('words.every((word) => haystack.some((value) => value.includes(word)))') &&
    !followUp.includes('بحث داخل الفرز'),
  'حقل بحث واحد: كل الكلمات المكتوبة لازم تنطبق بالقائمة والإحصائيات والتصدير',
);
assert(
  followUp.includes('callContactActions.map((action) => {') &&
    followUp.includes('aria-pressed={!contactStatus}') &&
    followUp.includes('saveCallStatus(row, contactStatus === action.value ? "" : action.value)') &&
    followUp.includes('aria-pressed={contactStatus === action.value}'),
  'إجراء التواصل أزرار بضغطة وحدة مع زر «بدون إجراء»، والضغط على المفعّل يرجعه «بدون إجراء»',
);
assert(
  followUp.includes('renderDetailsWindow') &&
    followUp.includes('className="tp-modal tp-call-details"') &&
    followUp.includes('سجل الامتحانات') &&
    followUp.includes('renderNoteArea(row, "window")') &&
    followUp.includes('renderNoteArea(row, "card")') &&
    followUp.includes('ملف الطالب') &&
    followUp.includes('تصفير الفلاتر') &&
    followUp.includes('لديهم ملاحظات'),
  'كارت الطالب مختصر، والتفاصيل (السجل، QR، محرر الملاحظة، ملف الطالب) بنافذة',
);

assert(
  candidates.includes('await annotateGradeSettlementEffects(annotated);') &&
    candidates.includes('await annotateGradeRecordedImpacts(annotated);') &&
    candidates.includes('recordedItems[index].item.badges = [recordedImpactBadge(grade.recordedOpportunityImpact)]') &&
    candidates.includes('!item.grade.id.startsWith("implicit-absence:")'),
  'شارة الأثر في كارت المكالمة تقرأ ما سُجل فعلاً في سجل الفرص مثل سجل الدرجات، لا قاعدة الامتحان وحدها',
);
assert(
  followUp.includes('className="tp-call-card__qr"') &&
    followUp.includes('className="tp-call-hero"') &&
    followUp.includes('<Phone aria-hidden="true" />التواصل') &&
    followUp.includes('<SlidersHorizontal aria-hidden="true" />الإجراء') &&
    followUp.includes('onClick={() => void saveCallStatus(row, "")}') &&
    followUp.includes('className="tp-call-card__note-row"'),
  'كارت الطالب: رأس، لوحة الامتحان والنتيجة، صفا التواصل والإجراء (مع بدون إجراء)، الملاحظة، ورموز QR ظاهرة مباشرة',
);

assert(
  !fs.existsSync('src/lib/call-recorded-impact-server.ts') &&
    [candidates, stats].every((source) =>
      source.includes('if (filter === "discounted") return isDeductedImpact(impactKind);') &&
      !source.includes('recordedCharge') &&
      !source.includes('loadRecordedChargeByGradeId')),
  'فلتر «المخصومين» وعدده بقواعد الامتحان: الغياب بلا إجازة أو سماح (حتى غير المدخلة درجته والمفصول)، الغش، والراسب بدرجة الخصم أو الفصل',
);

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة تبويبة المكالمات. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة تبويبة المكالمات نجحت.');
