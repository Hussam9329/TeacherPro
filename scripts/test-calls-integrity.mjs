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
  callsRoute.includes('await lockCallCaseForSave(tx, data.studentId, String(data.examId));') &&
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
  followUp.includes('<Label htmlFor={`follow-up-calls-grade-from-${variant}`}>الدرجة من</Label>') &&
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
  candidates.includes('contactStatusMatchesFilter(contactFilter, normalizeContactStatus(bestCallByStudentId.get(item.student.id)))') &&
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
    followUp.includes('callFilterRefreshKey,\n    callStatsRefreshKey,\n  ]);'),
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
  [candidates, stats].every((source) =>
    source.includes('const words = normalizeArabicText(query).split(" ").filter(Boolean);') &&
    source.includes('const haystack = values.map((value) => normalizeArabicText(value));')) &&
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
    followUp.includes('onClearFilters={callFiltersActive ? resetCallFilters : undefined}') &&
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

assert(
  !followUp.includes('isBackgroundSync') &&
    !followUp.includes('    syncKey,\n') &&
    followUp.includes('setCallLoadedSyncKey(latestSyncKeyRef.current);') &&
    followUp.includes('const callUpdatesPending = syncKey !== callLoadedSyncKey;') &&
    followUp.includes('تغييرات جديدة — تحديث'),
  'تغييرات المستخدمين أو الصفحات الأخرى لا تعيد تحميل القائمة والأعداد وحدها؛ تظهر «تحديث» ويختار المستخدم متى',
);

assert(
  followUp.includes('void refreshShortcutAlerts();') &&
    followUp.includes('تم حفظ الملاحظة وأُعيدت إلى إدارة ملاحظات المكالمات') &&
    read('src/lib/call-note-management-server.ts').includes('notes, noteResolved: false, noteRevision: { increment: 1 },'),
  'تعديل ملاحظة من المكالمات يعيدها لإدارة ملاحظات المكالمات حتى لو كانت منجزة، ويحدّث عددها فوراً',
);

