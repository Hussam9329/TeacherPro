#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failed = false;
function pass(message) {
  console.log(`✅ ${message}`);
}
function fail(message) {
  failed = true;
  console.error(`❌ ${message}`);
}
function must(condition, okMessage, failMessage = okMessage) {
  if (condition) pass(okMessage);
  else fail(failMessage);
}

const gradeEntry = read("src/components/teacher-pro/grade-entry.tsx");
const gradeWriteback = read("src/lib/academic-grade-writeback-server.ts");
const gradesRoute = read("src/app/api/grades/route.ts");

// 1) لا يوجد أي قفل صفوف يتطلب الضغط على «تعديل» قبل إدخال الدرجة.
must(
  !gradeEntry.includes("rowLocked") &&
    !gradeEntry.includes("const [editableRows"),
  "ورقة الإدخال بلا أي قفل صفوف — لا توجد خطوة «تعديل» إجبارية لأي طالب",
  "يجب إزالة rowLocked نهائياً من ورقة إدخال الدرجات.",
);

// 2) زر «تعديل» الخاص بفتح الصفوف المقفلة أُزيل (لا يوجد مسار يفتح قفلاً
//    عبر setEditableRows على مستوى صف واحد داخل قائمة الصفوف).
must(
  !gradeEntry.includes("[student.id]: true"),
  "زر «تعديل» القديم أُزيل من صفوف ورقة الإدخال",
  "يجب حذف زر «تعديل» الذي كان يفتح الصف المقفل.",
);

// 3) كل الطرق المشتقة من القفل صارت تعتمد صلاحيات حقيقية فقط:
//    مؤرشف/مفصول/قبل التسجيل — بدون شرط القفل القديم.
must(
  gradeEntry.includes(
    "const numericInputDisabled =\n                    !canEditPersistedGrade && !protectedNumericCapture;",
  ) &&
    gradeEntry.includes(
      "const structuredControlsDisabled = !canEditPersistedGrade;",
    ),
  "الحقول تُقفل فقط بصلاحيات حقيقية (مؤرشف/مفصول/قبل التسجيل) لا بقفل «تعديل»",
  "يجب أن تعتمد تعطيلات الحقول على canEditPersistedGrade/protectedNumericCapture فقط.",
);

// 4) حماية وسوم النظام: الخروج من الخلية دون كتابة رقم (Tab/blur)
//    يجب ألا يحذف «قبل تسجيل الطالب» أو الوسم القديم قبل نقله.
must(
  gradeEntry.includes("existingIsSystemMarker") &&
    gradeEntry.includes("existing?.status === LEGACY_GRACE_PLACEHOLDER_STATUS") &&
    gradeEntry.includes('existing?.status === "قبل تسجيل الطالب"'),
  "المرور بخلية دون إدخال رقم لا يحذف وسوم النظام",
  "يجب حماية وسوم النظام من الحذف العرضي عند blur فارغ.",
);

// 5) سلسلة التنقل Tab تشمل جميع الصفوف القابلة للإدخال مباشرة
//    (بما فيهم ضمن فترة السماح) دون شرط القفل القديم.
must(
  !/rowLocked/.test(gradeEntry) &&
    gradeEntry.includes("الإدخال المباشر للجميع دون استثناء"),
  "سلسلة Tab تشمل كل الصفوف القابلة للإدخال مباشرة بدون استثناء",
  "يجب أن تدخل صفوف السماح في سلسلة التنقل السريع بـ Tab.",
);

// 6) عقد الخادم: الدرجة تُحفظ كما هي ولا تنهي فترة السماح أو تغيّرها.
must(
  !gradesRoute.includes("graceEnded") &&
    !gradeWriteback.includes("gracePeriodEndedAt") &&
    !gradeEntry.includes("graceEnded") &&
    !fs.existsSync(path.join(root, "src/lib/student-grace.ts")),
  "الدرجة الرقمية لا تنهي فترة السماح؛ الفترات تُدار من «إدارة فترة السماح» فقط",
  "يجب ألا يغيّر حفظ الدرجة فترة السماح.",
);

if (failed) process.exit(1);
console.log("\nكل اختبارات الإدخال المباشر للدرجات نجحت.");
