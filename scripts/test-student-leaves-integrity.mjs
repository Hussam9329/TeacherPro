import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

let failed = false;
function pass(message) {
  console.log(`✅ ${message}`);
}
function fail(message) {
  failed = true;
  console.error(`❌ ${message}`);
}
function must(condition, okMessage, failMessage) {
  if (condition) pass(okMessage);
  else fail(failMessage || okMessage);
}

const leaves = read("src/components/teacher-pro/leaves-dialog.tsx");
const followUp = read("src/components/teacher-pro/follow-up.tsx");
const dashboard = read("src/components/teacher-pro/dashboard.tsx");
const layout = read("src/components/teacher-pro/layout.tsx");
const store = read("src/lib/teacher-store.ts");
const status = read("src/lib/student-leave-status.ts");
const listRoute = read("src/app/api/student-leaves/students/route.ts");
const route = read("src/app/api/student-leaves/route.ts");
const api = read("src/lib/api.ts");
const preview = read("src/lib/student-leave-preview.ts");
const contextRoute = read("src/app/api/student-leaves/context/route.ts");
const pkg = JSON.parse(read("package.json"));

// «إدارة الإجازات» replaced the leaves tab: one window from the dashboard.
must(
  dashboard.includes("إدارة الإجازات") &&
    dashboard.includes("<LeavesDialog") &&
    dashboard.includes('canAccess("follow-up-leaves")') &&
    !dashboard.includes('section: "follow-up-leaves"'),
  "زر «إدارة الإجازات» في الوصول السريع يفتح النافذة بدل تبويبة الإجازات",
  "لوحة النظام يجب أن تفتح نافذة الإجازات بدل رابط التبويبة القديمة.",
);

must(
  !layout.includes('id: "follow-up-leaves"') &&
    !layout.includes('"follow-up-calls", "follow-up-leaves"') &&
    layout.includes("if (value === 'follow-up' || value === 'follow-up-leaves') return 'follow-up-leaves'") &&
    layout.includes("LEAVES_DIALOG_OPEN_EVENT") &&
    store.includes('state.currentSection === "follow-up-leaves"') &&
    store.includes('"follow-up-leaves": "follow-up.leaves.view"'),
  "التبويبة أزيلت من القائمة، والروابط القديمة تفتح النافذة، والصلاحية باقية",
  "يجب إخفاء التبويبة مع تحويل روابطها القديمة وإبقاء صلاحية الإجازات.",
);

must(
  !followUp.includes("studentLeaveApi") &&
    !followUp.includes("FollowUpLeavesView") &&
    !followUp.includes("renderLeaveList"),
  "صفحة المتابعة لم تعد تحمل نسخة ثانية من إدارة الإجازات",
  "يجب ألا يبقى مسار ثانٍ لإدارة الإجازات داخل صفحة المكالمات.",
);

must(
  leaves.includes("/api/student-leaves/students?") &&
    leaves.includes("STUDENT_LEAVE_LIST_FILTERS") &&
    status.includes('label: "الإجازات السابقة"') &&
    status.includes('label: "الإجازات الحالية"') &&
    status.includes('label: "كل الإجازات"') &&
    leaves.includes("list.counts[option.value]") &&
    leaves.includes("من الأحدث إلى الأقدم") &&
    listRoute.includes("LIST_LIMIT") &&
    leaves.includes("list?.truncated"),
  "النافذة تعرض بحثاً وكروت طلاب مع فرز (السابقة / الحالية / الكل) وأعداد، من الأحدث، بعدد محدود",
  "قائمة الإجازات يجب أن تكون كروت طلاب مع بحث وفرز وعدد محدود.",
);

must(
  leaves.includes("describeTelegramHandle") &&
    leaves.includes('className="tp-leave-card__tg"') &&
    leaves.includes('className="tp-leave-card__code"') &&
    leaves.includes("فتح محادثة تيليجرام مع"),
  "كارت الطالب: الاسم والكود وزر تيليجرام يفتح المحادثة بالتطبيق",
  "كارت الطالب يجب أن يعرض الاسم والكود وزر تيليجرام.",
);