{
  // «دفعات»: each open calls window holds its own batch; the manual «تقسيم العمل» is gone.
  const presence = read('src/app/api/student-calls/presence/route.ts');
  const reservations = read('src/lib/call-reservations-server.ts');
  const batch = read('src/lib/call-batch.ts');
  const migration = read('prisma/migrations/20261006090000_call_batches/migration.sql');
  assert(
    !fs.existsSync('src/lib/call-work-share.ts') &&
      ![followUp, candidates, stats, api].some((source) => /WorkShare|تقسيم العمل|share:/.test(source)),
    '«تقسيم العمل» اليدوي انشال: القسمة صارت دفعات تلقائية لكل نافذة',
  );
  assert(
    batch.includes('export const CALL_BATCH_SIZE = 10;') &&
      batch.includes('export const CALL_WINDOW_TTL_MS = 2 * 60 * 1000;') &&
      batch.includes('export const CALL_NO_ANSWER_RETRY_MS = 60 * 60 * 1000;') &&
      migration.includes('CREATE UNIQUE INDEX "CallReservation_studentId_examId_key"') &&
      reservations.includes('ON CONFLICT ("studentId", "examId") DO NOTHING'),
    'الدفعة ١٠ أسماء، والطالب ينحجز لنافذة وحدة بس، والنافذة الساكتة دقيقتين تنفك، و«لم يرد» يرجع بعد ساعة',
  );
  assert(
    candidates.includes('if (contactStatusFilter === "batch" && !searching) {') &&
      candidates.includes('if (wantsClaim && mine.size === 0) {') &&
      candidates.includes('(searching || exportAll || principal.isAdmin || !heldByOther(item.student.id))') &&
      candidates.includes('heldBy: holder ? { userName: holder.userName, mine: ownsWindow && holder.windowId === windowId } : null,') &&
      candidates.includes('if (canHold && windowId && ownsWindow) {'),
    '«دفعتي» تاخذ دفعة بس لما تنطلب، المحجوز عند غيرك يختفي، والبحث يطلّعه ويّا اسم اللي عنده',
  );
  assert(
    callsRoute.includes('if (data.status) await dropCallHold(tx, data.studentId, data.examId);') &&
      callsRoute.includes('actedById: principal.id,') &&
      callsRoute.includes('writeAuditLog(principal, "المكالمات", data.status ? "تحديث حالة مكالمة" : "مسح حالة مكالمة"'),
    'أي إجراء يطلّع الطالب من الدفعة، وينحفظ اسم الموظف ويّاه وبالسجلات',
  );
  assert(
    presence.includes('requirePermissionPrincipal(req, "follow-up.calls.manage")') &&
      presence.includes('if (!principal.isAdmin) {') &&
      followUp.includes('callWindowApi.close(callWindowId);') &&
      followUp.includes('window.setInterval(beat, CALL_WINDOW_HEARTBEAT_MS)') &&
      followUp.includes('منو شغال هسه'),
    'النافذة المفتوحة تنبض وتسلّم دفعتها لما تنسد، والأدمن يشوف منو شغال وكم باقي عند كل واحد',
  );
  assert(
    followUp.includes('{ value: "batch", label: "دفعتي" }') &&
      followUp.includes('<PhoneCall aria-hidden="true" />خذ دفعة') &&
      followUp.includes('<PhoneCall aria-hidden="true" />الدفعة الجاية') &&
      followUp.includes('عند {row.heldBy.userName}'),
    'شاشة المكالمات: «دفعتي» و«خذ دفعة» و«الدفعة الجاية»، و«عند فلان» على الطالب المحجوز',
  );
  assert(
    followUp.includes('const callUsesBatches = canManageCalls && !callActorIsAdmin;') &&
      followUp.includes('const callDefaultContactFilter: CallContactStatusFilter = callUsesBatches ? "batch" : "all";') &&
      followUp.includes('chips={(callUsesBatches ? callBatchFilterChips : callContactFilterChips)') &&
      followUp.includes('const callNumbersHidden = (row: CallStudentRow) => callUsesBatches && !row.heldBy?.mine;') &&
      followUp.includes('window: callUsesBatches ? callWindowId : undefined,'),
    'الأدمن يشوف كل الطلاب وكل الأزرار ويتعامل ويّا أي طالب، بدون دفعات وبدون «خذ دفعة»',
  );
  // Nobody dials a student they do not hold: outside «دفعتي» the QR codes
  // show after «خذه للاتصال», never while someone else holds the student.
  assert(
    followUp.includes('const callNumbersHidden = (row: CallStudentRow) => callUsesBatches && !row.heldBy?.mine;') &&
      followUp.includes('{!callNumbersHidden(row) ? (') &&
      followUp.includes('{renderContactButtons(row.student, callNumbersHidden(row))}') &&
      followUp.includes('.filter(([label]) => !callNumbersHidden(row) || !label.startsWith("هاتف"))') &&
      followUp.includes('disabled={!row.focusItem || statusSaving || callHeldByOther(row)}') &&
      followUp.includes('<PhoneCall aria-hidden="true" />خذه للاتصال') &&
      followUp.includes('seenStatus: callStatusForLog(callLogForRow(row)),') &&
      presence.includes('changed = current !== null && seenStatus !== null && seenStatus !== current;') &&
      callsRoute.includes('if (holder && holder.windowId !== windowId && !principal.isAdmin) throw new CallHeldByOtherError(holder.userName);'),
    'الرقم (QR، واتساب، التفاصيل) والإجراء بس للطالب اللي بإيدك؛ «خذه للاتصال» يرفض الطالب اللي تغيّرت حالته أو اللي عند غيرك',
  );
  assert(
    reservations.includes("SELECT pg_try_advisory_xact_lock_shared(hashtext('call-case')") &&
      callsRoute.includes('await lockCallCaseForSave(tx, data.studentId, String(data.examId));') &&
      !/FOR (UPDATE|SHARE|KEY SHARE)/.test(reservations) &&
      !callsRoute.includes('FOR UPDATE') &&
      reservations.includes("pg_advisory_xact_lock(hashtext(${`call-batch:${args.examId}`}))") &&
      reservations.includes('export async function retryCallTransaction'),
    'الدفعة ما تنتظر حفظ الدرجات أو إعادة الحساب، وتتخطى الطالب اللي ينحفظ عليه إجراء هسه، والدفعات تنطي وحدة ورا وحدة',
  );
  // A page from before batches cannot list students; a page left open across
  // an update asks for a reload; a page in the background keeps its batch.
  assert(
    batch.includes('export const CALL_CLIENT_PROTOCOL = 2;') &&
      candidates.includes('if (hasPermission(principal, "follow-up.calls.manage") && !(clientProtocol >= CALL_CLIENT_PROTOCOL)) {') &&
      api.includes('client: String(CALL_CLIENT_PROTOCOL),') &&
      callsRoute.includes('if (data.category !== CALL_STUDENT_NOTE_CATEGORY && !(Number(body?.client) >= CALL_CLIENT_PROTOCOL)) {') &&
      followUp.includes('client: CALL_CLIENT_PROTOCOL,') &&
      followUp.includes('if (result?.build && CALL_PAGE_BUILD && result.build !== CALL_PAGE_BUILD) setCallPageOutdated(true);') &&
      followUp.includes('const away = document.visibilityState === "hidden";') &&
      batch.includes('export const CALL_WINDOW_AWAY_MS = 15 * 60 * 1000;'),
    'صفحة مكالمات قديمة ما تشتغل لحد ما تتحدث، والصفحة اللي بالخلفية (على مكالمة) تحتفظ بدفعتها',
  );
}
assert(
  read('src/components/teacher-pro/layout.tsx').includes('  "follow-up-calls",\n  "accounts",') &&
    !read('src/app/api/auth/logout/route.ts').includes('increment'),
  'تغيير من جهاز آخر لا يعيد تحميل كل مكالمات النظام، وتسجيل الخروج من جهاز لا يخرج الأجهزة الأخرى',
);

