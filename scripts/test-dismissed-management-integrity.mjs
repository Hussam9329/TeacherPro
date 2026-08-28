#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let failed = false;

function must(condition, success, failure = success) {
  if (condition) console.log(`✅ ${success}`);
  else {
    failed = true;
    console.error(`❌ ${failure}`);
  }
}

const page = read("src/components/teacher-pro/dismissed-management.tsx");
const route = read("src/app/api/dismissed-management/history/route.ts");
const listRoute = read("src/app/api/dismissed-management/list/route.ts");
const statsRoute = read("src/app/api/dismissed-management/stats/route.ts");
const helper = read("src/lib/dismissed-history.ts");
const profileServer = read("src/lib/student-profile-server.ts");
const layout = read("src/components/teacher-pro/layout.tsx");
const store = read("src/lib/teacher-store.ts");
const pkg = JSON.parse(read("package.json"));

must(
  store.includes('| "dismissed-management"') &&
    store.includes('"dismissed-management": "students.view"') &&
    layout.includes('id: "dismissed-management"') &&
    layout.includes('"dismissed-management": DismissedManagementView'),
  "صفحة إدارة المفصولين مربوطة بالقائمة والنوع والصلاحية والمكوّن",
);

must(
  page.includes("/api/dismissed-management/list?") &&
    page.includes("pageSize: String(PAGE_SIZE)") &&
    page.includes('params.set("courseId", courseId)') &&
    page.includes('params.set("q", debouncedSearch.trim())') &&
    page.includes("if (page > nextTotalPages)") &&
    page.includes("setPage(nextTotalPages)"),
  "القائمة تستخدم البحث والدورة والترقيم الخادمي وتصحح الصفحة الخارجة عن المدى",
);

must(
  page.includes("/api/dismissed-management/stats?") &&
    page.includes('params.set("notesFilter", notesFilter)') &&
    page.includes('params.set("pledgeFilter", pledgeFilter)') &&
    listRoute.includes("buildDismissedStudentWhere(searchParams)") &&
    statsRoute.includes("buildDismissedStudentWhere(searchParams)") &&
    statsRoute.includes("db.$transaction") &&
    statsRoute.includes("withPledge") &&
    statsRoute.includes("withoutPledge"),
  "الإدارة تحتفظ بإحصائيات وفلاتر الملاحظات والتعهد من نفس المصدر الخادمي",
);

must(
  page.includes("handleSaveDismissalNote") &&
    page.includes("canEditDismissalNotes") &&
    page.includes('student.status !== "مفصول"') &&
    page.includes("expectedMutationToken: student.mutationToken") &&
    page.includes('reason: "dismissed-management-note"'),
  "تحرير ملاحظات الفصل انتقل إلى الإدارة مع صلاحية وSnapshot ومزامنة",
);

must(
  route.includes("requirePermissionPrincipal") &&
    route.includes('"students.view"') &&
    route.includes("async (tx) =>") &&
    route.includes('{ isolationLevel: "RepeatableRead" }') &&
    route.includes("tx.student.findFirst") &&
    route.includes('status: { in: ["مفصول", "نشط"] }') &&
    route.includes('student.status !== "مفصول" && !currentDismissalAt') &&
    route.includes("{ status: 400 }") &&
    route.includes("{ status: 404 }"),
  "API السجل محمي ويقرأ لقطة RepeatableRead ويتحقق من المفصول الحالي أو المفصول سابقاً",
);

must(
  route.includes("historyAccess.calls") &&
    route.includes("historyAccess.leaves") &&
    route.includes("historyAccess.studentNotes") &&
    route.includes("historyAccess.allStudentNotes") &&
    helper.includes('"follow-up.calls.view"') &&
    helper.includes('"follow-up.leaves.view"') &&
    helper.includes('"follow-up.pledges.view"') &&
    page.includes("history.sections.calls") &&
    page.includes("history.sections.leaves") &&
    page.includes("history.sections.notes"),
  "صلاحيات المكالمات والإجازات والملاحظات مستقلة خادمياً ومرئياً",
);

must(
  route.includes("sanitizeHistoryArchiveSnapshot") &&
    route.includes("sanitizeEnrollmentArchiveSnapshot") &&
    route.includes("followUp: false") &&
    profileServer.includes('allowed.add("gradeSmartNotes")') &&
    profileServer.includes('countKeys.add("gradeSmartNotes")'),
  "الأرشيف يُعقّم قبل استخراج الأحداث ويحتفظ بملاحظات الدرجات للمصرح لهم فقط",
);

