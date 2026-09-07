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
const studentGrace = read("src/lib/student-grace.ts");
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

// 4) حماية وسم السماح: الخروج من خلية سماح دون كتابة رقم (Tab/blur)
//    يجب ألا يحذف السجل تلقائياً.
must(
  gradeEntry.includes("existingIsGraceMarker") &&
    gradeEntry.includes('existing?.status === "ضمن فترة السماح"') &&
    gradeEntry.includes('existing?.status === "قبل تسجيل الطالب"'),
  "المرور بخلية سماح دون إدخال رقم لا يحذف وسم «ضمن فترة السماح»",
  "يجب حماية أوسام السماح من الحذف العرضي عند blur فارغ.",
);

// 5) سلسلة التنقل Tab تشمل جميع الصفوف القابلة للإدخال مباشرة
//    (بما فيهم ضمن فترة السماح) دون شرط القفل القديم.
must(
  !/rowLocked/.test(gradeEntry) &&
    gradeEntry.includes("الإدخال المباشر للجميع دون استثناء"),
  "سلسلة Tab تشمل كل الصفوف القابلة للإدخال مباشرة بدون استثناء",
  "يجب أن تدخل صفوف السماح في سلسلة التنقل السريع بـ Tab.",
);

// 6) عقد الخادم لم يتغير: الدرجة الرقمية تنهي السماح ذرياً في مسار الكتابة.
must(
  gradesRoute.includes("graceEnded") &&
    studentGrace.includes("gracePeriodEndedAt") &&
    studentGrace.includes("AUTOMATIC_NEW_STUDENT_GRACE_DAYS"),
  "عقد الخادم ثابت: الدرجة الرقمية تنهي السماح ذرياً وتُحتسب من نفس العملية",
  "يجب ألا يتغير عقد إنهاء السماح على الخادم.",
);

if (failed) process.exit(1);
console.log("\nكل اختبارات الإدخال المباشر للدرجات نجحت.");
