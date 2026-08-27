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
const route = read("src/app/api/dismissed-students/history/route.ts");
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
  page.includes("/api/dismissed-students/list?") &&
    page.includes("pageSize: String(PAGE_SIZE)") &&
    page.includes('params.set("courseId", courseId)') &&
    page.includes('params.set("q", debouncedSearch.trim())') &&
    page.includes("if (page > nextTotalPages)") &&
    page.includes("setPage(nextTotalPages)"),
  "القائمة تستخدم البحث والدورة والترقيم الخادمي وتصحح الصفحة الخارجة عن المدى",
);

must(
  route.includes("requirePermissionPrincipal") &&
    route.includes('"students.view"') &&
    route.includes("async (tx) =>") &&
    route.includes('{ isolationLevel: "RepeatableRead" }') &&
    route.includes("tx.student.findFirst") &&
    route.includes('status: "مفصول"') &&
    route.includes("{ status: 400 }") &&
    route.includes("{ status: 404 }"),
  "API السجل محمي ويقرأ لقطة RepeatableRead ويتحقق من الطالب المفصول",
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

if (failed) {
  console.error("\nفشل اختبار سلامة إدارة المفصولين.");
  process.exit(1);
}
console.log("\nكل اختبارات سلامة إدارة المفصولين نجحت.");