{
  const catalog = read('src/lib/permission-catalog.ts');
  const bootstrap = read('src/app/api/bootstrap/route.ts');
  const profileAccess = read('src/lib/student-profile-server.ts');
  const courseExams = read('src/app/api/student-calls/course-exams/route.ts');
  assert(
    catalog.includes('id: "role_caller",') &&
      catalog.includes('permissions: ["system.dashboard", "follow-up.calls.view", "follow-up.calls.manage", "students.registry.view"],') &&
      [stats, courseExams, callsRoute].every((source) =>
        source.includes('await requireAnyPermission(req, CALLS_VIEW_PERMISSIONS);') &&
        !source.includes('requirePermission(req, "follow-up.view")')) &&
      candidates.includes('await requireAnyPermissionPrincipal(req, CALLS_VIEW_PERMISSIONS);') &&
      bootstrap.includes('["courses.view", ...CALLS_VIEW_PERMISSIONS]') &&
      profileAccess.includes('const logs = hasPermission(principal, "logs.view");') &&
      profileAccess.includes("    grades: true,\n    opportunities: true,\n    followUp: true,"),
    'دور «موظف مكالمات» يكفي لفتح المكالمات واختيار الدورة والامتحان وقراءة ملف الطالب من المكالمة',
  );
  assert(
    followUp.includes('<h3 id="tp-call-student" className="tp-modal__title">معلومات الطالب</h3>') &&
      followUp.includes('["هاتف ولي الأمر", student.parentPhone || "لا يوجد"],'),
    'نافذة التفاصيل في المكالمات تعرض معلومات الطالب كاملة',
  );
}

{
  const serverAuth = read('src/lib/server-auth.ts');
  const store = read('src/lib/teacher-store.ts');
  const dashboard = read('src/components/teacher-pro/dashboard.tsx');
  const registryHelpers = read('src/components/teacher-pro/student-registry-helpers.ts');
  assert(
    read('src/lib/permission-catalog.ts').includes('id: "students.registry.view",') &&
      serverAuth.includes('"students.view": ["page.student-registry.view", "page.dismissed-students.view", "students.registry.view"],') &&
      store.includes('"student-registry": ["students.registry.view"],') &&
      !store.includes('"dismissed-management": ["page.dismissed-students.view", "students.registry.view"') &&
      dashboard.includes('const canViewCodeClosures = hasFullStudentsView;') &&
      dashboard.includes('const canViewGracePeriods = (canAccess("student-registry") && hasFullStudentsView) ||') &&
      dashboard.includes('Boolean(actor?.permissions?.includes("grace-periods.view"));') &&
      registryHelpers.includes('canEditStudents: isAdmin || permissions.has("students.edit"),') &&
      registryHelpers.includes('canArchiveStudents: isAdmin || permissions.has("students.delete"),'),
    '«عرض سجل الطلاب فقط» يفتح سجل الطلاب للقراءة فقط، بدون المفصولين وإغلاق الكودات وفترات السماح وبدون تعديل أو أرشفة',
  );
}

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة تبويبة المكالمات. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة تبويبة المكالمات نجحت.');
