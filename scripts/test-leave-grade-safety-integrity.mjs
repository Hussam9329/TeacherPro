import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const gradeEntry = read("src/components/teacher-pro/grade-entry.tsx");
const gradeRecords = read("src/components/teacher-pro/grade-records.tsx");
const gradeRoute = read("src/app/api/grades/route.ts");
const writeback = read("src/lib/academic-grade-writeback-server.ts");
const leaveRoute = read("src/app/api/student-leaves/route.ts");
const followUp = read("src/components/teacher-pro/follow-up.tsx");
const offlineOutbox = read("src/lib/grade-entry-offline-outbox.ts");
const shared = read("src/lib/grade-leave-safety.ts");
const correctionRoute = read("src/app/api/correction-sheets/route.ts");
const telegramRoute = read("src/app/api/telegram-exam-submissions/route.ts");
const pkg = JSON.parse(read("package.json"));

let failed = false;
function must(condition, ok, bad) {
  if (condition) console.log(`✅ ${ok}`);
  else {
    failed = true;
    console.error(`❌ ${bad}`);
  }
}

must(
  shared.includes("LEAVE_END_CONFIRMATION_REQUIRED_CODE") &&
    shared.includes("requiresLeaveEndConfirmation") &&
    shared.includes("إجازة فترة") &&
    shared.includes("الفترة كاملة"),
  "رسالة وكود تأكيد إنهاء الإجازة معرفان في عقد مشترك",
  "يجب توحيد رسالة وكود تأكيد إنهاء الإجازة بين الواجهة والسيرفر.",
);

must(
  writeback.includes("requiresLeaveEndConfirmation") &&
    writeback.includes("realNumericGrade || input.blockOnLeave !== false") &&
    writeback.includes("confirmLeaveEnd") &&
    writeback.includes("LEAVE_END_CONFIRMATION_REQUIRED_CODE") &&
    !writeback.includes("requireLeaveEndConfirmation") &&
    writeback.indexOf("LEAVE_END_CONFIRMATION_REQUIRED_CODE") <
      writeback.indexOf("endLeavesCoveringExamForGrade("),
  "السيرفر يطلب التأكيد افتراضياً قبل تنفيذ إنهاء الإجازة",
  "يجب ألا يملك writeback مسار opt-in يسمح لكاتب آلي بإنهاء الإجازة بصمت.",
);

must(
  (gradeRoute.match(/confirmLeaveEnd: body\.confirmEndLeave === true/g) || [])
      .length >= 2 &&
    gradeRoute.includes("{ error: error.message, code: error.code }"),
  "API إدخال الدرجات وسجل الدرجات يمرران التأكيد ويرجعان كوداً منظماً",
  "يجب حماية POST وPUT معاً وإرجاع كود التأكيد للواجهتين.",
);

must(
  gradeEntry.includes("requestLeaveEndGradeConfirmation") &&
    gradeEntry.includes("confirmEndLeave: options.confirmLeaveEnd === true") &&
    gradeEntry.includes("errorPayload.code === LEAVE_END_CONFIRMATION_REQUIRED_CODE") &&
    gradeEntry.includes("تم اعتماد الدرجة وإنهاء الإجازة وإعادة احتساب الطالب."),
  "واجهة الدرجات تحذر قبل الحفظ وتتعامل أيضاً مع إجازة ظهرت من تبويب آخر",
  "يجب أن تغطي الواجهة التحذير المحلي ورفض السيرفر بسبب إجازة لم تكن محملة محلياً.",
);

must(
  gradeRecords.includes("leaveEndEditConfirmOpen") &&
    gradeRecords.includes("LEAVE_END_CONFIRMATION_REQUIRED_CODE") &&
    gradeRecords.includes("confirmEndLeave: options.confirmLeaveEnd === true") &&
    gradeRecords.includes("اعتماد الدرجة وإنهاء الإجازة"),
  "سجل الدرجات يعيد المحاولة فقط بعد تأكيد المستخدم الصريح",
  "يجب ألا يبقى PUT في سجل الدرجات قادراً على إنهاء الإجازة دون نافذة تأكيد.",
);

must(
  correctionRoute.includes("{ error: error.message, code: error.code }") &&
    telegramRoute.includes("{ error: error.message, code: error.code }") &&
    !correctionRoute.includes("confirmLeaveEnd: true") &&
    !telegramRoute.includes("confirmLeaveEnd: true"),
  "التصحيح وتيليجرام يتوقفان بكود واضح ولا يملكان تجاوزاً آلياً للتأكيد",
  "يجب منع مسارات التصحيح وتيليجرام من إنهاء الإجازة بصمت.",
);

must(
  offlineOutbox.includes("confirmEndLeave: boolean") &&
    offlineOutbox.includes("confirmEndLeave: item.confirmEndLeave") &&
    gradeEntry.includes("confirmEndLeave: options.confirmLeaveEnd === true") &&
    gradeEntry.includes("clearGradeEntryOfflineSave(offlineAttempt.key)"),
  "التأكيد الصريح يبقى محفوظاً إذا تأجل حفظ الدرجة بسبب انقطاع الإنترنت",
  "يجب حفظ التأكيد عند إعادة الإرسال وحذف المحاولة غير المؤكدة إذا ألغى المستخدم.",
);

must(
  leaveRoute.includes("absentBeforeRegistration") &&
    leaveRoute.includes("absentWithinGrace") &&
    leaveRoute.includes("skippedGradeRestores: result.skippedGradeRestores"),
  "حذف الإجازة يرجع أعداد الغياب الذي لم يُسترجع وأسبابه",
  "يجب أن يرجع API حذف الإجازة ملخص الغياب المتجاهل قبل التسجيل وضمن السماح.",
);

must(
  followUp.includes("skippedGradeRestores?.absentBeforeRegistration") &&
    followUp.includes("skippedGradeRestores?.absentWithinGrace") &&
    followUp.includes("تم تجاهل") &&
    followUp.includes("تم حذف الإجازة وإعادة احتساب الطالب."),
  "واجهة الإجازات تعرض نتيجة الحذف والاسترجاع والتجاهل بوضوح",
  "يجب أن تعرض الواجهة للمستخدم ما استُرجع وما تم تجاهله ولماذا.",
);

must(
  followUp.includes('selectedLeaveStudent?.status === "مؤرشف"') &&
    followUp.includes('selectedLeaveStudent?.status === "مفصول"') &&
    followUp.includes("Boolean(selectedLeaveStudentBlockedReason)") &&
    followUp.includes("role=\"alert\""),
  "الطالب المؤرشف/المفصول يظهر سبب المنع ويعطّل حفظ الإجازة",
  "يجب منع حفظ إجازة للمؤرشف/المفصول من الواجهة مع سبب واضح.",
);

must(
  String(pkg.scripts["test:student-leaves-integrity"] || "").includes(
    "test-leave-grade-safety-integrity.mjs",
  ) &&
    String(pkg.scripts["test:student-leaves-integrity"] || "").includes(
      "test-grade-leave-safety-behavior.mjs",
    ),
  "اختبارات الحماية الساكنة والسلوكية مربوطة بالفحص الشامل",
  "يجب ألا يبقى اختبار TP-PATCH-04 ملفاً ميتاً خارج سلسلة الاختبارات.",
);

if (failed) process.exit(1);
console.log("\nكل اختبارات TP-PATCH-04 — Leave / Grade Safety نجحت.");
