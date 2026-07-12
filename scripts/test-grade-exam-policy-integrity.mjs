#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let failed = false;
const must = (condition, ok, bad = ok) => {
  if (condition) console.log(`✅ ${ok}`);
  else {
    failed = true;
    console.error(`❌ ${bad}`);
  }
};

const gradeRoute = read("src/app/api/grades/route.ts");
const writeback = read("src/lib/academic-grade-writeback-server.ts");
const examRoute = read("src/app/api/exams/route.ts");
const botRoute = read("src/app/api/bot/exams/route.ts");
const correctionRoute = read("src/app/api/correction-sheets/route.ts");
const telegramRoute = read("src/app/api/telegram-exam-submissions/route.ts");
const examUtils = read("src/lib/exam-utils.ts");
const recalc = read("src/lib/academic-recalculate-server.ts");
const gradeClassification = read("src/lib/grade-classification.ts");
const gradeEntry = read("src/components/teacher-pro/grade-entry.tsx");
const gradeRecords = read("src/components/teacher-pro/grade-records.tsx");
const examNew = read("src/components/teacher-pro/exam-new.tsx");
const examRecords = read("src/components/teacher-pro/exam-records.tsx");
const leaveRoute = read("src/app/api/student-leaves/route.ts");
const migration = read(
  "prisma/migrations/20260712143000_grade_exam_integrity/migration.sql",
);
const pkg = JSON.parse(read("package.json"));

must(
  gradeEntry.includes("محفوظة للمتابعة فقط") &&
    gradeEntry.includes("يسبق تاريخ تسجيله في الدورة") &&
    gradeRecords.includes("تسجيل الطالب في الدورة"),
  "الواجهة تشرح دائماً أن الدرجة السابقة للتسجيل محفوظة بلا خصم",
  "يجب إظهار سبب استبعاد الدرجة السابقة لتسجيل الطالب في ورقة الإدخال وسجل الدرجات.",
);

must(
  gradeRoute.includes("لا يمكن نقل الدرجة إلى طالب آخر") &&
    gradeRoute.includes("لا يمكن نقل الدرجة إلى امتحان آخر") &&
    gradeRoute.includes("targetGrade.studentId") &&
    gradeRoute.includes("targetGrade.examId"),
  "مسار تعديل الدرجة يمنع تغيير الطالب أو الامتحان ويستخدم العلاقة الأصلية",
  "تعديل الدرجة يجب ألا يقبل studentId أو examId جديدين.",
);

must(
  migration.includes("prevent_grade_relation_change") &&
    migration.includes('BEFORE UPDATE OF "studentId", "examId"'),
  "قاعدة البيانات تمنع تغيير علاقة الدرجة حتى لو تم تجاوز مسار API",
  "يجب وجود Trigger قاعدة بيانات يثبت علاقة الدرجة.",
);

must(
  writeback.includes("evaluateStudentExamEligibility") &&
    writeback.includes("allowDismissedExistingGradeCorrection") &&
    writeback.includes("lockStudentsAcademicState") &&
    writeback.includes("withSerializableTransaction") &&
    correctionRoute.includes("syncAcademicGradeWriteback") &&
    telegramRoute.includes("syncAcademicGradeWriteback"),
  "التصحيح والبوت يخضعان لنفس فحص حالة الطالب والدورة مثل تسجيل الدرجات",
  "كل مصادر اعتماد الدرجات يجب أن تمر بالعقدة الخادمية الموحدة.",
);

must(
  writeback.includes("Number.isInteger(numeric)") &&
    writeback.includes("الدرجات الكسرية غير مدعومة") &&
    examNew.includes("Number.isInteger") &&
    examRecords.includes("Number.isInteger") &&
    !writeback.includes("Math.trunc(numeric)"),
  "الدرجات الكسرية تُرفض بوضوح ولا تُقص بصمت في أي مسار",
  "يجب رفض الكسور في العقدة الموحدة والواجهات بدل Math.trunc.",
);

must(
  writeback.includes('status === "درجة" ? score : null') &&
    migration.includes("WHERE \"status\" IN ('غائب', 'غش')") &&
    migration.includes('"status" = \'درجة\' OR "score" IS NULL') &&
    leaveRoute.includes('backup.status === "درجة" ? backup.score : null'),
  "التحويل إلى غائب أو غش ينظف الدرجة الرقمية مع قيد قاعدة بيانات",
  "كل المسارات وترحيل البيانات يجب أن يمنعوا قيمة رقمية خلف حالة غير رقمية.",
);

must(
  gradeRoute.includes("if (!hasAcademicMutation)") &&
    gradeRoute.includes("academicRecalculation: null") &&
    gradeRecords.includes("مؤشر متابعة فقط؛ لا يعتمد أو يلغي الخصم") &&
    gradeRecords.includes("مراجعة السجل (لا تؤثر على الخصم)"),
  "حقل مراجعة السجل معلوماتي فقط ولا يعيد الاحتساب أو يوحي بتغيير الخصم",
  "حقل المراجعة يجب أن يبقى Metadata واضحاً لا إجراءً أكاديمياً.",
);