must(
  route.includes("CALL_STUDENT_NOTE_CATEGORY") &&
    route.includes("hasManualCallNote") &&
    route.includes("pushManualCallNoteEvents") &&
    route.includes('title: "ملاحظة متابعة"'),
  "ملاحظات المتابعة اليدوية تُعرض كملاحظات ولا تُحتسب كمكالمات",
);

must(
  route.includes("select: {") &&
    !route.includes("pages: true") &&
    !route.includes("sourceMessageIds: true") &&
    !route.includes("telegramChatId: true") &&
    route.includes('"Cache-Control": "private, no-store, max-age=0"'),
  "استعلامات السجل ضيقة والاستجابة الحساسة غير قابلة للتخزين المؤقت",
);

must(
  page.includes("historyControllersRef") &&
    page.includes("controller.abort()") &&
    page.includes("signal: controller.signal") &&
    page.includes("historyControllersRef.current.get(studentId) !== controller"),
  "طلبات السجل تُلغى ولا تعيد بيانات قديمة بعد المزامنة أو تغيير الصفحة",
);

must(
  page.includes("fullTelegramMessage") &&
    page.includes("buildDismissedTelegramReport") &&
    page.includes("canUseDirectDismissedTelegramDraft") &&
    page.includes("canUseSingleDismissedTelegramMessage") &&
    page.includes("navigator.clipboard.writeText(completeMessage)") &&
    page.includes("downloadHistoryHtml(history)") &&
    page.includes("أطول من حد رسالة تيليجرام") &&
    page.includes("if (!history) return") &&
    page.includes("window.location.assign") &&
    !page.includes("window.location.href =") &&
    !page.includes("function historyText") &&
    !page.includes("s.dismissalType") &&
    helper.includes("buildDismissedTelegramReport") &&
    helper.includes("DISMISSED_TELEGRAM_SINGLE_MESSAGE_MAX_LENGTH") &&
    route.includes("تاريخ الامتحان"),
  "تيليجرام يبني تقرير امتحانات احترافياً ويستخدم إرسالاً ونسخاً وملفاً احتياطياً دون فقدان",
);

must(
  route.includes("classifyDismissedOpportunityMovement") &&
    route.includes('movement === "deduction"') &&
    helper.includes("classifyDismissedOpportunityMovement"),
  "السجل المرئي وتقرير تيليجرام يصنفان الخصم والإضافة من نوع الإجراء لا إشارة المقدار القديم",
);

must(
  page.includes("escapeDismissedHistoryHtml") &&
    page.includes("safeDismissedHistoryFileName") &&
    page.includes("URL.revokeObjectURL") &&
    helper.includes(".slice(0, 120)"),
  "تقرير HTML واسم الملف يعقّمان مدخلات المستخدم ويحرران رابط التنزيل",
);

must(
  pkg.scripts?.["test:dismissed-management-integrity"] ===
      "node scripts/test-dismissed-management-integrity.mjs && node --experimental-strip-types --test scripts/test-dismissed-management-behavior.mjs" &&
    String(pkg.scripts?.["test:side-effects"] || "").includes(
      "test:dismissed-management-integrity",
    ),
  "اختبارات إدارة المفصولين مربوطة رسمياً باختبارات الآثار الجانبية",
);

must(
  page.includes('action: "reactivate"') &&
    page.includes("expectedMutationToken") &&
    page.includes("students.edit") &&
    page.includes("canReactivate") &&
    page.includes("useActionLock") &&
    page.includes("استرجاع الطالب") &&
    page.includes("سيزول الفصل الحالي ويصبح الطالب نشطاً برصيد فرصتين"),
  "إدارة المفصولين هي واجهة الاسترجاع وتستخدم status-action مع قفل وصلاحية وSnapshot",
  "يجب أن يكون زر استرجاع المفصول داخل إدارة المفصولين فقط وبآلية خادمية محمية.",
);

if (failed) {
  console.error("\nفشل اختبار سلامة إدارة المفصولين.");
  process.exit(1);
}
console.log("\nكل اختبارات سلامة إدارة المفصولين نجحت.");