must(
  listRoute.includes('requirePermission(req, "follow-up.view")') &&
    listRoute.includes("buildStudentRegistrySearchWhere(query)") &&
    listRoute.includes("studentLeaveListWhere(") &&
    listRoute.includes("attachStudentOpportunitySnapshots") &&
    listRoute.includes('"Cache-Control": "private, no-store"'),
  "قائمة الطلاب محمية بصلاحية الإجازات وتبحث بالطالب ونص الإجازة وتعرض الفرص من لقطة الخادم",
);

must(
  leaves.includes("compareLeavesNewestFirst") &&
    leaves.includes("STUDENT_LEAVE_STATE_LABELS") &&
    status.includes('active: "سارية"') &&
    status.includes('upcoming: "قادمة"') &&
    status.includes('ended: "منتهية"') &&
    status.includes("leave.examDate || leave.date") &&
    leaves.includes("الإجازة المنتهية تبقى في السجل"),
  "إجازات الطالب مرتبة من الأحدث مع علامة سارية / قادمة / منتهية، والمنتهية تبقى بالسجل",
  "كل إجازة يجب أن تعرض حالتها وتبقى المنتهية في السجل.",
);

must(
  leaves.includes('role="menu"') &&
    leaves.includes('role="menuitem"') &&
    leaves.includes("onEscapeKeyDown") &&
    leaves.includes("تأكيد الحذف") &&
    leaves.includes("لا توجد إجازات") &&
    leaves.includes("إضافة إجازة") &&
    leaves.includes("backToList") &&
    leaves.includes("// Back to the student's leaves.\n      setForm(null);"),
  "رجوع وإضافة إجازة بالأعلى، والتعديل والحذف في قائمة صغيرة، وبعد الحفظ رجوع تلقائي لإجازات الطالب",
  "يجب توفير رجوع/إضافة وقائمة تعديل/حذف والرجوع التلقائي بعد الحفظ.",
);

must(
  leaves.includes("studentLeaveApi") &&
    leaves.includes("/api/student-leaves?") &&
    leaves.includes("setLeaveRows"),
  "النافذة تقرأ إجازات الطالب من قاعدة البيانات داخل حالة مستقلة",
  "نافذة الإجازات يجب أن تعرض إجازات DB لا كاش studentLeaves فقط.",
);

must(
  leaves.includes("AbortController") &&
    leaves.includes("signal: controller.signal") &&
    leaves.includes("return () => controller.abort()"),
  "تحميل الإجازات يستخدم AbortController لمنع رجوع نتائج قديمة",
  "طلبات نافذة الإجازات يجب أن تُلغى عند تغيير الطالب أو المزامنة.",
);

must(
  leaves.includes("studentLeaveApi.add") &&
    !leaves.includes("addStudentLeave"),
  "حفظ الإجازة Server-first عبر studentLeaveApi.add وليس addStudentLeave المحلي",
  "لا يجوز استخدام addStudentLeave المحلي في نافذة الإجازات.",
);

must(
  leaves.includes("studentLeaveApi.remove") &&
    !leaves.includes("deleteStudentLeave"),
  "حذف الإجازة Server-first عبر studentLeaveApi.remove وليس deleteStudentLeave المحلي",
  "لا يجوز استخدام deleteStudentLeave المحلي في نافذة الإجازات.",
);

must(
  leaves.includes("leaves: selectedStudentLeaves") &&
    leaves.includes("buildStudentLeavePreview") &&
    leaves.includes("{ studentId, page: String(page), pageSize: \"500\" }") &&
    leaves.includes("توجد إجازة فترة سابقة لهذا الطالب") &&
    leaves.includes("هذا الطالب لديه إجازة سابقة على هذا الامتحان بالفعل"),
  "فحص التداخل يعتمد على كل إجازات الطالب القادمة من قاعدة البيانات",
  "فحص تداخل الإجازة يجب ألا يعتمد على كاش محلي قديم.",
);