must(
  writeback.includes("checkAvailability: input.enforceExamAvailability !== false") &&
    writeback.includes("eligibility.reason") &&
    gradeClassification.includes('"unavailable-exam"') &&
    gradeRecords.includes("غير محتسبة حالياً"),
  "الامتحان المعطل أو المستقبلي يرفض الدرجات ويظهر سبب عدم الاحتساب للقديم",
  "يجب منع الحفظ غير المتاح وتصنيف أي سجل تاريخي بوضوح.",
);

must(
  examRoute.includes("confirmExistingGrades") &&
    examRoute.includes("درجة محفوظة") &&
    examRecords.includes("قد يجعل الدرجات المحفوظة سابقاً مؤثرة") &&
    migration.includes("Quarantine legacy grades") &&
    migration.includes('"scheduledActivateAt" = NULL'),
  "الدرجات القديمة في الامتحانات المستقبلية تُحجر ولا تتفعّل لاحقاً بلا تأكيد صريح",
  "يجب منع الأثر المفاجئ للسجلات القديمة عند التفعيل التلقائي أو اليدوي.",
);

must(
  examRoute.includes("mainSite: data.mainSite ?? existingExam.mainSite") &&
    examRoute.includes("candidateValidationMessage"),
  "تعديل الامتحان يمرر mainSite الحقيقي إلى التحقق ولا يُرفض دائماً",
  "يجب إصلاح نقص mainSite في validateExamPayload أثناء التعديل.",
);

must(
  examUtils.includes("A future activation is authoritative") &&
    examUtils.includes("if (activateAt && activateAt > now)") &&
    examRoute.includes("effectiveStoredActive") &&
    examRoute.includes("data.active = false"),
  "التفعيل المستقبلي يبقي الامتحان غير متاح حتى يحين موعده",
  "active=true لا يجوز أن يتجاوز scheduledActivateAt المستقبلي.",
);

must(
  botRoute.includes("evaluateStudentExamEligibility") &&
    botRoute.includes("checkAvailability: true") &&
    botRoute.includes("checkRegistration: true") &&
    !botRoute.includes("where: { active: true"),
  "قائمة امتحانات البوت تستخدم حالة الإتاحة والأهلية الزمنية الموحدة",
  "البوت يجب ألا يعتمد على active:true الخام.",
);

must(
  examRoute.includes("parseBaghdadDateOnly") &&
    examUtils.includes("baghdadTodayKey") &&
    read("src/lib/baghdad-time.ts").includes("parseBaghdadDateOnly"),
  "تاريخ الامتحان والحكم على اليوم يُفسران كتاريخ بغداد",
  "يجب ألا يعتمد تاريخ الامتحان على new Date الخام أو توقيت الخادم.",
);

must(
  examRoute.includes("hasAcademicExamChange(existingExam, exam)") &&
    examRoute.includes("recalculateStudentsForExam") &&
    recalc.includes("periodLeaveDates") &&
    recalc.includes('leaveType: "period"') &&
    examRoute.includes("[existingExam.date, exam.date]"),
  "تعديل حدود الامتحان أو تاريخه يعيد احتساب الدرجات وإجازات الفترة القديمة والجديدة",
  "إعادة الاحتساب يجب أن تشمل المجازين بالفترة عند تغيير تاريخ الامتحان.",
);

must(
  recalc.includes("client.studentCall.findMany") &&
    recalc.includes("client.correctionSheet.findMany") &&
    recalc.includes("client.telegramExamSubmission.findMany") &&
    recalc.includes("client.opportunityLog.findMany") &&
    recalc.includes("client.studentLeaveGradeBackup.findMany"),
  "إعادة احتساب الامتحان تجمع جميع الطلاب المرتبطين لا أصحاب الدرجات فقط",
  "قائمة المتأثرين يجب أن تشمل المكالمات والتصحيح والبوت والفرص ونسخ الإجازات.",
);

must(
  examRoute.includes("gradeCount") &&
    examRoute.includes("leaveCount") &&
    examRoute.includes("callCount") &&
    examRoute.includes("correctionSheetCount") &&
    examRoute.includes("telegramSubmissionCount") &&
    examRoute.includes("opportunityLogCount") &&
    examRoute.includes("missingNoteCount") &&
    examRoute.includes("leaveBackupCount") &&
    examRoute.includes("عطّل الامتحان بدلاً من حذفه"),
  "حذف الامتحان ممنوع عند وجود أي بيانات تابعة وليس الدرجات فقط",
  "الحذف يجب أن يحمي كل العلاقات التاريخية ويوجه إلى التعطيل.",
);

must(
  migration.includes("Grade_status_score_consistency") &&
    migration.includes("Grade_prevent_relation_change"),
  "ترحيل قاعدة البيانات يثبت اتساق الدرجة والعلاقة",
  "الحماية يجب ألا تعتمد على الواجهة وحدها.",
);

must(
  pkg.scripts?.["test:grade-exam-policy-integrity"] ===
    "node scripts/test-grade-exam-policy-integrity.mjs" &&
    String(pkg.scripts?.["test:side-effects"] || "").includes(
      "test:grade-exam-policy-integrity",
    ),
  "اختبار سياسة الدرجات والامتحانات مضاف للحزمة الشاملة",
  "يجب تشغيل الاختبار الجديد ضمن test:side-effects.",
);

if (failed) {
  console.error("\nفشل اختبار سلامة سياسة الدرجات والامتحانات.");
  process.exit(1);
}
console.log("\nكل اختبارات سياسة الدرجات والامتحانات نجحت.");