must(
  leaves.includes("selectedLeavesLoading") &&
    leaves.includes("leaveSaving ||") &&
    leaves.includes("Boolean(selectedLeavesError) ||") &&
    leaves.includes("Boolean(selectedLeaveStudentBlockedReason)") &&
    leaves.includes("disabled={busy}") &&
    leaves.includes("if (leaveOperationRef.current) return;"),
  "الحفظ ينتظر سجل الطالب الصحيح ويمنع تكرار العملية أثناء الحفظ أو الحذف",
  "يجب ربط الحفظ بتحميل سجل الطالب وحماية عمليات الإجازات من التكرار.",
);

must(
  leaves.includes("version !== leaveMutationVersionRef.current") &&
    leaves.includes("selectedLeavesLoading && leaveRows.length === 0"),
  "النافذة تتجاهل الردود القديمة بعد الحفظ وتُبقي الصفوف أثناء التحديث",
  "يجب ألا تطبّق نافذة الإجازات رداً قديماً بعد الحفظ.",
);

must(
  leaves.includes("leaveRefreshKey") &&
    leaves.includes("setLeaveRefreshKey((current) => current + 1)") &&
    leaves.includes("setListRefreshKey((current) => current + 1)") &&
    leaves.includes("إعادة المحاولة"),
  "فشل تحميل الإجازات يعرض إعادة محاولة مباشرة بدون تحديث الصفحة كاملة",
  "يجب توفير زر إعادة محاولة يعيد طلب الإجازات بعد فشل الشبكة.",
);

must(
  leaves.includes("const leaveExamOptions = useMemo(") &&
    leaves.includes("exam.courseIds.includes(selectedLeaveStudent.courseId)") &&
    leaves.includes("{leaveExamOptions.map((exam) => (") &&
    leaves.includes('{ ...current, examId: "" }') &&
    leaves.includes("اختر امتحاناً تابعاً لدورة الطالب الحالية"),
  "منتقى إجازة الامتحان يعرض امتحانات دورة الطالب المختار فقط ويمسح الاختيار غير الصالح",
  "قائمة الامتحانات يجب أن تُفلتر حسب دورة الطالب قبل الحفظ.",
);

must(
  leaves.includes('<option key={exam.id} value={exam.id}>') &&
    leaves.includes("{exam.name} — {formatAppDate(exam.date)}") &&
    leaves.includes('<span>من تاريخ</span>') &&
    leaves.includes('<span>إلى تاريخ</span>') &&
    leaves.includes("leaveReasonOptions") &&
    leaves.includes('placeholder="اكتب سبب الإجازة"') &&
    leaves.includes("تاريخ توثيق الإجازة") &&
    leaves.includes("<span>ملاحظات</span>"),
  "النموذج: امتحان باسمه وتاريخه أو فترة من/إلى، والسبب، مع الملاحظات وتاريخ التوثيق اختيارياً",
  "نموذج الإجازة يجب ألا يفقد أي حقل من حقول الإجازة.",
);

must(
  leaves.includes('<p className="tp-modal__summary">{leaveSummary}</p>') &&
    leaves.includes("leaveHasConflicts &&") &&
    leaves.includes("noCourseExams &&") &&
    leaves.includes("periodPreviewExamCount === 0 &&") &&
    leaves.includes("تعديل هذه الإجازة"),
  "ملخص بسطر واحد فوق الحفظ، وتنبيه التداخل أو عدم وجود امتحانات يظهر عند الحاجة فقط",
);

must(
  preview.includes("leave.dateFrom || leave.date") &&
    preview.includes("leave.dateTo || leave.dateFrom || leave.date") &&
    preview.includes("existingRange.from <= range.to") &&
    preview.includes("existingRange.to >= range.from") &&
    leaves.includes("تتداخل مع النطاق المحدد"),
  "الواجهة تكشف أي تداخل فعلي بين فترات الإجازة بنفس قاعدة السيرفر",
  "فحص الواجهة يجب أن يمنع التداخل الجزئي لا التطابق الكامل فقط.",
);

must(
  leaves.includes("/api/student-leaves/context?studentId=") &&
    leaves.includes("payload.student?.id !== studentId") &&
    leaves.includes("!leavePreviewReady ||") &&
    contextRoute.includes('requirePermission(req, "follow-up.view")') &&
    contextRoute.includes('"Cache-Control": "private, no-store"'),
  "معاينة الإجازة تحمل امتحانات الطالب كاملة وتنتظرها قبل الحفظ بصلاحية الإجازات",
);

must(
  route.includes("coveredExamCount: affectedExamIds.length") &&
    route.includes("coveredExamCount: result.coveredExamCount") &&
    leaves.includes("coveredExamCount?: number") &&
    leaves.includes('leaveMode === "period" && coveredExamCount === 0') &&
    leaves.includes("لم تغطِّ أي امتحان تابع لدورة/موقع الطالب"),
  "إجازة الفترة ترجع عدد الامتحانات المغطاة وتحذر المستخدم عند صفر تغطية",
  "يجب إبلاغ المستخدم إذا حُفظت إجازة فترة ولم تؤثر على أي امتحان.",
);

must(
  leaves.includes("backedUpGrades") &&
    leaves.includes("restoredGradeCount") &&
    leaves.includes("استرجاع"),
  "الواجهة تعرض أثر حذف/حفظ الإجازة على الدرجات المحفوظة احتياطياً",
  "نافذة الإجازات يجب أن توضح حذف الدرجات أو استرجاعها بعد إجراءات الإجازة.",
);

must(
  leaves.includes("emitTeacherProDataChanged") &&
    leaves.includes("student-leave-created") &&
    leaves.includes("student-leave-deleted"),
  "إجراءات الإجازات تبث مزامنة لباقي النظام بعد نجاح الخادم",
  "حفظ/حذف الإجازة يجب أن يحدّث الصفحات المرتبطة مثل الدرجات والفرص والداشبورد.",
);

must(
  route.includes("withSerializableTransaction") &&
    route.includes("backupGradesForLeave") &&
    route.includes("restoreGradesForLeave") &&
    route.includes("recalculateStudentsAcademicState"),
  "API الإجازات يحفظ/يحذف داخل transaction تسلسلية مع نسخ احتياطي للدرجات وإعادة احتساب",
  "API الإجازات يجب أن يحمي الدرجات ويعيد الاحتساب داخل transaction تسلسلية.",
);

must(
  route.includes("requirePermission(req, \"follow-up.leaves.manage\")") &&
    route.includes("writeRequestAuditLog"),
  "API الإجازات محمي بالصلاحيات ويسجل Audit log",
  "API الإجازات يجب أن يتطلب صلاحيات المتابعة ويسجل تدقيقاً.",
);

must(
  api.includes("export const studentLeaveApi") &&
    api.includes('apiPost("student-leaves"') &&
    api.includes('apiDelete("student-leaves"'),
  "طبقة API الأمامية تحتوي studentLeaveApi للحفظ والحذف",
  "طبقة API يجب أن تحتوي studentLeaveApi.add/remove.",
);

must(
  String(pkg.scripts?.["test:student-leaves-integrity"] || "").startsWith(
    "node scripts/test-student-leaves-integrity.mjs",
  ) &&
    String(pkg.scripts?.["test:student-leaves-integrity"] || "").includes(
      "node --test scripts/test-student-leave-status.mjs",
    ),
  "سكريبت اختبار الإجازات مضاف إلى package.json",
  "يجب إضافة test:student-leaves-integrity إلى package.json.",
);

must(
  String(pkg.scripts?.["test:side-effects"] || "").includes(
    "test:student-leaves-integrity",
  ),
  "اختبار side-effects يشمل نافذة الإجازات",
  "يجب أن يشمل الفحص الشامل اختبار الإجازات.",
);

if (failed) {
  console.error("\nفشل اختبار سلامة صفحة الإجازات. راجع الرسائل أعلاه.");
  process.exit(1);
}

console.log("\nكل اختبارات سلامة صفحة الإجازات نجحت.");
