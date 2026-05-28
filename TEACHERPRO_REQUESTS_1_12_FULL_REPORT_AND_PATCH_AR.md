# TeacherPro — تقرير التعديلات الكامل مع الإرشادات والكود

تاريخ التنفيذ: 2026-05-28  
النطاق: تعديل مشروع `TeacherPro-main` حسب الصور والطلبات رقم 1 إلى 12، مع الحفاظ على ربط المنطق بين الفصول، الامتحانات، الدرجات، الفصل، المحاسبة والتقارير.

> ملاحظة مهمة: ملف التقرير هذا يحتوي الخطة، أماكن الملفات، أرقام الأسطر التقريبية بعد التعديل، وطريقة التطبيق. في آخر الملف يوجد Unified Diff كامل لكل الكود المعدل، لذلك كل التعديلات موجودة في ملف واحد.

---

## طريقة التطبيق السريعة

1. افتح المشروع المعدل.
2. انسخ الملفات المعدلة إلى مشروعك أو طبّق الـ diff الموجود في آخر هذا التقرير.
3. شغّل أوامر قاعدة البيانات بعد إضافة حقول جدولة الامتحان:

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

4. ادخل للنظام من واجهة تسجيل الدخول الجديدة:

```text
اسم المستخدم: admin
الرمز: 1993
```

---

## ملخص التنفيذ حسب الصور والطلبات

### الصورة 1 — منع إنشاء امتحان لدورة غير مربوطة بفصل نشط

**الحالة: تم.**  
افتح الملف: `src/components/teacher-pro/exam-new.tsx`

- السطر 173: `validateForm` يرفض أي دورة لا تملك فصل نشط.
- السطر 203: `renderCourseSelector` يعطّل اختيار الدورة غير المربوطة بفصل ويعرض شارة `لم يتم اختيار فصل`.
- السطر 268: إدارة الحضور تستبعد أي طالب بدورته لا تملك فصل نشط.

النتيجة: إذا ضفت فصل فقط لدورة الإعفاء، فلن تقدر تختار دورة 6-1 أو 8-1 داخل الامتحان ما لم تربطها بفصل نشط.

### الصورة 2 — حالات الامتحان

**الحالة: تم.**  
افتح الملفات:

- `src/components/teacher-pro/exam-new.tsx` — السطر 239: واجهة اختيار الحالة.
- `src/lib/exam-utils.ts` — السطر 22: دالة `getExamStatus`.
- `prisma/schema.prisma` — السطر 116: حقول الجدولة الجديدة.
- `src/app/api/exams/route.ts` — الأسطر 53 و82: حفظ التفعيل/التعطيل المجدول.

الحالات المدعومة الآن:

1. `نشط`
2. `تفعيل مجدول`
3. `تعطيل مجدول`
4. `معطل`

### الصورة 3 — بحث ومسح QR داخل إدخال الدرجات

**الحالة: تم.**  
افتح الملف: `src/components/teacher-pro/grade-entry.tsx`

- السطر 126: `handleQuickScan` يفتح نافذة لإدخال أو مسح كود الطالب/QR.
- السطر 199: زر `بحث / مسح QR`.
- السطر 69: فلترة الطلاب بالبحث والكود والتليكرام والهاتف.

### الصورة 4 — فلاتر بسيطة + بحث + إدخال مباشر + حفظ تلقائي + حالات

**الحالة: تم.**  
افتح الملف: `src/components/teacher-pro/grade-entry.tsx`

- السطر 98: `saveGrade` يحفظ تلقائياً.
- الأسطر 132 وما بعدها: واجهة الفلاتر.
- السطر 247: بوكس إدخال الدرجة المباشر.
- السطر 263: Dropdown للحالات: `درجة / غائب / مجاز / غش`.
- السطر 277: شارة توضح حالة الحفظ مثل `تم HH:MM` أو `محفوظ`.

النتيجة: لا تحتاج زر إدخال لكل طالب. تكتب الدرجة مباشرة، أو تغيّر الحالة، ويتم الحفظ تلقائياً.

### الصورة 5 — اختفاء الطلاب غير المربوطين بفصل بعد إدخال الدرجات

**الحالة: تم إصلاح السبب.**  
افتح الملفات:

- `src/components/teacher-pro/grade-entry.tsx` — السطر 69: لا يظهر الطالب إلا إذا كانت دورته مربوطة بفصل نشط.
- `src/components/teacher-pro/exam-new.tsx` — السطر 173: لا يتم إنشاء امتحان بدورة بلا فصل أصلاً.
- `src/lib/teacher-store.ts` — السطر 779: إعادة احتساب آثار الدرجات على الفرص والفصل.

النتيجة: لا يتم إدخال درجات لكيانات غير صحيحة، وبعد التعديل يمكن تعديل الدرجة لاحقاً من سجل الدرجات بدون حذف السجل.

### الصورة 6 — تحسين PDF + Export Excel/CSV + تقارير HTML احترافية + تخصيص + A4

**الحالة: تم.**  
افتح الملف: `src/components/teacher-pro/exam-records.tsx`

- السطر 99: تصدير CSV.
- السطر 120: تصدير Excel بصيغة `.xls` قابلة للفتح في Excel.
- السطر 135: تصدير PDF عبر HTML احترافي.
- السطر 152: تخصيص التقرير.
- السطر 322: نافذة تخصيص التقرير.

ميزات التقرير:

- Header احترافي باسم TeacherPro.
- كروت إحصائيات داخل التقرير.
- جدول مرتب RTL.
- زر طباعة.
- اختيار A4 بالطول أو بالعرض.
- خيارات إظهار/إخفاء الهاتف، التليكرام، والملاحظات.

### الصورة 7 — تعديل كل تفاصيل الامتحان وإعادة تأثيرها على الطلاب

**الحالة: تم.**  
افتح الملفات:

- `src/components/teacher-pro/exam-new.tsx` — السطر 281: `saveExamEdit`.
- `src/lib/teacher-store.ts` — السطر 1394: `updateExam` يستدعي إعادة الاحتساب.
- `src/lib/teacher-store.ts` — السطر 779: محرك إعادة احتساب الفصل والفرص.

النتيجة: من زر `تعديل كل التفاصيل` يمكنك تعديل الاسم، النوع، الدورات، المواقع، المجموعات، الدرجة الكاملة، النجاح، الخصم، خصم الفرص، درجة الفصل، والحالة. بعد الحفظ يعاد احتساب الطلاب؛ الطالب المفصول آلياً ممكن يرجع نشط إذا لم تعد القاعدة تنطبق عليه.

### الصورة 8 — تعديل الدرجة من سجل الدرجات بدون Prompt

**الحالة: تم.**  
افتح الملف: `src/components/teacher-pro/grade-records.tsx`

- السطر 88: فتح نافذة تعديل الدرجة.
- السطر 101: حفظ تعديل الدرجة.
- السطر 220: زر تعديل يفتح Dialog.
- السطر 260: أزرار حفظ/إلغاء.

التعديل الآن يدعم:

- درجة رقمية.
- غائب.
- غش.
- مجاز.
- ملاحظات.
- تعليم السجل كمراجع من المحاسبة.

### الصورة 9 — إضافة واجهة المحاسبة / الأقساط

**الحالة: تم.**  
افتح الملفات:

- `src/components/teacher-pro/accounting.tsx` — السطر 36: الواجهة الجديدة.
- `src/components/teacher-pro/layout.tsx` — السطر 91: إضافة التبويبة للقائمة.
- `src/lib/teacher-store.ts` — السطر 334: صلاحيات المحاسبة.

الواجهة الجديدة تحتوي:

- بحث باسم الطالب/الكود/الهاتف/الوصل.
- فلترة حسب الدورة وحالة الدفع.
- إجمالي المطلوب والمدفوع والمتبقي.
- إضافة دفعة قسط.
- عرض سجل الأقساط لكل طالب.
- تصدير CSV.

### الصورة 10 — إذا لا يوجد فصل للدورة يظهر صفر ورسالة

**الحالة: تم.**  
افتح الملف: `src/components/teacher-pro/student-registry.tsx`

- السطر 835: بطاقة الطالب تعرض `0 / 0 - لم يتم اختيار الفصل لهم بعد` عند عدم وجود فصل نشط لدورته.
- السطر 1513: ملف الطالب يعرض نفس الرسالة.

### الطلب 11 — واجهة تسجيل دخول احترافية

**الحالة: تم.**  
افتح الملفات:

- `src/components/teacher-pro/layout.tsx` — السطر 203: `LoginScreen`.
- `src/lib/teacher-store.ts` — السطر 1042: دالة `login`.
- `src/lib/teacher-store.ts` — المستخدم الافتراضي أصبح `admin / 1993`.
- `src/app/api/backup/route.ts` و `src/app/api/users/route.ts`: إرجاع كلمة المرور المخزنة للحسابات حتى تعمل عند تحميل البيانات من قاعدة البيانات.

### الطلب 12 — تبويبة الأقساط الخاصة بالدورة الخاصة ضمن عائلة الطلاب

**الحالة: تم.**  
افتح الملف: `src/components/teacher-pro/layout.tsx`

- السطر 91: عنصر القائمة `الأقساط والمحاسبة`.
- السطر 115: إضافته لعائلة `الطلاب`.
- السطر 153 و170: ربط المكوّن `AccountingView`.

---

## التعديلات التي كانت موجودة جزئياً وتم التعامل معها كـ Skip/تحسين فقط

- منطق تسجيل الطالب كان يحتوي أساساً على ربط الفرص بالفصل النشط عند التسجيل؛ لم أعد كتابة هذا الجزء بالكامل. تم فقط تحسين العرض في سجل الطلاب حتى يظهر `0 / 0 - لم يتم اختيار الفصل لهم بعد` عند عدم وجود فصل نشط.
- التصدير CSV كان موجوداً في بعض السجلات سابقاً؛ تم توحيده وتحسينه وإضافة Excel/PDF احترافي لسجل الامتحانات.

---

## قائمة الملفات المعدلة/المضافة

### ملفات مضافة

- `src/lib/exam-utils.ts`
- `src/components/teacher-pro/accounting.tsx`

### ملفات معدلة

- `src/components/teacher-pro/layout.tsx`
- `src/components/teacher-pro/exam-new.tsx`
- `src/components/teacher-pro/grade-entry.tsx`
- `src/components/teacher-pro/exam-records.tsx`
- `src/components/teacher-pro/grade-records.tsx`
- `src/components/teacher-pro/student-registry.tsx`
- `src/lib/teacher-store.ts`
- `src/app/api/exams/route.ts`
- `src/app/api/backup/route.ts`
- `src/app/api/users/route.ts`
- `prisma/schema.prisma`

---

## فحص سريع بعد التعديل

تم تشغيل:

```bash
npx tsc --noEmit --pretty false
```

النتيجة داخل بيئة التنفيذ هنا: لم يتم تثبيت `node_modules`، لذلك ظهرت أخطاء من نوع `Cannot find module 'react'`, `Cannot find module 'next/server'`, `Cannot find module 'zustand'` وغيرها. بعد تجاهل أخطاء الحزم غير المثبتة، لم يظهر خطأ syntax مباشر في الملفات المعدلة لأن TypeScript وصل لمرحلة قراءة TSX. لتأكيد نهائي على جهازك شغّل:

```bash
npm install
npx prisma generate
npx prisma db push
npx tsc --noEmit
npm run dev
```

---

## Unified Diff كامل لكل التعديلات

```diff
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/prisma/schema.prisma /mnt/data/work/TeacherPro-main/prisma/schema.prisma
--- /mnt/data/original/TeacherPro-main/prisma/schema.prisma	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/prisma/schema.prisma	2026-05-28 14:06:00.812979220 +0000
@@ -113,6 +113,8 @@
   opportunitiesPenalty String
   dismissalGrade     Int?
   active             Boolean @default(true)
+  scheduledActivateAt   DateTime?
+  scheduledDeactivateAt DateTime?
   attendanceClosed   Boolean @default(false)
   attendance         String  @default("[]")
   groupId            String?
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/app/api/backup/route.ts /mnt/data/work/TeacherPro-main/src/app/api/backup/route.ts
--- /mnt/data/original/TeacherPro-main/src/app/api/backup/route.ts	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/app/api/backup/route.ts	2026-05-28 14:06:00.814387804 +0000
@@ -37,6 +37,7 @@
         name: true,
         role: true,
         roleId: true,
+        passwordHash: true,
         permissions: true,
         active: true,
         createdAt: true,
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/app/api/exams/route.ts /mnt/data/work/TeacherPro-main/src/app/api/exams/route.ts
--- /mnt/data/original/TeacherPro-main/src/app/api/exams/route.ts	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/app/api/exams/route.ts	2026-05-28 14:06:00.813668036 +0000
@@ -50,6 +50,8 @@
         opportunitiesPenalty: String(body.opportunitiesPenalty ?? 1),
         dismissalGrade: body.dismissalGrade === null || body.dismissalGrade === undefined ? null : Number(body.dismissalGrade),
         active: body.active ?? true,
+        scheduledActivateAt: body.scheduledActivateAt ? new Date(String(body.scheduledActivateAt)) : null,
+        scheduledDeactivateAt: body.scheduledDeactivateAt ? new Date(String(body.scheduledDeactivateAt)) : null,
         attendanceClosed: body.attendanceClosed ?? false,
         attendance: JSON.stringify(body.attendance || []),
       },
@@ -76,7 +78,9 @@
     if (data.passMark !== undefined) data.passMark = Number(data.passMark);
     if (data.discountMark !== undefined) data.discountMark = Number(data.discountMark);
     if (data.opportunitiesPenalty !== undefined) data.opportunitiesPenalty = String(data.opportunitiesPenalty);
-    if (data.dismissalGrade !== undefined) data.dismissalGrade = data.dismissalGrade === null ? null : Number(data.dismissalGrade);
+    if (data.dismissalGrade !== undefined) data.dismissalGrade = data.dismissalGrade === null || data.dismissalGrade === "" ? null : Number(data.dismissalGrade);
+    if (data.scheduledActivateAt !== undefined) data.scheduledActivateAt = data.scheduledActivateAt ? new Date(String(data.scheduledActivateAt)) : null;
+    if (data.scheduledDeactivateAt !== undefined) data.scheduledDeactivateAt = data.scheduledDeactivateAt ? new Date(String(data.scheduledDeactivateAt)) : null;
     if (data.attendance !== undefined) data.attendance = JSON.stringify(data.attendance || []);
     const exam = await db.exam.update({ where: { id }, data });
     return NextResponse.json({ exam });
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/app/api/users/route.ts /mnt/data/work/TeacherPro-main/src/app/api/users/route.ts
--- /mnt/data/original/TeacherPro-main/src/app/api/users/route.ts	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/app/api/users/route.ts	2026-05-28 14:06:00.815036620 +0000
@@ -28,6 +28,7 @@
         name: true,
         role: true,
         roleId: true,
+        passwordHash: true,
         permissions: true,
         active: true,
         createdAt: true,
@@ -36,7 +37,12 @@
         logs: true,
       },
     });
-    return NextResponse.json({ users });
+    return NextResponse.json({
+      users: users.map(({ passwordHash, ...user }) => ({
+        ...user,
+        password: passwordHash || undefined,
+      })),
+    });
   } catch (error) {
     return routeErrorResponse(error, 'تعذر تحميل المستخدمين حالياً.');
   }
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/components/teacher-pro/accounting.tsx /mnt/data/work/TeacherPro-main/src/components/teacher-pro/accounting.tsx
--- /mnt/data/original/TeacherPro-main/src/components/teacher-pro/accounting.tsx	1970-01-01 00:00:00.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/components/teacher-pro/accounting.tsx	2026-05-28 14:03:23.836827159 +0000
@@ -0,0 +1,195 @@
+"use client";
+
+import React, { useMemo, useState } from "react";
+import { useTeacherStore, type Student } from "@/lib/teacher-store";
+import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
+import { Button } from "@/components/ui/button";
+import { Input } from "@/components/ui/input";
+import { Badge } from "@/components/ui/badge";
+import { Label } from "@/components/ui/label";
+import {
+  Select,
+  SelectContent,
+  SelectItem,
+  SelectTrigger,
+  SelectValue,
+} from "@/components/ui/select";
+import {
+  Dialog,
+  DialogContent,
+  DialogFooter,
+  DialogHeader,
+  DialogTitle,
+} from "@/components/ui/dialog";
+import { toast } from "sonner";
+import { toLatinDigits } from "@/lib/format";
+import { searchAny } from "@/lib/validation";
+
+function money(value: number) {
+  return new Intl.NumberFormat("en-US").format(value || 0);
+}
+
+function amountValue(value: string): number {
+  return Number(toLatinDigits(value).replace(/\D/g, "")) || 0;
+}
+
+export function AccountingView() {
+  const { students, courses, updateStudent, courseName } = useTeacherStore();
+  const [search, setSearch] = useState("");
+  const [filterCourseId, setFilterCourseId] = useState("");
+  const [filterPayment, setFilterPayment] = useState("");
+  const [paymentDialog, setPaymentDialog] = useState<{ open: boolean; student: Student | null; amount: string; note: string; date: string }>({
+    open: false,
+    student: null,
+    amount: "",
+    note: "دفعة قسط",
+    date: new Date().toISOString().slice(0, 10),
+  });
+
+  const privateStudents = useMemo(() => students.filter((student) => student.courseType === "خاصة"), [students]);
+
+  const filtered = useMemo(() => {
+    return privateStudents.filter((student) => {
+      const remaining = Math.max((student.totalAmount || 0) - (student.paidAmount || 0), 0);
+      if (search && !searchAny(search, [student.name, student.code, student.telegram, student.phone, student.parentPhone, student.receiptNo])) return false;
+      if (filterCourseId && student.courseId !== filterCourseId) return false;
+      if (filterPayment === "paid" && remaining > 0) return false;
+      if (filterPayment === "remaining" && remaining === 0) return false;
+      if (filterPayment === "overdue" && remaining === 0) return false;
+      return true;
+    });
+  }, [privateStudents, search, filterCourseId, filterPayment]);
+
+  const totals = useMemo(() => {
+    return filtered.reduce(
+      (acc, student) => {
+        acc.total += student.totalAmount || 0;
+        acc.paid += student.paidAmount || 0;
+        acc.remaining += Math.max((student.totalAmount || 0) - (student.paidAmount || 0), 0);
+        return acc;
+      },
+      { total: 0, paid: 0, remaining: 0 },
+    );
+  }, [filtered]);
+
+  const exportCSV = () => {
+    const headers = ["الكود", "الطالب", "الدورة", "الوصل", "الكلي", "المدفوع", "المتبقي", "الهاتف", "ولي الأمر", "الأقساط"];
+    const rows = filtered.map((student) => [
+      student.code,
+      student.name,
+      courseName(student.courseId),
+      student.receiptNo || "",
+      String(student.totalAmount || 0),
+      String(student.paidAmount || 0),
+      String(Math.max((student.totalAmount || 0) - (student.paidAmount || 0), 0)),
+      student.phone,
+      student.parentPhone,
+      (student.installments || []).map((payment) => `${payment.date}: ${payment.amount} - ${payment.note}`).join(" | "),
+    ]);
+    const csv = "\ufeff" + [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
+    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
+    const url = URL.createObjectURL(blob);
+    const a = document.createElement("a");
+    a.href = url;
+    a.download = `accounting-${new Date().toISOString().slice(0, 10)}.csv`;
+    a.click();
+    URL.revokeObjectURL(url);
+    toast.success("تم تصدير جدول الأقساط");
+  };
+
+  const openPaymentDialog = (student: Student) => {
+    setPaymentDialog({ open: true, student, amount: "", note: "دفعة قسط", date: new Date().toISOString().slice(0, 10) });
+  };
+
+  const savePayment = () => {
+    if (!paymentDialog.student) return;
+    const amount = amountValue(paymentDialog.amount);
+    if (amount <= 0) return toast.error("اكتب مبلغ الدفعة");
+    const student = paymentDialog.student;
+    const nextInstallments = [...(student.installments || []), { date: paymentDialog.date, amount, note: paymentDialog.note.trim() || "دفعة قسط" }];
+    const nextPaid = nextInstallments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
+    const result = updateStudent(student.id, { installments: nextInstallments, paidAmount: nextPaid });
+    if (!result.ok) {
+      toast.error(result.message);
+      return;
+    }
+    setPaymentDialog({ open: false, student: null, amount: "", note: "دفعة قسط", date: new Date().toISOString().slice(0, 10) });
+    toast.success("تم تسجيل دفعة القسط");
+  };
+
+  return (
+    <div className="space-y-4">
+      <div className="grid gap-3 md:grid-cols-3">
+        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">إجمالي المطلوب</p><p className="text-2xl font-black">{money(totals.total)} د.ع</p></CardContent></Card>
+        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">إجمالي المدفوع</p><p className="text-2xl font-black text-emerald-600">{money(totals.paid)} د.ع</p></CardContent></Card>
+        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">إجمالي المتبقي</p><p className="text-2xl font-black text-rose-600">{money(totals.remaining)} د.ع</p></CardContent></Card>
+      </div>
+
+      <Card>
+        <CardHeader><CardTitle>الأقساط والمحاسبة للدورات الخاصة</CardTitle></CardHeader>
+        <CardContent>
+          <div className="grid gap-3 md:grid-cols-4">
+            <div className="space-y-1">
+              <Label className="text-xs">بحث</Label>
+              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم / كود / وصل / هاتف" />
+            </div>
+            <div className="space-y-1">
+              <Label className="text-xs">الدورة</Label>
+              <Select value={filterCourseId || "all"} onValueChange={(value) => setFilterCourseId(value === "all" ? "" : value)}>
+                <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
+                <SelectContent><SelectItem value="all">الكل</SelectItem>{courses.filter((course) => course.type === "خاصة").map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}</SelectContent>
+              </Select>
+            </div>
+            <div className="space-y-1">
+              <Label className="text-xs">حالة الدفع</Label>
+              <Select value={filterPayment || "all"} onValueChange={(value) => setFilterPayment(value === "all" ? "" : value)}>
+                <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
+                <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="paid">مسدد</SelectItem><SelectItem value="remaining">عليه متبقي</SelectItem><SelectItem value="overdue">متابعة محاسبة</SelectItem></SelectContent>
+              </Select>
+            </div>
+            <div className="space-y-1"><span className="text-xs font-medium">تصدير</span><Button variant="outline" className="h-10 w-full" onClick={exportCSV}>تصدير CSV</Button></div>
+          </div>
+        </CardContent>
+      </Card>
+
+      <div className="overflow-hidden rounded-2xl border bg-card">
+        <div className="grid grid-cols-[1.2fr_1fr_120px_120px_120px_120px] gap-2 border-b bg-muted/60 p-3 text-xs font-bold text-muted-foreground">
+          <span>الطالب</span><span>الدورة / الوصل</span><span>الكلي</span><span>المدفوع</span><span>المتبقي</span><span>إجراء</span>
+        </div>
+        {filtered.length === 0 ? (
+          <p className="empty-state m-4">لا توجد نتائج مطابقة.</p>
+        ) : filtered.map((student) => {
+          const remaining = Math.max((student.totalAmount || 0) - (student.paidAmount || 0), 0);
+          return (
+            <div key={student.id} className="grid grid-cols-1 gap-3 border-b p-3 text-sm md:grid-cols-[1.2fr_1fr_120px_120px_120px_120px] md:items-center">
+              <div><p className="font-bold">{student.name}</p><p className="text-xs text-muted-foreground">{student.code} - {student.phone}</p></div>
+              <div><p>{courseName(student.courseId)}</p><p className="text-xs text-muted-foreground">وصل: {student.receiptNo || "-"}</p></div>
+              <span>{money(student.totalAmount)} د.ع</span>
+              <span className="text-emerald-600">{money(student.paidAmount)} د.ع</span>
+              <span className={remaining > 0 ? "font-bold text-rose-600" : "text-emerald-600"}>{money(remaining)} د.ع</span>
+              <Button size="sm" onClick={() => openPaymentDialog(student)}>إضافة دفعة</Button>
+              {student.installments?.length > 0 && (
+                <div className="rounded-xl bg-muted/50 p-2 text-xs md:col-span-6">
+                  <span className="font-bold">سجل الأقساط: </span>
+                  {student.installments.map((payment, index) => <Badge key={`${payment.date}-${index}`} variant="outline" className="mx-1">{payment.date} - {money(payment.amount)} - {payment.note}</Badge>)}
+                </div>
+              )}
+            </div>
+          );
+        })}
+      </div>
+
+      <Dialog open={paymentDialog.open} onOpenChange={(open) => setPaymentDialog((prev) => ({ ...prev, open }))}>
+        <DialogContent dir="rtl">
+          <DialogHeader><DialogTitle>إضافة دفعة قسط - {paymentDialog.student?.name}</DialogTitle></DialogHeader>
+          <div className="grid gap-3 sm:grid-cols-2">
+            <div className="space-y-1"><Label>تاريخ الدفعة</Label><Input type="date" value={paymentDialog.date} onChange={(e) => setPaymentDialog((prev) => ({ ...prev, date: e.target.value }))} /></div>
+            <div className="space-y-1"><Label>المبلغ</Label><Input value={paymentDialog.amount} onChange={(e) => setPaymentDialog((prev) => ({ ...prev, amount: toLatinDigits(e.target.value) }))} placeholder="مثال: 25000" /></div>
+            <div className="space-y-1 sm:col-span-2"><Label>ملاحظة</Label><Input value={paymentDialog.note} onChange={(e) => setPaymentDialog((prev) => ({ ...prev, note: e.target.value }))} /></div>
+          </div>
+          <DialogFooter><Button variant="ghost" onClick={() => setPaymentDialog((prev) => ({ ...prev, open: false }))}>إلغاء</Button><Button onClick={savePayment}>حفظ الدفعة</Button></DialogFooter>
+        </DialogContent>
+      </Dialog>
+    </div>
+  );
+}
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/components/teacher-pro/exam-new.tsx /mnt/data/work/TeacherPro-main/src/components/teacher-pro/exam-new.tsx
--- /mnt/data/original/TeacherPro-main/src/components/teacher-pro/exam-new.tsx	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/components/teacher-pro/exam-new.tsx	2026-05-28 14:01:15.416352239 +0000
@@ -15,22 +15,115 @@
   SelectValue,
 } from "@/components/ui/select";
 import { Checkbox } from "@/components/ui/checkbox";
+import {
+  Dialog,
+  DialogContent,
+  DialogFooter,
+  DialogHeader,
+  DialogTitle,
+} from "@/components/ui/dialog";
 import { toast } from "sonner";
 import { toLatinDigits } from "@/lib/format";
 import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
 import { useActionLock } from "@/hooks/use-action-lock";
+import { getExamStatus, hasActiveChapterLink, splitSelection } from "@/lib/exam-utils";
 
-function splitSelection(value: string): string[] {
-  return value
-    .split(",")
-    .map((v) => v.trim())
-    .filter(Boolean);
+type ExamStatusMode = "نشط" | "تفعيل مجدول" | "تعطيل مجدول" | "معطل";
+
+type ExamFormState = {
+  name: string;
+  type: "يومي" | "تراكمي" | "فاينل";
+  courseIds: string[];
+  mainSites: string[];
+  groupIds: string[];
+  date: string;
+  fullMark: number;
+  passMark: number;
+  discountMark: number;
+  opportunitiesPenaltyNum: number;
+  dismissalGrade: string;
+  statusMode: ExamStatusMode;
+  scheduledActivateAt: string;
+  scheduledDeactivateAt: string;
+};
+
+function todayISO() {
+  return new Date().toISOString().slice(0, 10);
+}
+
+function emptyForm(): ExamFormState {
+  return {
+    name: "",
+    type: "يومي",
+    courseIds: [],
+    mainSites: [],
+    groupIds: [],
+    date: todayISO(),
+    fullMark: 100,
+    passMark: 60,
+    discountMark: 45,
+    opportunitiesPenaltyNum: 1,
+    dismissalGrade: "",
+    statusMode: "نشط",
+    scheduledActivateAt: "",
+    scheduledDeactivateAt: "",
+  };
+}
+
+function formFromExam(exam: Exam): ExamFormState {
+  return {
+    name: exam.name,
+    type: exam.type,
+    courseIds: [...exam.courseIds],
+    mainSites: splitSelection(exam.mainSite),
+    groupIds: splitSelection(exam.groupId),
+    date: exam.date,
+    fullMark: exam.fullMark,
+    passMark: exam.passMark,
+    discountMark: exam.discountMark,
+    opportunitiesPenaltyNum: typeof exam.opportunitiesPenalty === "number" ? exam.opportunitiesPenalty : 1,
+    dismissalGrade: exam.dismissalGrade !== null ? String(exam.dismissalGrade) : "",
+    statusMode: getExamStatus(exam),
+    scheduledActivateAt: exam.scheduledActivateAt || "",
+    scheduledDeactivateAt: exam.scheduledDeactivateAt || "",
+  };
 }
 
 function toggleSelection(values: string[], value: string): string[] {
-  return values.includes(value)
-    ? values.filter((v) => v !== value)
-    : [...values, value];
+  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
+}
+
+function applyStatus(form: ExamFormState) {
+  if (form.statusMode === "نشط") {
+    return { active: true, scheduledActivateAt: "", scheduledDeactivateAt: "" };
+  }
+  if (form.statusMode === "معطل") {
+    return { active: false, scheduledActivateAt: "", scheduledDeactivateAt: "" };
+  }
+  if (form.statusMode === "تفعيل مجدول") {
+    return { active: false, scheduledActivateAt: form.scheduledActivateAt || form.date, scheduledDeactivateAt: "" };
+  }
+  return { active: true, scheduledActivateAt: "", scheduledDeactivateAt: form.scheduledDeactivateAt || form.date };
+}
+
+function buildExamPayload(form: ExamFormState): Omit<Exam, "id"> {
+  const isCumulativeOrFinal = form.type === "تراكمي" || form.type === "فاينل";
+  return {
+    name: form.name.trim(),
+    type: form.type,
+    courseIds: form.courseIds,
+    mainSite: form.mainSites.join(","),
+    groupId: form.groupIds.join(","),
+    date: form.date,
+    fullMark: form.fullMark,
+    passMark: form.passMark,
+    discountMark: form.discountMark,
+    opportunitiesPenalty: isCumulativeOrFinal ? "فصل مؤقت" : form.opportunitiesPenaltyNum,
+    dismissalGrade: isCumulativeOrFinal && form.dismissalGrade ? Number(form.dismissalGrade) : null,
+    ...applyStatus(form),
+    attendanceClosed: false,
+    attendance: [],
+  };
 }
 
 export function ExamNewView() {
@@ -40,7 +133,9 @@
     sites,
     exams,
     students,
+    courseChapters,
     addExam,
+    updateExam,
     toggleExam,
     toggleAttendance,
     closeAttendance,
@@ -48,572 +143,278 @@
     groupName,
   } = useTeacherStore();
 
-  const [form, setForm] = useState({
-    name: "",
-    type: "يومي" as "يومي" | "تراكمي" | "فاينل",
-    courseIds: [] as string[],
-    mainSites: [] as string[],
-    groupIds: [] as string[],
-    date: new Date().toISOString().slice(0, 10),
-    fullMark: 100,
-    passMark: 60,
-    discountMark: 45,
-    opportunitiesPenaltyNum: 1,
-    dismissalGrade: "",
-  });
-
+  const [form, setForm] = useState<ExamFormState>(() => emptyForm());
+  const [editDialog, setEditDialog] = useState<{ open: boolean; id: string; form: ExamFormState }>({ open: false, id: "", form: emptyForm() });
+  const [selectedExamId, setSelectedExamId] = useState("");
+  const selectedExam = exams.find((e) => e.id === selectedExamId);
   const { locked: isAddingExam, runLocked: runAddExamLocked } = useActionLock();
 
-  const isCumulativeOrFinal = form.type === "تراكمي" || form.type === "فاينل";
+  const activeCourses = useMemo(() => courses.filter((course) => course.active), [courses]);
 
-  const availableGroups = useMemo(
-    () => groups.filter((g) => form.courseIds.includes(g.courseId) && g.active),
-    [groups, form.courseIds],
-  );
-
-  const availableMainSites = useMemo(() => {
+  const availableGroupsFor = (state: ExamFormState) => groups.filter((g) => state.courseIds.includes(g.courseId) && g.active);
+  const availableMainSitesFor = (state: ExamFormState) => {
     const courseSites = sites
-      .filter(
-        (s) =>
-          s.active &&
-          (form.courseIds.length === 0 || form.courseIds.includes(s.courseId)),
-      )
+      .filter((s) => s.active && (state.courseIds.length === 0 || state.courseIds.includes(s.courseId)))
       .map((s) => s.main);
     return [...new Set([...MAIN_SITE_OPTIONS, ...courseSites])];
-  }, [form.courseIds, sites]);
+  };
+
+  const availableGroups = useMemo(() => availableGroupsFor(form), [groups, form.courseIds]);
+  const availableMainSites = useMemo(() => availableMainSitesFor(form), [sites, form.courseIds]);
 
   useEffect(() => {
     setForm((prev) => ({
       ...prev,
-      groupIds: prev.groupIds.filter((id) =>
-        availableGroups.some((g) => g.id === id),
-      ),
-      mainSites: prev.mainSites.filter((site) =>
-        availableMainSites.includes(site),
-      ),
+      groupIds: prev.groupIds.filter((id) => availableGroups.some((g) => g.id === id)),
+      mainSites: prev.mainSites.filter((site) => availableMainSites.includes(site)),
     }));
   }, [availableGroups, availableMainSites]);
 
-  const [selectedExamId, setSelectedExamId] = useState("");
-  const selectedExam = exams.find((e) => e.id === selectedExamId);
-
-  const allCoursesSelected =
-    courses.length > 0 && form.courseIds.length === courses.length;
-  const allMainSitesSelected =
-    availableMainSites.length > 0 &&
-    form.mainSites.length === availableMainSites.length;
-  const allGroupsSelected =
-    availableGroups.length > 0 &&
-    form.groupIds.length === availableGroups.length;
-
-  const handleSubmit = runAddExamLocked(
-    async (e: React.FormEvent<HTMLFormElement>) => {
-      e.preventDefault();
-      if (!form.name.trim()) {
-        toast.error("يرجى إدخال اسم الامتحان");
-        return;
-      }
-      if (form.courseIds.length === 0) {
-        toast.error("يرجى اختيار دورة واحدة على الأقل");
-        return;
-      }
-      if (form.mainSites.length === 0) {
-        toast.error("يرجى اختيار منطقة واحدة على الأقل أو اختيار الكل");
-        return;
-      }
-      if (availableGroups.length > 0 && form.groupIds.length === 0) {
-        toast.error("يرجى اختيار مجموعة إلكترونية واحدة على الأقل أو اختيار الكل");
-        return;
-      }
-
-      const examData: Omit<Exam, "id"> = {
-        name: form.name.trim(),
-        type: form.type,
-        courseIds: form.courseIds,
-        mainSite: form.mainSites.join(","),
-        groupId: form.groupIds.join(","),
-        date: form.date,
-        fullMark: form.fullMark,
-        passMark: form.passMark,
-        discountMark: form.discountMark,
-        opportunitiesPenalty: isCumulativeOrFinal
-          ? "فصل مؤقت"
-          : form.opportunitiesPenaltyNum,
-        dismissalGrade:
-          isCumulativeOrFinal && form.dismissalGrade
-            ? Number(form.dismissalGrade)
-            : null,
-        active: true,
-        attendanceClosed: false,
-        attendance: [],
-      };
-
-      addExam(examData);
-      setForm({
-        name: "",
-        type: "يومي",
-        courseIds: [],
-        mainSites: [],
-        groupIds: [],
-        date: new Date().toISOString().slice(0, 10),
-        fullMark: 100,
-        passMark: 60,
-        discountMark: 45,
-        opportunitiesPenaltyNum: 1,
-        dismissalGrade: "",
-      });
-      toast.success("تمت إضافة الامتحان");
-    },
-  );
-
-  const toggleCourseSelection = (courseId: string) => {
-    setForm((prev) => ({
-      ...prev,
-      courseIds: toggleSelection(prev.courseIds, courseId),
-      groupIds: [],
-    }));
-  };
-
-  const toggleAllCourses = () => {
-    setForm((prev) => ({
-      ...prev,
-      courseIds: allCoursesSelected ? [] : courses.map((c) => c.id),
-      groupIds: [],
-    }));
+  const validateForm = (state: ExamFormState) => {
+    if (!state.name.trim()) return "يرجى إدخال اسم الامتحان";
+    if (state.courseIds.length === 0) return "يرجى اختيار دورة واحدة على الأقل";
+    const invalidCourses = state.courseIds.filter((courseId) => !hasActiveChapterLink(courseChapters, courseId));
+    if (invalidCourses.length > 0) return `لا يمكن ربط الامتحان بدورات بدون فصل نشط: ${invalidCourses.map(courseName).join("، ")}`;
+    if (state.mainSites.length === 0) return "يرجى اختيار منطقة واحدة على الأقل أو اختيار الكل";
+    if (availableGroupsFor(state).length > 0 && state.groupIds.length === 0) return "يرجى اختيار مجموعة إلكترونية واحدة على الأقل أو اختيار الكل";
+    if (state.statusMode === "تفعيل مجدول" && !state.scheduledActivateAt) return "حدد تاريخ التفعيل المجدول";
+    if (state.statusMode === "تعطيل مجدول" && !state.scheduledDeactivateAt) return "حدد تاريخ التعطيل المجدول";
+    return null;
   };
 
-  const toggleMainSiteSelection = (mainSite: string) => {
-    setForm((prev) => ({
-      ...prev,
-      mainSites: toggleSelection(prev.mainSites, mainSite),
-    }));
-  };
-
-  const toggleAllMainSites = () => {
-    setForm((prev) => ({
-      ...prev,
-      mainSites: allMainSitesSelected ? [] : [...availableMainSites],
-    }));
-  };
+  const handleSubmit = runAddExamLocked(async (e: React.FormEvent<HTMLFormElement>) => {
+    e.preventDefault();
+    const error = validateForm(form);
+    if (error) {
+      toast.error(error);
+      return;
+    }
+    addExam(buildExamPayload(form));
+    setForm(emptyForm());
+    toast.success("تمت إضافة الامتحان");
+  });
 
-  const toggleGroupSelection = (groupId: string) => {
-    setForm((prev) => ({
-      ...prev,
-      groupIds: toggleSelection(prev.groupIds, groupId),
-    }));
-  };
+  const toggleCourseSelection = (state: ExamFormState, courseId: string): ExamFormState => ({
+    ...state,
+    courseIds: toggleSelection(state.courseIds, courseId),
+    groupIds: [],
+  });
 
-  const toggleAllGroups = () => {
-    setForm((prev) => ({
-      ...prev,
-      groupIds: allGroupsSelected ? [] : availableGroups.map((g) => g.id),
-    }));
+  const renderCourseSelector = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, allId: string) => {
+    const eligibleCourses = activeCourses.filter((course) => hasActiveChapterLink(courseChapters, course.id));
+    const allSelected = eligibleCourses.length > 0 && eligibleCourses.every((course) => state.courseIds.includes(course.id));
+    return (
+      <div className="space-y-2 border rounded-lg p-3 max-h-48 overflow-y-auto">
+        <div className="flex items-center gap-2 border-b pb-2">
+          <Checkbox
+            id={allId}
+            checked={allSelected}
+            onCheckedChange={() => setState((prev) => ({ ...prev, courseIds: allSelected ? [] : eligibleCourses.map((course) => course.id), groupIds: [] }))}
+          />
+          <Label htmlFor={allId} className="text-sm font-bold">الكل للدورات المربوطة بفصل</Label>
+        </div>
+        {activeCourses.map((course) => {
+          const eligible = hasActiveChapterLink(courseChapters, course.id);
+          return (
+            <div key={course.id} className="flex items-center gap-2">
+              <Checkbox
+                id={`${allId}-${course.id}`}
+                checked={state.courseIds.includes(course.id)}
+                disabled={!eligible}
+                onCheckedChange={() => setState((prev) => toggleCourseSelection(prev, course.id))}
+              />
+              <Label htmlFor={`${allId}-${course.id}`} className="text-sm">
+                {course.name}
+              </Label>
+              <Badge variant={eligible ? "outline" : "destructive"} className="text-[10px]">
+                {eligible ? course.type : "لم يتم اختيار فصل"}
+              </Badge>
+            </div>
+          );
+        })}
+      </div>
+    );
   };
 
-  const handleToggleAttendance = (examId: string, studentId: string) => {
-    toggleAttendance(examId, studentId);
-  };
+  const renderStatusControls = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, prefix: string) => (
+    <>
+      <div className="space-y-2">
+        <Label htmlFor={`${prefix}-status`}>حالة الامتحان</Label>
+        <Select value={state.statusMode} onValueChange={(value) => setState((p) => ({ ...p, statusMode: value as ExamStatusMode }))}>
+          <SelectTrigger id={`${prefix}-status`}><SelectValue /></SelectTrigger>
+          <SelectContent>
+            <SelectItem value="نشط">نشط</SelectItem>
+            <SelectItem value="تفعيل مجدول">تفعيل مجدول</SelectItem>
+            <SelectItem value="تعطيل مجدول">تعطيل مجدول</SelectItem>
+            <SelectItem value="معطل">معطل</SelectItem>
+          </SelectContent>
+        </Select>
+      </div>
+      {state.statusMode === "تفعيل مجدول" && (
+        <div className="space-y-2">
+          <Label htmlFor={`${prefix}-activate`}>تاريخ التفعيل</Label>
+          <Input id={`${prefix}-activate`} type="date" value={state.scheduledActivateAt} onChange={(e) => setState((p) => ({ ...p, scheduledActivateAt: e.target.value }))} />
+        </div>
+      )}
+      {state.statusMode === "تعطيل مجدول" && (
+        <div className="space-y-2">
+          <Label htmlFor={`${prefix}-deactivate`}>تاريخ التعطيل</Label>
+          <Input id={`${prefix}-deactivate`} type="date" value={state.scheduledDeactivateAt} onChange={(e) => setState((p) => ({ ...p, scheduledDeactivateAt: e.target.value }))} />
+        </div>
+      )}
+    </>
+  );
 
   const selectedExamStudents = useMemo(() => {
     if (!selectedExam) return [];
     const selectedMainSites = splitSelection(selectedExam.mainSite);
     const selectedGroupIds = splitSelection(selectedExam.groupId);
     return students.filter((s) => {
-      if (!selectedExam.courseIds.includes(s.courseId) || s.status !== "نشط")
-        return false;
-      if (
-        selectedMainSites.length > 0 &&
-        !selectedMainSites.includes(s.mainSite)
-      )
-        return false;
-      if (selectedGroupIds.length > 0 && !selectedGroupIds.includes(s.groupId))
-        return false;
+      if (!selectedExam.courseIds.includes(s.courseId) || s.status !== "نشط") return false;
+      if (!hasActiveChapterLink(courseChapters, s.courseId)) return false;
+      if (selectedMainSites.length > 0 && !selectedMainSites.includes(s.mainSite)) return false;
+      if (selectedGroupIds.length > 0 && !selectedGroupIds.includes(s.groupId)) return false;
       return true;
     });
-  }, [selectedExam, students]);
+  }, [selectedExam, students, courseChapters]);
 
-  return (
-    <div className="space-y-6">
-      <Card>
-        <CardHeader>
-          <CardTitle>إضافة امتحان جديد</CardTitle>
-        </CardHeader>
-        <CardContent>
-          <form
-            onSubmit={handleSubmit}
-            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
-          >
-            <div className="space-y-2">
-              <Label htmlFor="exam-name">اسم الامتحان</Label>
-              <Input
-                id="exam-name"
-                name="name"
-                autoComplete="off"
-                value={form.name}
-                onChange={(e) =>
-                  setForm((p) => ({ ...p, name: e.target.value }))
-                }
-                required
-                placeholder="اختبار يومي - الخلية"
-              />
-            </div>
-
-            <div className="space-y-2">
-              <Label htmlFor="exam-type">نوع الامتحان</Label>
-              <Select
-                name="type"
-                value={form.type}
-                onValueChange={(v) =>
-                  setForm((p) => ({
-                    ...p,
-                    type: v as "يومي" | "تراكمي" | "فاينل",
-                  }))
-                }
-              >
-                <SelectTrigger id="exam-type">
-                  <SelectValue />
-                </SelectTrigger>
-                <SelectContent>
-                  <SelectItem value="يومي">يومي</SelectItem>
-                  <SelectItem value="تراكمي">تراكمي</SelectItem>
-                  <SelectItem value="فاينل">فاينل</SelectItem>
-                </SelectContent>
-              </Select>
-            </div>
-
-            <div className="space-y-2">
-              <Label htmlFor="exam-all-courses">الدورات</Label>
-              <div className="space-y-2 border rounded-lg p-3 max-h-44 overflow-y-auto">
-                <div className="flex items-center gap-2 border-b pb-2">
-                  <Checkbox
-                    id="exam-all-courses"
-                    name="allCourses"
-                    checked={allCoursesSelected}
-                    onCheckedChange={toggleAllCourses}
-                  />
-                  <Label
-                    htmlFor="exam-all-courses"
-                    className="text-sm font-bold"
-                  >
-                    الكل
-                  </Label>
-                </div>
-                {courses.length === 0 ? (
-                  <p className="text-sm text-muted-foreground">
-                    لا توجد دورات مسجلة
-                  </p>
-                ) : (
-                  courses.map((c) => (
-                    <div key={c.id} className="flex items-center gap-2">
-                      <Checkbox
-                        id={`exam-course-${c.id}`}
-                        name={`course-${c.id}`}
-                        checked={form.courseIds.includes(c.id)}
-                        onCheckedChange={() => toggleCourseSelection(c.id)}
-                      />
-                      <Label
-                        htmlFor={`exam-course-${c.id}`}
-                        className="text-sm"
-                      >
-                        {c.name}
-                      </Label>
-                      <Badge
-                        variant={c.type === "خاصة" ? "default" : "secondary"}
-                        className="text-[10px]"
-                      >
-                        {c.type}
-                      </Badge>
-                    </div>
-                  ))
-                )}
-              </div>
-            </div>
-
-            <div className="space-y-2">
-              <Label htmlFor="exam-all-sites">المناطق الرئيسية</Label>
-              <div className="space-y-2 border rounded-lg p-3 max-h-44 overflow-y-auto">
-                <div className="flex items-center gap-2 border-b pb-2">
-                  <Checkbox
-                    id="exam-all-sites"
-                    name="allSites"
-                    checked={allMainSitesSelected}
-                    onCheckedChange={toggleAllMainSites}
-                  />
-                  <Label htmlFor="exam-all-sites" className="text-sm font-bold">
-                    الكل
-                  </Label>
-                </div>
-                {availableMainSites.map((site) => (
-                  <div key={site} className="flex items-center gap-2">
-                    <Checkbox
-                      id={`exam-site-${site}`}
-                      name={`site-${site}`}
-                      checked={form.mainSites.includes(site)}
-                      onCheckedChange={() => toggleMainSiteSelection(site)}
-                    />
-                    <Label htmlFor={`exam-site-${site}`} className="text-sm">
-                      {site}
-                    </Label>
-                  </div>
-                ))}
-              </div>
-            </div>
+  const saveExamEdit = () => {
+    const error = validateForm(editDialog.form);
+    if (error) {
+      toast.error(error);
+      return;
+    }
+    const payload = buildExamPayload(editDialog.form);
+    updateExam(editDialog.id, {
+      ...payload,
+      attendanceClosed: exams.find((exam) => exam.id === editDialog.id)?.attendanceClosed || false,
+      attendance: exams.find((exam) => exam.id === editDialog.id)?.attendance || [],
+    });
+    setEditDialog({ open: false, id: "", form: emptyForm() });
+    toast.success("تم تعديل الامتحان وإعادة احتساب تأثيراته على الطلاب");
+  };
 
-            <div className="space-y-2">
-              <Label htmlFor="exam-all-groups">المجموعات الإلكترونية</Label>
-              <div className="space-y-2 border rounded-lg p-3 max-h-44 overflow-y-auto">
-                <div className="flex items-center gap-2 border-b pb-2">
-                  <Checkbox
-                    id="exam-all-groups"
-                    name="allGroups"
-                    checked={allGroupsSelected}
-                    disabled={availableGroups.length === 0}
-                    onCheckedChange={toggleAllGroups}
-                  />
-                  <Label
-                    htmlFor="exam-all-groups"
-                    className="text-sm font-bold"
-                  >
-                    الكل
-                  </Label>
-                </div>
-                {form.courseIds.length === 0 ? (
-                  <p className="text-sm text-muted-foreground">
-                    اختر دورة أولاً لعرض المجموعات الإلكترونية
-                  </p>
-                ) : availableGroups.length === 0 ? (
-                  <p className="text-sm text-muted-foreground">
-                    لا توجد مجموعات إلكترونية مسجلة لهذه الدورات
-                  </p>
-                ) : (
-                  availableGroups.map((g) => (
-                    <div key={g.id} className="flex items-center gap-2">
-                      <Checkbox
-                        id={`exam-group-${g.id}`}
-                        name={`group-${g.id}`}
-                        checked={form.groupIds.includes(g.id)}
-                        onCheckedChange={() => toggleGroupSelection(g.id)}
-                      />
-                      <Label htmlFor={`exam-group-${g.id}`} className="text-sm">
-                        {g.name} - {courseName(g.courseId)}
-                      </Label>
-                    </div>
-                  ))
-                )}
+  const renderFormFields = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, prefix: string) => {
+    const isCumulativeOrFinal = state.type === "تراكمي" || state.type === "فاينل";
+    const groupsForState = availableGroupsFor(state);
+    const mainSitesForState = availableMainSitesFor(state);
+    const allMainSitesSelected = mainSitesForState.length > 0 && state.mainSites.length === mainSitesForState.length;
+    const allGroupsSelected = groupsForState.length > 0 && state.groupIds.length === groupsForState.length;
+
+    return (
+      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
+        <div className="space-y-2">
+          <Label htmlFor={`${prefix}-name`}>اسم الامتحان</Label>
+          <Input id={`${prefix}-name`} value={state.name} onChange={(e) => setState((p) => ({ ...p, name: e.target.value }))} required placeholder="الامتحان الأول - الفصل الأول" />
+        </div>
+        <div className="space-y-2">
+          <Label htmlFor={`${prefix}-type`}>نوع الامتحان</Label>
+          <Select value={state.type} onValueChange={(v) => setState((p) => ({ ...p, type: v as ExamFormState["type"] }))}>
+            <SelectTrigger id={`${prefix}-type`}><SelectValue /></SelectTrigger>
+            <SelectContent>
+              <SelectItem value="يومي">يومي</SelectItem>
+              <SelectItem value="تراكمي">تراكمي</SelectItem>
+              <SelectItem value="فاينل">فاينل</SelectItem>
+            </SelectContent>
+          </Select>
+        </div>
+        <div className="space-y-2">
+          <Label htmlFor={`${prefix}-date`}>تاريخ الامتحان</Label>
+          <Input id={`${prefix}-date`} type="date" value={state.date} onChange={(e) => setState((p) => ({ ...p, date: e.target.value }))} />
+        </div>
+        <div className="space-y-2 md:col-span-2 xl:col-span-1">
+          <Label>الدورات</Label>
+          {renderCourseSelector(state, setState, `${prefix}-all-courses`)}
+        </div>
+        <div className="space-y-2">
+          <Label>الموقع الرئيسي</Label>
+          <div className="space-y-2 border rounded-lg p-3 max-h-48 overflow-y-auto">
+            <div className="flex items-center gap-2 border-b pb-2">
+              <Checkbox checked={allMainSitesSelected} onCheckedChange={() => setState((p) => ({ ...p, mainSites: allMainSitesSelected ? [] : [...mainSitesForState] }))} />
+              <span className="text-sm font-bold">الكل</span>
+            </div>
+            {mainSitesForState.map((site) => (
+              <div key={site} className="flex items-center gap-2">
+                <Checkbox checked={state.mainSites.includes(site)} onCheckedChange={() => setState((p) => ({ ...p, mainSites: toggleSelection(p.mainSites, site) }))} />
+                <span className="text-sm">{site}</span>
               </div>
-            </div>
-
-            <div className="space-y-2">
-              <Label htmlFor="exam-date">تاريخ الامتحان</Label>
-              <Input
-                id="exam-date"
-                name="date"
-                type="date"
-                autoComplete="off"
-                value={form.date}
-                onChange={(e) =>
-                  setForm((p) => ({ ...p, date: e.target.value }))
-                }
-              />
-            </div>
-
-            <div className="space-y-2">
-              <Label htmlFor="exam-fullMark">الدرجة الكاملة</Label>
-              <Input
-                id="exam-fullMark"
-                name="fullMark"
-                type="number"
-                autoComplete="off"
-                value={form.fullMark}
-                onChange={(e) =>
-                  setForm((p) => ({
-                    ...p,
-                    fullMark: Number(toLatinDigits(e.target.value)) || 100,
-                  }))
-                }
-              />
-            </div>
-
-            <div className="space-y-2">
-              <Label htmlFor="exam-passMark">درجة النجاح</Label>
-              <Input
-                id="exam-passMark"
-                name="passMark"
-                type="number"
-                autoComplete="off"
-                value={form.passMark}
-                onChange={(e) =>
-                  setForm((p) => ({
-                    ...p,
-                    passMark: Number(toLatinDigits(e.target.value)) || 60,
-                  }))
-                }
-              />
-            </div>
-
-            <div className="space-y-2">
-              <Label htmlFor="exam-discountMark">درجة الخصم</Label>
-              <Input
-                id="exam-discountMark"
-                name="discountMark"
-                type="number"
-                autoComplete="off"
-                value={form.discountMark}
-                onChange={(e) =>
-                  setForm((p) => ({
-                    ...p,
-                    discountMark: Number(toLatinDigits(e.target.value)) || 45,
-                  }))
-                }
-              />
-            </div>
-
-            <div className="space-y-2">
-              <Label htmlFor="exam-penalty">خصم الفرص</Label>
-              {isCumulativeOrFinal ? (
-                <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/40 text-sm">
-                  فصل مؤقت تلقائياً عند الغياب
-                </div>
-              ) : (
-                <Input
-                  id="exam-penalty"
-                  name="opportunitiesPenaltyNum"
-                  type="number"
-                  min={0}
-                  autoComplete="off"
-                  value={form.opportunitiesPenaltyNum}
-                  onChange={(e) =>
-                    setForm((p) => ({
-                      ...p,
-                      opportunitiesPenaltyNum:
-                        Number(toLatinDigits(e.target.value)) || 1,
-                    }))
-                  }
-                />
-              )}
-            </div>
-
-            {isCumulativeOrFinal && (
-              <div className="space-y-2">
-                <Label htmlFor="exam-dismissalGrade">درجة الفصل</Label>
-                <Input
-                  id="exam-dismissalGrade"
-                  name="dismissalGrade"
-                  type="number"
-                  autoComplete="off"
-                  value={form.dismissalGrade}
-                  onChange={(e) =>
-                    setForm((p) => ({
-                      ...p,
-                      dismissalGrade: toLatinDigits(e.target.value),
-                    }))
-                  }
-                  placeholder="أدنى درجة للفصل"
-                />
+            ))}
+          </div>
+        </div>
+        <div className="space-y-2">
+          <Label>المجموعات الإلكترونية</Label>
+          <div className="space-y-2 border rounded-lg p-3 max-h-48 overflow-y-auto">
+            <div className="flex items-center gap-2 border-b pb-2">
+              <Checkbox checked={allGroupsSelected} disabled={groupsForState.length === 0} onCheckedChange={() => setState((p) => ({ ...p, groupIds: allGroupsSelected ? [] : groupsForState.map((group) => group.id) }))} />
+              <span className="text-sm font-bold">الكل</span>
+            </div>
+            {groupsForState.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد مجموعات لهذه الدورات</p> : groupsForState.map((group) => (
+              <div key={group.id} className="flex items-center gap-2">
+                <Checkbox checked={state.groupIds.includes(group.id)} onCheckedChange={() => setState((p) => ({ ...p, groupIds: toggleSelection(p.groupIds, group.id) }))} />
+                <span className="text-sm">{group.name} - {courseName(group.courseId)}</span>
               </div>
-            )}
+            ))}
+          </div>
+        </div>
+        <div className="space-y-2"><Label>الدرجة الكاملة</Label><Input type="number" value={state.fullMark} onChange={(e) => setState((p) => ({ ...p, fullMark: Number(toLatinDigits(e.target.value)) || 100 }))} /></div>
+        <div className="space-y-2"><Label>درجة النجاح</Label><Input type="number" value={state.passMark} onChange={(e) => setState((p) => ({ ...p, passMark: Number(toLatinDigits(e.target.value)) || 60 }))} /></div>
+        <div className="space-y-2"><Label>درجة الخصم</Label><Input type="number" value={state.discountMark} onChange={(e) => setState((p) => ({ ...p, discountMark: Number(toLatinDigits(e.target.value)) || 0 }))} /></div>
+        <div className="space-y-2">
+          <Label>خصم الفرص</Label>
+          {isCumulativeOrFinal ? <div className="rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950/40">فصل مؤقت تلقائياً عند الغياب</div> : <Input type="number" min={0} value={state.opportunitiesPenaltyNum} onChange={(e) => setState((p) => ({ ...p, opportunitiesPenaltyNum: Number(toLatinDigits(e.target.value)) || 1 }))} />}
+        </div>
+        {isCumulativeOrFinal && <div className="space-y-2"><Label>درجة الفصل</Label><Input type="number" value={state.dismissalGrade} onChange={(e) => setState((p) => ({ ...p, dismissalGrade: toLatinDigits(e.target.value) }))} /></div>}
+        {renderStatusControls(state, setState, prefix)}
+      </div>
+    );
+  };
 
-            <div className="md:col-span-2 lg:col-span-3 space-y-3">
-              <Button type="submit" disabled={isAddingExam} className="w-full">
-                {isAddingExam ? "جاري الإضافة..." : "إضافة الامتحان"}
-              </Button>
-            </div>
+  return (
+    <div className="space-y-6">
+      <Card>
+        <CardHeader><CardTitle>إضافة امتحان جديد</CardTitle></CardHeader>
+        <CardContent>
+          <form onSubmit={handleSubmit} className="space-y-4">
+            {renderFormFields(form, setForm, "exam")}
+            <Button type="submit" disabled={isAddingExam} className="w-full">{isAddingExam ? "جاري الإضافة..." : "إضافة الامتحان"}</Button>
           </form>
         </CardContent>
       </Card>
 
       <Card>
-        <CardHeader>
-          <CardTitle>قائمة الامتحانات</CardTitle>
-        </CardHeader>
+        <CardHeader><CardTitle>قائمة الامتحانات</CardTitle></CardHeader>
         <CardContent>
           <div className="space-y-3">
             {exams.map((exam) => {
+              const status = getExamStatus(exam);
               const examMainSites = splitSelection(exam.mainSite);
               const examGroupIds = splitSelection(exam.groupId);
               return (
-                <div
-                  key={exam.id}
-                  className="p-4 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
-                >
-                  <div className="flex items-start justify-between mb-2">
+                <div key={exam.id} className="rounded-2xl border bg-card/80 p-4 shadow-sm">
+                  <div className="mb-2 flex items-start justify-between gap-3">
                     <div>
                       <p className="font-bold">{exam.name}</p>
-                      <p className="text-xs text-muted-foreground">
-                        {exam.date} - {exam.type}
-                      </p>
+                      <p className="text-xs text-muted-foreground">{exam.date} - {exam.type}</p>
                     </div>
-                    <div className="flex items-center gap-2">
-                      <Badge
-                        variant={
-                          exam.type === "يومي"
-                            ? "secondary"
-                            : exam.type === "تراكمي"
-                              ? "default"
-                              : "destructive"
-                        }
-                      >
-                        {exam.type}
-                      </Badge>
-                      <Badge variant={exam.active ? "default" : "secondary"}>
-                        {exam.active ? "فعال" : "معطل"}
-                      </Badge>
+                    <div className="flex flex-wrap items-center gap-2">
+                      <Badge>{exam.type}</Badge>
+                      <Badge variant={status === "نشط" ? "default" : status === "معطل" ? "secondary" : "outline"}>{status}</Badge>
                     </div>
                   </div>
-                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-2">
-                    <div>
-                      <span className="text-muted-foreground text-xs">
-                        النجاح:
-                      </span>{" "}
-                      {exam.passMark}
-                    </div>
-                    <div>
-                      <span className="text-muted-foreground text-xs">
-                        الخصم:
-                      </span>{" "}
-                      {exam.discountMark}
-                    </div>
-                    <div>
-                      <span className="text-muted-foreground text-xs">
-                        الحضور:
-                      </span>{" "}
-                      {exam.attendance.length} طالب
-                    </div>
-                    <div>
-                      <span className="text-muted-foreground text-xs">
-                        الدورات:
-                      </span>{" "}
-                      {exam.courseIds.map((id) => courseName(id)).join(", ")}
-                    </div>
-                    <div>
-                      <span className="text-muted-foreground text-xs">
-                        المناطق:
-                      </span>{" "}
-                      {examMainSites.join(", ") || "الكل"}
-                    </div>
-                    <div>
-                      <span className="text-muted-foreground text-xs">
-                        المجموعات الإلكترونية:
-                      </span>{" "}
-                      {examGroupIds.map((id) => groupName(id)).join(", ") ||
-                        "الكل"}
-                    </div>
+                  <div className="mb-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
+                    <div><span className="text-xs text-muted-foreground">النجاح:</span> {exam.passMark}</div>
+                    <div><span className="text-xs text-muted-foreground">الخصم:</span> {exam.discountMark}</div>
+                    <div><span className="text-xs text-muted-foreground">الحضور:</span> {exam.attendance.length} طالب</div>
+                    <div><span className="text-xs text-muted-foreground">الدورات:</span> {exam.courseIds.map((id) => courseName(id)).join("، ")}</div>
+                    <div><span className="text-xs text-muted-foreground">المناطق:</span> {examMainSites.join("، ") || "الكل"}</div>
+                    <div><span className="text-xs text-muted-foreground">المجموعات:</span> {examGroupIds.map((id) => groupName(id)).join("، ") || "الكل"}</div>
+                    {exam.scheduledActivateAt && <div><span className="text-xs text-muted-foreground">تفعيل:</span> {exam.scheduledActivateAt}</div>}
+                    {exam.scheduledDeactivateAt && <div><span className="text-xs text-muted-foreground">تعطيل:</span> {exam.scheduledDeactivateAt}</div>}
                   </div>
-                  <div className="flex gap-2">
-                    <Button
-                      variant="outline"
-                      size="sm"
-                      onClick={() => toggleExam(exam.id)}
-                    >
-                      {exam.active ? "تعطيل" : "تفعيل"}
-                    </Button>
-                    <Button
-                      variant="outline"
-                      size="sm"
-                      onClick={() => setSelectedExamId(exam.id)}
-                    >
-                      إدارة الحضور ({exam.attendance.length})
-                    </Button>
+                  <div className="flex flex-wrap gap-2">
+                    <Button variant="outline" size="sm" onClick={() => toggleExam(exam.id)}>{exam.active ? "تعطيل" : "تفعيل"}</Button>
+                    <Button variant="secondary" size="sm" onClick={() => setEditDialog({ open: true, id: exam.id, form: formFromExam(exam) })}>تعديل كل التفاصيل</Button>
+                    <Button variant="outline" size="sm" onClick={() => setSelectedExamId(exam.id)}>إدارة الحضور ({exam.attendance.length})</Button>
                   </div>
                 </div>
               );
@@ -627,73 +428,36 @@
           <CardHeader className="flex flex-row items-center justify-between">
             <CardTitle>إدارة الحضور - {selectedExam.name}</CardTitle>
             <div className="flex gap-2">
-              {!selectedExam.attendanceClosed && (
-                <Button
-                  size="sm"
-                  onClick={() => {
-                    closeAttendance(selectedExam.id);
-                    toast.success("تم إغلاق الحضور");
-                  }}
-                >
-                  إغلاق الحضور
-                </Button>
-              )}
-              <Button
-                variant="ghost"
-                size="sm"
-                onClick={() => setSelectedExamId("")}
-              >
-                إغلاق
-              </Button>
+              {!selectedExam.attendanceClosed && <Button size="sm" onClick={() => { closeAttendance(selectedExam.id); toast.success("تم إغلاق الحضور"); }}>إغلاق الحضور</Button>}
+              <Button variant="ghost" size="sm" onClick={() => setSelectedExamId("")}>إغلاق</Button>
             </div>
           </CardHeader>
           <CardContent>
             <div className="space-y-2">
-              {selectedExamStudents.length === 0 ? (
-                <p className="empty-state">
-                  لا يوجد طلاب مطابقون للدورات والمناطق والمجموعات الإلكترونية المختارة.
-                </p>
-              ) : (
-                selectedExamStudents.map((s) => (
-                  <div
-                    key={s.id}
-                    className="flex items-center justify-between p-2 rounded-xl bg-muted/60"
-                  >
-                    <span className="text-sm">
-                      {s.name} ({s.code})
-                    </span>
-                    <div className="flex items-center gap-2">
-                      <Checkbox
-                        id={`exam-attendance-${s.id}`}
-                        name={`attendance-${s.id}`}
-                        checked={selectedExam.attendance.includes(s.id)}
-                        onCheckedChange={() =>
-                          handleToggleAttendance(selectedExam.id, s.id)
-                        }
-                        disabled={selectedExam.attendanceClosed}
-                        aria-label={`حضور ${s.name}`}
-                      />
-                      <Label htmlFor={`exam-attendance-${s.id}`}>
-                        <Badge
-                          variant={
-                            selectedExam.attendance.includes(s.id)
-                              ? "default"
-                              : "secondary"
-                          }
-                        >
-                          {selectedExam.attendance.includes(s.id)
-                            ? "حاضر"
-                            : "غائب"}
-                        </Badge>
-                      </Label>
-                    </div>
+              {selectedExamStudents.length === 0 ? <p className="empty-state">لا يوجد طلاب مطابقون للدورات والمناطق والمجموعات المختارة أو لا توجد فصول مفعلة.</p> : selectedExamStudents.map((student) => (
+                <div key={student.id} className="flex items-center justify-between rounded-xl bg-muted/60 p-2">
+                  <span className="text-sm">{student.name} ({student.code})</span>
+                  <div className="flex items-center gap-2">
+                    <Checkbox checked={selectedExam.attendance.includes(student.id)} onCheckedChange={() => toggleAttendance(selectedExam.id, student.id)} disabled={selectedExam.attendanceClosed} />
+                    <Badge variant={selectedExam.attendance.includes(student.id) ? "default" : "secondary"}>{selectedExam.attendance.includes(student.id) ? "حاضر" : "غائب"}</Badge>
                   </div>
-                ))
-              )}
+                </div>
+              ))}
             </div>
           </CardContent>
         </Card>
       )}
+
+      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}>
+        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl" dir="rtl">
+          <DialogHeader><DialogTitle>تعديل الامتحان بالكامل</DialogTitle></DialogHeader>
+          {renderFormFields(editDialog.form, (updater) => setEditDialog((prev) => ({ ...prev, form: updater(prev.form) })), "edit-exam")}
+          <DialogFooter>
+            <Button variant="ghost" onClick={() => setEditDialog({ open: false, id: "", form: emptyForm() })}>إلغاء</Button>
+            <Button onClick={saveExamEdit}>حفظ التعديلات وإعادة الاحتساب</Button>
+          </DialogFooter>
+        </DialogContent>
+      </Dialog>
     </div>
   );
 }
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/components/teacher-pro/exam-records.tsx /mnt/data/work/TeacherPro-main/src/components/teacher-pro/exam-records.tsx
--- /mnt/data/original/TeacherPro-main/src/components/teacher-pro/exam-records.tsx	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/components/teacher-pro/exam-records.tsx	2026-05-28 14:02:14.354014945 +0000
@@ -1,11 +1,12 @@
 "use client";
 
-import React, { useState, useMemo } from "react";
+import React, { useMemo, useState } from "react";
 import { useTeacherStore } from "@/lib/teacher-store";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Badge } from "@/components/ui/badge";
 import { Label } from "@/components/ui/label";
+import { Input } from "@/components/ui/input";
 import {
   Select,
   SelectContent,
@@ -24,8 +25,31 @@
   AlertDialogHeader,
   AlertDialogTitle,
 } from "@/components/ui/alert-dialog";
+import {
+  Dialog,
+  DialogContent,
+  DialogFooter,
+  DialogHeader,
+  DialogTitle,
+} from "@/components/ui/dialog";
 import { toast } from "sonner";
 import { useActionLock } from "@/hooks/use-action-lock";
+import { downloadTextFile, escapeHtml, getExamStatus } from "@/lib/exam-utils";
+import { searchAny } from "@/lib/validation";
+
+type ReportOptions = {
+  orientation: "portrait" | "landscape";
+  showPhone: boolean;
+  showTelegram: boolean;
+  showNotes: boolean;
+};
+
+const defaultReportOptions: ReportOptions = {
+  orientation: "portrait",
+  showPhone: false,
+  showTelegram: true,
+  showNotes: true,
+};
 
 export function ExamRecordsView() {
   const {
@@ -39,51 +63,143 @@
     classification,
   } = useTeacherStore();
 
+  const [search, setSearch] = useState("");
   const [filterType, setFilterType] = useState("");
   const [filterCourseId, setFilterCourseId] = useState("");
   const [accountingFilter, setAccountingFilter] = useState(false);
-  const [deleteDialog, setDeleteDialog] = useState({
-    open: false,
-    id: "",
-    name: "",
-  });
-  const { locked: isDeletingExam, runLocked: runDeleteExamLocked } =
-    useActionLock();
+  const [reportOptions, setReportOptions] = useState<ReportOptions>(defaultReportOptions);
+  const [customizeOpen, setCustomizeOpen] = useState(false);
+  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: "", name: "" });
+  const [editDialog, setEditDialog] = useState({ open: false, id: "", name: "", passMark: "", discountMark: "", fullMark: "" });
+  const { locked: isDeletingExam, runLocked: runDeleteExamLocked } = useActionLock();
 
   const filteredExams = useMemo(() => {
-    return exams.filter((e) => {
-      if (filterType && e.type !== filterType) return false;
-      if (filterCourseId && !e.courseIds.includes(filterCourseId)) return false;
+    return exams.filter((exam) => {
+      if (search && !searchAny(search, [exam.name, exam.date, ...exam.courseIds.map(courseName)])) return false;
+      if (filterType && exam.type !== filterType) return false;
+      if (filterCourseId && !exam.courseIds.includes(filterCourseId)) return false;
       return true;
     });
-  }, [exams, filterType, filterCourseId]);
+  }, [exams, search, filterType, filterCourseId, courseName]);
 
-  const exportPDF = (examId: string) => {
-    const exam = exams.find((e) => e.id === examId);
+  const examRows = (examId: string) => {
+    const exam = exams.find((item) => item.id === examId);
+    if (!exam) return [];
+    return grades
+      .filter((grade) => grade.examId === examId)
+      .map((grade) => {
+        const student = students.find((item) => item.id === grade.studentId);
+        const cls = classification(grade, exam);
+        return { grade, student, cls };
+      })
+      .filter((row) => row.student && (!accountingFilter || row.cls.kind === "accounting"))
+      .sort((a, b) => (a.student?.name || "").localeCompare(b.student?.name || "", "ar"));
+  };
+
+  const exportCSV = (examId: string) => {
+    const exam = exams.find((item) => item.id === examId);
     if (!exam) return;
+    const headers = ["#", "الكود", "الطالب", "الدورة", "الحالة", "الدرجة", "التصنيف", "الهاتف", "التليكرام", "ملاحظات"];
+    const rows = examRows(examId).map((row, index) => [
+      String(index + 1),
+      row.student?.code || "",
+      row.student?.name || "",
+      row.student ? courseName(row.student.courseId) : "",
+      row.grade.status,
+      row.grade.score === null ? "" : `${row.grade.score}/${exam.fullMark}`,
+      row.cls.text,
+      row.student?.phone || "",
+      row.student?.telegram || "",
+      row.grade.notes || "",
+    ]);
+    const csv = "\ufeff" + [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
+    downloadTextFile(csv, `exam-${exam.name}-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
+    toast.success("تم تصدير CSV");
+  };
 
-    const examGrades = grades.filter((g) => g.examId === examId);
-    const data = examGrades
-      .map((g) => {
-        const student = students.find((s) => s.id === g.studentId);
-        const cls = classification(g, exam);
-        return {
-          name: student?.name || "",
-          code: student?.code || "",
-          status: g.status,
-          score: g.score,
-          classification: cls.text,
-        };
-      })
-      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
+  const exportExcel = (examId: string) => {
+    const exam = exams.find((item) => item.id === examId);
+    if (!exam) return;
+    const rows = examRows(examId).map((row, index) => `
+      <tr>
+        <td>${index + 1}</td><td>${escapeHtml(row.student?.code)}</td><td>${escapeHtml(row.student?.name)}</td>
+        <td>${escapeHtml(row.student ? courseName(row.student.courseId) : "")}</td><td>${escapeHtml(row.grade.status)}</td>
+        <td>${escapeHtml(row.grade.score === null ? "" : `${row.grade.score}/${exam.fullMark}`)}</td><td>${escapeHtml(row.cls.text)}</td>
+        <td>${escapeHtml(row.student?.phone)}</td><td>${escapeHtml(row.student?.telegram)}</td><td>${escapeHtml(row.grade.notes)}</td>
+      </tr>`).join("");
+    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr><th>#</th><th>الكود</th><th>الطالب</th><th>الدورة</th><th>الحالة</th><th>الدرجة</th><th>التصنيف</th><th>الهاتف</th><th>التليكرام</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
+    downloadTextFile(html, `exam-${exam.name}.xls`, "application/vnd.ms-excel;charset=utf-8");
+    toast.success("تم تصدير Excel");
+  };
 
-    const rows = data
-      .map(
-        (d, i) =>
-          `<tr><td>${i + 1}</td><td>${d.code}</td><td>${d.name}</td><td>${d.status}</td><td>${d.score ?? "-"}/${exam.fullMark}</td><td>${d.classification}</td></tr>`,
-      )
-      .join("");
-    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>${exam.name}</title><style>body{font-family:Arial,sans-serif;padding:24px;direction:rtl}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f4f4f4}@media print{button{display:none}}</style></head><body><button onclick="window.print()">حفظ PDF / طباعة</button><h1>سجل الامتحان: ${exam.name}</h1><p>التاريخ: ${exam.date} | النوع: ${exam.type} | النجاح: ${exam.passMark} | الخصم: ${exam.discountMark}</p><table><thead><tr><th>#</th><th>الكود</th><th>الطالب</th><th>الحالة</th><th>الدرجة</th><th>التصنيف</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`;
+  const exportPDF = (examId: string) => {
+    const exam = exams.find((item) => item.id === examId);
+    if (!exam) return;
+    const rows = examRows(examId);
+    const passCount = rows.filter((row) => row.cls.kind === "pass").length;
+    const accountingCount = rows.filter((row) => row.cls.kind === "accounting").length;
+    const deductedCount = rows.filter((row) => row.cls.kind === "deducted").length;
+
+    const tableRows = rows.map((row, index) => `
+      <tr>
+        <td>${index + 1}</td>
+        <td>${escapeHtml(row.student?.code)}</td>
+        <td>${escapeHtml(row.student?.name)}</td>
+        <td>${escapeHtml(row.student ? courseName(row.student.courseId) : "")}</td>
+        <td>${escapeHtml(row.grade.status)}</td>
+        <td>${escapeHtml(row.grade.score === null ? "-" : `${row.grade.score}/${exam.fullMark}`)}</td>
+        <td><span class="pill">${escapeHtml(row.cls.text)}</span></td>
+        ${reportOptions.showPhone ? `<td>${escapeHtml(row.student?.phone)}</td>` : ""}
+        ${reportOptions.showTelegram ? `<td>${escapeHtml(row.student?.telegram)}</td>` : ""}
+        ${reportOptions.showNotes ? `<td>${escapeHtml(row.grade.notes || "-")}</td>` : ""}
+      </tr>`).join("");
+
+    const extraHeaders = `${reportOptions.showPhone ? "<th>الهاتف</th>" : ""}${reportOptions.showTelegram ? "<th>التليكرام</th>" : ""}${reportOptions.showNotes ? "<th>ملاحظات</th>" : ""}`;
+    const html = `<!doctype html>
+<html dir="rtl" lang="ar">
+<head>
+<meta charset="utf-8" />
+<title>${escapeHtml(exam.name)}</title>
+<style>
+@page { size: A4 ${reportOptions.orientation}; margin: 12mm; }
+* { box-sizing: border-box; }
+body { margin: 0; font-family: "Cairo", "Tahoma", Arial, sans-serif; color: #111827; background: #f8fafc; direction: rtl; }
+.toolbar { position: sticky; top: 0; display: flex; gap: 8px; padding: 12px; background: #111827; color: white; z-index: 3; }
+.toolbar button { border: 0; border-radius: 12px; padding: 10px 16px; cursor: pointer; font-weight: 700; }
+.report { max-width: 1200px; margin: 24px auto; background: white; border-radius: 24px; padding: 28px; box-shadow: 0 24px 80px rgba(15,23,42,.12); }
+.header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #7c3aed; padding-bottom: 18px; }
+.brand { font-size: 28px; font-weight: 900; color: #6d28d9; }
+h1 { margin: 8px 0 0; font-size: 22px; }
+.meta { color: #64748b; line-height: 1.9; font-size: 13px; }
+.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
+.stat { border: 1px solid #e5e7eb; border-radius: 18px; padding: 14px; background: #faf5ff; }
+.stat strong { display:block; font-size: 22px; color: #581c87; }
+table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 18px; font-size: 12px; }
+th { background: #ede9fe; color: #2e1065; }
+th,td { border: 1px solid #e5e7eb; padding: 9px; text-align: right; }
+tr:nth-child(even) td { background: #f8fafc; }
+.pill { display:inline-block; border-radius:999px; padding:4px 10px; background:#f3e8ff; color:#6b21a8; font-weight:700; }
+.footer { margin-top: 18px; color: #64748b; font-size: 11px; display:flex; justify-content:space-between; }
+@media print { body { background: white; } .toolbar { display: none; } .report { box-shadow: none; margin: 0; border-radius: 0; padding: 0; max-width: none; } }
+</style>
+</head>
+<body>
+<div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>
+<main class="report">
+  <section class="header">
+    <div><div class="brand">TeacherPro</div><h1>سجل الامتحان: ${escapeHtml(exam.name)}</h1><div class="meta">التاريخ: ${escapeHtml(exam.date)} | النوع: ${escapeHtml(exam.type)} | الحالة: ${escapeHtml(getExamStatus(exam))}</div></div>
+    <div class="meta">الدورات: ${escapeHtml(exam.courseIds.map(courseName).join("، "))}<br/>النجاح: ${exam.passMark} | الخصم: ${exam.discountMark} | الدرجة الكاملة: ${exam.fullMark}</div>
+  </section>
+  <section class="stats">
+    <div class="stat"><strong>${rows.length}</strong><span>إجمالي السجلات</span></div>
+    <div class="stat"><strong>${passCount}</strong><span>ناجح</span></div>
+    <div class="stat"><strong>${accountingCount}</strong><span>محاسبة</span></div>
+    <div class="stat"><strong>${deductedCount}</strong><span>مخصوم / غائب</span></div>
+  </section>
+  <table><thead><tr><th>#</th><th>الكود</th><th>الطالب</th><th>الدورة</th><th>الحالة</th><th>الدرجة</th><th>التصنيف</th>${extraHeaders}</tr></thead><tbody>${tableRows}</tbody></table>
+  <div class="footer"><span>تم إنشاء التقرير آلياً</span><span>${new Date().toLocaleString("ar-IQ")}</span></div>
+</main>
+</body></html>`;
     const win = window.open("", "_blank");
     if (!win) {
       toast.error("المتصفح منع نافذة الطباعة");
@@ -91,26 +207,29 @@
     }
     win.document.write(html);
     win.document.close();
-    toast.success("تم فتح نافذة PDF");
+    toast.success("تم فتح تقرير PDF الاحترافي");
   };
 
-  const handleEditExam = (examId: string) => {
-    const exam = exams.find((e) => e.id === examId);
+  const openEditExamDialog = (examId: string) => {
+    const exam = exams.find((item) => item.id === examId);
     if (!exam) return;
-    const nextName = prompt("اسم الامتحان", exam.name);
-    if (!nextName || !nextName.trim()) return;
-    const passMark = Number(
-      prompt("درجة النجاح", String(exam.passMark)) || exam.passMark,
-    );
-    const discountMark = Number(
-      prompt("درجة الخصم", String(exam.discountMark)) || exam.discountMark,
-    );
-    updateExam(examId, { name: nextName.trim(), passMark, discountMark });
-    toast.success("تم تعديل الامتحان");
+    setEditDialog({ open: true, id: examId, name: exam.name, passMark: String(exam.passMark), discountMark: String(exam.discountMark), fullMark: String(exam.fullMark) });
+  };
+
+  const handleEditExam = () => {
+    if (!editDialog.name.trim()) return toast.error("اسم الامتحان مطلوب");
+    updateExam(editDialog.id, {
+      name: editDialog.name.trim(),
+      fullMark: Number(editDialog.fullMark) || 100,
+      passMark: Number(editDialog.passMark) || 60,
+      discountMark: Number(editDialog.discountMark) || 0,
+    });
+    setEditDialog({ open: false, id: "", name: "", passMark: "", discountMark: "", fullMark: "" });
+    toast.success("تم تعديل الامتحان وإعادة الاحتساب");
   };
 
   const openDeleteExamDialog = (examId: string) => {
-    const exam = exams.find((e) => e.id === examId);
+    const exam = exams.find((item) => item.id === examId);
     setDeleteDialog({ open: true, id: examId, name: exam?.name || "" });
   };
 
@@ -122,200 +241,75 @@
 
   return (
     <div className="space-y-4">
-      {/* Filters */}
       <Card>
         <CardContent className="p-4">
-          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
+          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
+            <div className="space-y-1 lg:col-span-2">
+              <Label htmlFor="exam-records-search" className="text-xs">بحث</Label>
+              <Input id="exam-records-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم الامتحان / التاريخ / الدورة" />
+            </div>
             <div className="space-y-1">
-              <Label htmlFor="exam-records-type" className="text-xs">
-                نوع الامتحان
-              </Label>
-              <Select
-                name="type"
-                value={filterType}
-                onValueChange={(v) => setFilterType(v === "all" ? "" : v)}
-              >
-                <SelectTrigger id="exam-records-type">
-                  <SelectValue placeholder="الكل" />
-                </SelectTrigger>
-                <SelectContent>
-                  <SelectItem value="all">الكل</SelectItem>
-                  <SelectItem value="يومي">يومي</SelectItem>
-                  <SelectItem value="تراكمي">تراكمي</SelectItem>
-                  <SelectItem value="فاينل">فاينل</SelectItem>
-                </SelectContent>
+              <Label htmlFor="exam-records-type" className="text-xs">نوع الامتحان</Label>
+              <Select value={filterType || "all"} onValueChange={(v) => setFilterType(v === "all" ? "" : v)}>
+                <SelectTrigger id="exam-records-type"><SelectValue placeholder="الكل" /></SelectTrigger>
+                <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="يومي">يومي</SelectItem><SelectItem value="تراكمي">تراكمي</SelectItem><SelectItem value="فاينل">فاينل</SelectItem></SelectContent>
               </Select>
             </div>
             <div className="space-y-1">
-              <Label htmlFor="exam-records-course" className="text-xs">
-                الدورة
-              </Label>
-              <Select
-                name="courseId"
-                value={filterCourseId}
-                onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}
-              >
-                <SelectTrigger id="exam-records-course">
-                  <SelectValue placeholder="الكل" />
-                </SelectTrigger>
-                <SelectContent>
-                  <SelectItem value="all">الكل</SelectItem>
-                  {courses.map((c) => (
-                    <SelectItem key={c.id} value={c.id}>
-                      {c.name}
-                    </SelectItem>
-                  ))}
-                </SelectContent>
+              <Label htmlFor="exam-records-course" className="text-xs">الدورة</Label>
+              <Select value={filterCourseId || "all"} onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}>
+                <SelectTrigger id="exam-records-course"><SelectValue placeholder="الكل" /></SelectTrigger>
+                <SelectContent><SelectItem value="all">الكل</SelectItem>{courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}</SelectContent>
               </Select>
             </div>
             <div className="flex items-center gap-2 pt-5">
-              <Checkbox
-                id="exam-records-accounting"
-                name="accounting"
-                checked={accountingFilter}
-                onCheckedChange={(v) => setAccountingFilter(!!v)}
-              />
-              <Label htmlFor="exam-records-accounting" className="text-xs">
-                محاسبة فقط
-              </Label>
+              <Checkbox id="exam-records-accounting" checked={accountingFilter} onCheckedChange={(v) => setAccountingFilter(!!v)} />
+              <Label htmlFor="exam-records-accounting" className="text-xs">محاسبة فقط</Label>
+            </div>
+            <div className="space-y-1">
+              <span className="text-xs font-medium">تخصيص التقرير</span>
+              <Button variant="outline" size="sm" className="h-9 w-full" onClick={() => setCustomizeOpen(true)}>تخصيص PDF</Button>
             </div>
           </div>
         </CardContent>
       </Card>
 
-      {/* Exam Cards */}
-      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
+      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
         {filteredExams.map((exam) => {
-          const examStudents = grades
-            .filter((g) => g.examId === exam.id)
-            .map((g) => {
-              const student = students.find((s) => s.id === g.studentId);
-              const cls = classification(g, exam);
-              return { ...g, student, cls };
-            })
-            .filter((g) => {
-              if (!g.student) return false;
-              if (accountingFilter && g.cls.kind !== "accounting") return false;
-              return true;
-            })
-            .sort((a, b) =>
-              (a.student?.name || "").localeCompare(
-                b.student?.name || "",
-                "ar",
-              ),
-            );
-
-          const passCount = examStudents.filter(
-            (g) => g.cls.kind === "pass",
-          ).length;
-          const failCount = examStudents.filter(
-            (g) => g.cls.kind === "deducted",
-          ).length;
-          const absentCount = examStudents.filter(
-            (g) => g.status === "غائب",
-          ).length;
-
+          const rows = examRows(exam.id);
+          const passCount = rows.filter((row) => row.cls.kind === "pass").length;
+          const failCount = rows.filter((row) => row.cls.kind === "deducted").length;
+          const absentCount = rows.filter((row) => row.grade.status === "غائب").length;
           return (
-            <Card
-              key={exam.id}
-              className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10"
-            >
+            <Card key={exam.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10">
               <CardHeader className="pb-2">
-                <div className="flex items-start justify-between">
+                <div className="flex items-start justify-between gap-3">
                   <div>
                     <CardTitle className="text-base">{exam.name}</CardTitle>
-                    <p className="text-xs text-muted-foreground mt-1">
-                      {exam.date} - {courseName(exam.courseIds[0])}
-                    </p>
+                    <p className="mt-1 text-xs text-muted-foreground">{exam.date} - {exam.courseIds.map(courseName).join("، ")}</p>
+                    <Badge variant="outline" className="mt-2">{getExamStatus(exam)}</Badge>
                   </div>
-                  <div className="flex gap-1">
-                    <Badge
-                      variant={
-                        exam.type === "يومي"
-                          ? "secondary"
-                          : exam.type === "تراكمي"
-                            ? "default"
-                            : "destructive"
-                      }
-                    >
-                      {exam.type}
-                    </Badge>
-                    <Button
-                      variant="ghost"
-                      size="sm"
-                      onClick={() => exportPDF(exam.id)}
-                    >
-                      PDF
-                    </Button>
-                    <Button
-                      variant="secondary"
-                      size="sm"
-                      onClick={() => handleEditExam(exam.id)}
-                    >
-                      تعديل
-                    </Button>
-                    <Button
-                      variant="destructive"
-                      size="sm"
-                      onClick={() => openDeleteExamDialog(exam.id)}
-                    >
-                      حذف
-                    </Button>
+                  <div className="flex flex-wrap justify-end gap-1">
+                    <Badge>{exam.type}</Badge>
+                    <Button variant="ghost" size="sm" onClick={() => exportPDF(exam.id)}>PDF</Button>
+                    <Button variant="ghost" size="sm" onClick={() => exportExcel(exam.id)}>Excel</Button>
+                    <Button variant="ghost" size="sm" onClick={() => exportCSV(exam.id)}>CSV</Button>
+                    <Button variant="secondary" size="sm" onClick={() => openEditExamDialog(exam.id)}>تعديل</Button>
+                    <Button variant="destructive" size="sm" onClick={() => openDeleteExamDialog(exam.id)}>حذف</Button>
                   </div>
                 </div>
               </CardHeader>
               <CardContent>
-                {/* Stats */}
-                <div className="grid grid-cols-3 gap-2 mb-3 text-center">
-                  <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/40">
-                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
-                      {passCount}
-                    </p>
-                    <p className="text-[10px] text-muted-foreground">ناجح</p>
-                  </div>
-                  <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/40">
-                    <p className="text-lg font-bold text-rose-600 dark:text-rose-400">
-                      {failCount + absentCount}
-                    </p>
-                    <p className="text-[10px] text-muted-foreground">
-                      راسب/غائب
-                    </p>
-                  </div>
-                  <div className="p-2 rounded bg-sky-50 dark:bg-sky-950/40">
-                    <p className="text-lg font-bold text-sky-600 dark:text-sky-400">
-                      {examStudents.length}
-                    </p>
-                    <p className="text-[10px] text-muted-foreground">إجمالي</p>
-                  </div>
+                <div className="mb-3 grid grid-cols-3 gap-2 text-center">
+                  <div className="rounded bg-emerald-50 p-2 dark:bg-emerald-950/40"><p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{passCount}</p><p className="text-[10px] text-muted-foreground">ناجح</p></div>
+                  <div className="rounded bg-rose-50 p-2 dark:bg-rose-950/40"><p className="text-lg font-bold text-rose-600 dark:text-rose-400">{failCount + absentCount}</p><p className="text-[10px] text-muted-foreground">راسب/غائب</p></div>
+                  <div className="rounded bg-sky-50 p-2 dark:bg-sky-950/40"><p className="text-lg font-bold text-sky-600 dark:text-sky-400">{rows.length}</p><p className="text-[10px] text-muted-foreground">إجمالي</p></div>
                 </div>
-
-                {/* Student Results */}
-                <div className="space-y-1 max-h-60 overflow-y-auto">
-                  {examStudents.map((g) => (
-                    <div
-                      key={g.id}
-                      className="flex items-center justify-between text-sm p-2 rounded-xl bg-muted/60"
-                    >
-                      <span className="truncate">{g.student?.name}</span>
-                      <div className="flex items-center gap-2">
-                        {g.score !== null && (
-                          <span className="font-bold">{g.score}</span>
-                        )}
-                        <Badge
-                          variant={
-                            g.cls.type === "ok"
-                              ? "default"
-                              : g.cls.type === "danger"
-                                ? "destructive"
-                                : g.cls.type === "warn"
-                                  ? "secondary"
-                                  : "outline"
-                          }
-                          className="text-[10px]"
-                        >
-                          {g.cls.text}
-                        </Badge>
-                      </div>
+                <div className="max-h-60 space-y-1 overflow-y-auto">
+                  {rows.map((row) => (
+                    <div key={row.grade.id} className="flex items-center justify-between rounded-xl bg-muted/60 p-2 text-sm">
+                      <span className="truncate">{row.student?.name}</span>
+                      <div className="flex items-center gap-2">{row.grade.score !== null && <span className="font-bold">{row.grade.score}</span>}<Badge variant={row.cls.type === "ok" ? "default" : row.cls.type === "danger" ? "destructive" : row.cls.type === "warn" ? "secondary" : "outline"} className="text-[10px]">{row.cls.text}</Badge></div>
                     </div>
                   ))}
                 </div>
@@ -325,28 +319,42 @@
         })}
       </div>
 
-      <AlertDialog
-        open={deleteDialog.open}
-        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
-      >
+      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
+        <DialogContent dir="rtl">
+          <DialogHeader><DialogTitle>تخصيص تقرير PDF</DialogTitle></DialogHeader>
+          <div className="space-y-4">
+            <div className="space-y-2">
+              <Label>اتجاه الصفحة</Label>
+              <Select value={reportOptions.orientation} onValueChange={(value) => setReportOptions((prev) => ({ ...prev, orientation: value as ReportOptions["orientation"] }))}>
+                <SelectTrigger><SelectValue /></SelectTrigger>
+                <SelectContent><SelectItem value="portrait">A4 بالطول</SelectItem><SelectItem value="landscape">A4 بالعرض</SelectItem></SelectContent>
+              </Select>
+            </div>
+            {[ ["showTelegram", "إظهار التليكرام"], ["showPhone", "إظهار الهاتف"], ["showNotes", "إظهار الملاحظات"] ].map(([key, label]) => (
+              <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(reportOptions[key as keyof ReportOptions])} onCheckedChange={(value) => setReportOptions((prev) => ({ ...prev, [key]: Boolean(value) }))} />{label}</label>
+            ))}
+          </div>
+          <DialogFooter><Button onClick={() => setCustomizeOpen(false)}>حفظ التخصيص</Button></DialogFooter>
+        </DialogContent>
+      </Dialog>
+
+      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}>
+        <DialogContent dir="rtl">
+          <DialogHeader><DialogTitle>تعديل سريع للامتحان</DialogTitle></DialogHeader>
+          <div className="grid gap-3 sm:grid-cols-2">
+            <div className="space-y-1 sm:col-span-2"><Label>اسم الامتحان</Label><Input value={editDialog.name} onChange={(e) => setEditDialog((prev) => ({ ...prev, name: e.target.value }))} /></div>
+            <div className="space-y-1"><Label>الدرجة الكاملة</Label><Input type="number" value={editDialog.fullMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, fullMark: e.target.value }))} /></div>
+            <div className="space-y-1"><Label>درجة النجاح</Label><Input type="number" value={editDialog.passMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, passMark: e.target.value }))} /></div>
+            <div className="space-y-1"><Label>درجة الخصم</Label><Input type="number" value={editDialog.discountMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, discountMark: e.target.value }))} /></div>
+          </div>
+          <DialogFooter><Button variant="ghost" onClick={() => setEditDialog({ open: false, id: "", name: "", passMark: "", discountMark: "", fullMark: "" })}>إلغاء</Button><Button onClick={handleEditExam}>حفظ</Button></DialogFooter>
+        </DialogContent>
+      </Dialog>
+
+      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}>
         <AlertDialogContent dir="rtl">
-          <AlertDialogHeader>
-            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
-            <AlertDialogDescription>
-              هل أنت متأكد من حذف الامتحان &quot;{deleteDialog.name}&quot;؟ سيتم
-              حذف الدرجات وأوراق التصحيح التابعة له.
-            </AlertDialogDescription>
-          </AlertDialogHeader>
-          <AlertDialogFooter>
-            <AlertDialogCancel>إلغاء</AlertDialogCancel>
-            <AlertDialogAction
-              onClick={handleDeleteExam}
-              disabled={isDeletingExam}
-              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
-            >
-              {isDeletingExam ? "جاري الحذف..." : "حذف"}
-            </AlertDialogAction>
-          </AlertDialogFooter>
+          <AlertDialogHeader><AlertDialogTitle>تأكيد الحذف</AlertDialogTitle><AlertDialogDescription>هل أنت متأكد من حذف الامتحان &quot;{deleteDialog.name}&quot;؟ سيتم حذف الدرجات وأوراق التصحيح التابعة له.</AlertDialogDescription></AlertDialogHeader>
+          <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={handleDeleteExam} disabled={isDeletingExam} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isDeletingExam ? "جاري الحذف..." : "حذف"}</AlertDialogAction></AlertDialogFooter>
         </AlertDialogContent>
       </AlertDialog>
     </div>
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/components/teacher-pro/grade-entry.tsx /mnt/data/work/TeacherPro-main/src/components/teacher-pro/grade-entry.tsx
--- /mnt/data/original/TeacherPro-main/src/components/teacher-pro/grade-entry.tsx	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/components/teacher-pro/grade-entry.tsx	2026-05-28 14:00:06.144591817 +0000
@@ -1,6 +1,6 @@
 "use client";
 
-import React, { useState, useMemo } from "react";
+import React, { useMemo, useState } from "react";
 import { useTeacherStore } from "@/lib/teacher-store";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
@@ -16,75 +16,116 @@
 } from "@/components/ui/select";
 import { toast } from "sonner";
 import { toLatinDigits } from "@/lib/format";
-import { useActionLock } from "@/hooks/use-action-lock";
+import { searchAny } from "@/lib/validation";
+import { hasActiveChapterLink, isExamAvailableForEntry, splitSelection } from "@/lib/exam-utils";
+
+type DraftGrade = {
+  status: "درجة" | "غائب" | "مجاز" | "غش";
+  score: string;
+  notes: string;
+};
+
+const statusOptions: DraftGrade["status"][] = ["درجة", "غائب", "مجاز", "غش"];
 
 export function GradeEntryView() {
   const {
     exams,
     students,
     grades,
+    courses,
+    courseChapters,
     addGrade,
-    updateGrade,
     courseName,
     classification,
   } = useTeacherStore();
-  const { locked: isSavingGrade, runLocked: runSaveGradeLocked } =
-    useActionLock();
 
   const [selectedExamId, setSelectedExamId] = useState("");
+  const [search, setSearch] = useState("");
+  const [filterCourseId, setFilterCourseId] = useState("");
+  const [filterStatus, setFilterStatus] = useState("");
+  const [drafts, setDrafts] = useState<Record<string, DraftGrade>>({});
+  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
+  const [savedRows, setSavedRows] = useState<Record<string, string>>({});
 
   const selectedExam = exams.find((e) => e.id === selectedExamId);
-  const activeExams = exams.filter((e) => e.active);
+  const activeExams = exams.filter((e) => isExamAvailableForEntry(e));
+
+  const getGrade = (studentId: string) =>
+    grades.find((g) => g.studentId === studentId && g.examId === selectedExamId);
+
+  const getDraft = (studentId: string): DraftGrade => {
+    const existing = getGrade(studentId);
+    return drafts[studentId] || {
+      status: (existing?.status as DraftGrade["status"]) || "درجة",
+      score: existing?.score !== null && existing?.score !== undefined ? String(existing.score) : "",
+      notes: existing?.notes || "",
+    };
+  };
+
+  const updateDraft = (studentId: string, patch: Partial<DraftGrade>) => {
+    setDrafts((prev) => ({ ...prev, [studentId]: { ...getDraft(studentId), ...patch } }));
+  };
 
-  // Get students for the selected exam
   const examStudents = useMemo(() => {
     if (!selectedExam) return [];
+    const selectedMainSites = splitSelection(selectedExam.mainSite);
+    const selectedGroupIds = splitSelection(selectedExam.groupId);
+
     return students
-      .filter(
-        (s) =>
-          selectedExam.courseIds.includes(s.courseId) && s.status === "نشط",
-      )
+      .filter((student) => {
+        if (student.status !== "نشط") return false;
+        if (!selectedExam.courseIds.includes(student.courseId)) return false;
+        if (!hasActiveChapterLink(courseChapters, student.courseId)) return false;
+        if (selectedMainSites.length > 0 && !selectedMainSites.includes(student.mainSite)) return false;
+        if (selectedGroupIds.length > 0 && !selectedGroupIds.includes(student.groupId)) return false;
+        if (filterCourseId && student.courseId !== filterCourseId) return false;
+        if (search && !searchAny(search, [student.name, student.code, student.telegram, student.phone])) return false;
+        const grade = grades.find((g) => g.studentId === student.id && g.examId === selectedExam.id);
+        if (filterStatus === "غير مسجل" && grade) return false;
+        if (filterStatus && filterStatus !== "غير مسجل" && grade?.status !== filterStatus) return false;
+        return true;
+      })
       .sort((a, b) => a.name.localeCompare(b.name, "ar"));
-  }, [selectedExam, students]);
+  }, [selectedExam, students, grades, courseChapters, search, filterCourseId, filterStatus]);
 
-  // Get or create grade for student
-  const getGrade = (studentId: string) =>
-    grades.find(
-      (g) => g.studentId === studentId && g.examId === selectedExamId,
-    );
-
-  const [editGrade, setEditGrade] = useState<string | null>(null);
-  const [editScore, setEditScore] = useState("");
-  const [editStatus, setEditStatus] = useState("درجة");
-  const [editNotes, setEditNotes] = useState("");
-
-  const handleSaveGrade = runSaveGradeLocked(async (studentId: string) => {
-    if (!selectedExamId) return;
-
-    const status = editStatus as "درجة" | "غائب" | "مجاز" | "غش";
-    const score = status === "درجة" ? Number(editScore) || 0 : null;
+  const missingChapterCourses = useMemo(() => {
+    if (!selectedExam) return [];
+    return selectedExam.courseIds
+      .filter((courseId) => !hasActiveChapterLink(courseChapters, courseId))
+      .map((courseId) => courseName(courseId));
+  }, [selectedExam, courseChapters, courseName]);
+
+  const saveGrade = async (studentId: string, draftOverride?: DraftGrade) => {
+    if (!selectedExam) return;
+    const draft = draftOverride || getDraft(studentId);
+    const status = draft.status;
+    const score = status === "درجة" ? Number(toLatinDigits(draft.score)) : null;
+
+    if (status === "درجة") {
+      if (!Number.isFinite(score) || score === null || score < 0 || score > selectedExam.fullMark) {
+        toast.error(`الدرجة يجب أن تكون بين 0 و ${selectedExam.fullMark}`);
+        return;
+      }
+    }
 
+    setSavingRows((prev) => ({ ...prev, [studentId]: true }));
+    const existing = getGrade(studentId);
     addGrade({
       studentId,
-      examId: selectedExamId,
+      examId: selectedExam.id,
       status,
       score,
-      accountingChecked: false,
-      notes: editNotes,
+      accountingChecked: existing?.accountingChecked || false,
+      notes: draft.notes,
     });
+    setSavingRows((prev) => ({ ...prev, [studentId]: false }));
+    setSavedRows((prev) => ({ ...prev, [studentId]: new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" }) }));
+    toast.success("تم الحفظ تلقائياً");
+  };
 
-    setEditGrade(null);
-    setEditScore("");
-    setEditNotes("");
-    toast.success("تم حفظ الدرجة");
-  });
-
-  const startEdit = (studentId: string) => {
-    const existing = getGrade(studentId);
-    setEditGrade(studentId);
-    setEditStatus(existing?.status || "درجة");
-    setEditScore(existing?.score?.toString() || "");
-    setEditNotes(existing?.notes || "");
+  const handleQuickScan = () => {
+    const code = window.prompt("امسح QR/باركود أو اكتب كود الطالب للبحث");
+    if (code?.trim()) setSearch(code.trim());
   };
 
   return (
@@ -94,8 +135,8 @@
           <CardTitle>تسجيل الدرجات</CardTitle>
         </CardHeader>
         <CardContent>
-          <div className="space-y-4">
-            <div className="space-y-2">
+          <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
+            <div className="space-y-2 lg:col-span-2">
               <Label htmlFor="grade-entry-exam">اختر الامتحان</Label>
               <Select name="examId" value={selectedExamId} onValueChange={setSelectedExamId}>
                 <SelectTrigger id="grade-entry-exam">
@@ -111,31 +152,69 @@
               </Select>
             </div>
 
+            <div className="space-y-2">
+              <Label htmlFor="grade-entry-search">بحث الطالب</Label>
+              <Input
+                id="grade-entry-search"
+                value={search}
+                onChange={(e) => setSearch(e.target.value)}
+                placeholder="اسم / كود / تليكرام"
+                autoComplete="off"
+              />
+            </div>
+
+            <div className="space-y-2">
+              <Label htmlFor="grade-entry-course">الدورة</Label>
+              <Select value={filterCourseId || "all"} onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}>
+                <SelectTrigger id="grade-entry-course">
+                  <SelectValue placeholder="الكل" />
+                </SelectTrigger>
+                <SelectContent>
+                  <SelectItem value="all">الكل</SelectItem>
+                  {courses
+                    .filter((course) => selectedExam?.courseIds.includes(course.id))
+                    .map((course) => (
+                      <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>
+                    ))}
+                </SelectContent>
+              </Select>
+            </div>
+
+            <div className="space-y-2">
+              <Label htmlFor="grade-entry-status-filter">حالة الدرجة</Label>
+              <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
+                <SelectTrigger id="grade-entry-status-filter">
+                  <SelectValue placeholder="الكل" />
+                </SelectTrigger>
+                <SelectContent>
+                  <SelectItem value="all">الكل</SelectItem>
+                  <SelectItem value="غير مسجل">غير مسجل</SelectItem>
+                  {statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
+                </SelectContent>
+              </Select>
+            </div>
+          </div>
+
+          <div className="mt-4 flex flex-wrap items-center gap-2">
+            <Button variant="outline" size="sm" onClick={handleQuickScan}>بحث / مسح QR</Button>
             {selectedExam && (
-              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-2xl bg-muted/60">
-                <div>
-                  <span className="text-muted-foreground text-xs">النوع:</span>{" "}
-                  <Badge>{selectedExam.type}</Badge>
-                </div>
-                <div>
-                  <span className="text-muted-foreground text-xs">النجاح:</span>{" "}
-                  {selectedExam.passMark}
-                </div>
-                <div>
-                  <span className="text-muted-foreground text-xs">الخصم:</span>{" "}
-                  {selectedExam.discountMark}
-                </div>
-                <div>
-                  <span className="text-muted-foreground text-xs">الفصل:</span>{" "}
-                  {selectedExam.dismissalGrade || "لا يوجد"}
-                </div>
+              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
+                <Badge>{selectedExam.type}</Badge>
+                <span>النجاح: {selectedExam.passMark}</span>
+                <span>الخصم: {selectedExam.discountMark}</span>
+                <span>الفصل: {selectedExam.dismissalGrade || "لا يوجد"}</span>
               </div>
             )}
           </div>
+
+          {missingChapterCourses.length > 0 && (
+            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
+              الدورات التالية غير مربوطة بفصل نشط ولن تظهر ضمن إدخال الدرجات: {missingChapterCourses.join("، ")}
+            </div>
+          )}
         </CardContent>
       </Card>
 
-      {/* Grade Entry Table */}
       {selectedExam && (
         <Card>
           <CardHeader>
@@ -143,124 +222,77 @@
           </CardHeader>
           <CardContent>
             <div className="space-y-2">
-              {examStudents.map((student) => {
-                const grade = getGrade(student.id);
-                const isEditing = editGrade === student.id;
-                const cls = grade ? classification(grade, selectedExam) : null;
-
-                return (
-                  <div
-                    key={student.id}
-                    className="p-3 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
-                  >
-                    <div className="flex items-center justify-between gap-3">
-                      <div className="flex-1 min-w-0">
-                        <p className="font-medium text-sm truncate">
-                          {student.name}
-                        </p>
-                        <p className="text-xs text-muted-foreground">
-                          {student.code} - {courseName(student.courseId)}
-                        </p>
+              {examStudents.length === 0 ? (
+                <p className="empty-state">لا يوجد طلاب مطابقون للفلاتر أو للدورات المربوطة بفصل نشط.</p>
+              ) : (
+                examStudents.map((student) => {
+                  const grade = getGrade(student.id);
+                  const draft = getDraft(student.id);
+                  const cls = grade ? classification(grade, selectedExam) : null;
+                  const isSaving = Boolean(savingRows[student.id]);
+                  return (
+                    <div key={student.id} className="grid grid-cols-1 items-center gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm md:grid-cols-[1.4fr_120px_120px_1fr_120px]">
+                      <div className="min-w-0">
+                        <p className="truncate text-sm font-bold">{student.name}</p>
+                        <p className="text-xs text-muted-foreground">{student.code} - {courseName(student.courseId)}</p>
                       </div>
 
-                      {grade && !isEditing && (
-                        <div className="flex items-center gap-2">
-                          <Badge
-                            variant={
-                              cls?.type === "ok"
-                                ? "default"
-                                : cls?.type === "danger"
-                                  ? "destructive"
-                                  : cls?.type === "warn"
-                                    ? "secondary"
-                                    : "outline"
-                            }
-                          >
-                            {cls?.text || grade.status}
+                      <Input
+                        type="number"
+                        min={0}
+                        max={selectedExam.fullMark}
+                        disabled={draft.status !== "درجة"}
+                        value={draft.status === "درجة" ? draft.score : ""}
+                        onChange={(e) => updateDraft(student.id, { score: toLatinDigits(e.target.value), status: "درجة" })}
+                        onBlur={() => saveGrade(student.id)}
+                        onKeyDown={(event) => {
+                          if (event.key === "Enter") {
+                            event.preventDefault();
+                            void saveGrade(student.id);
+                          }
+                        }}
+                        placeholder="الدرجة"
+                        className="h-10"
+                      />
+
+                      <Select
+                        value={draft.status}
+                        onValueChange={(value) => {
+                          const nextDraft = { ...draft, status: value as DraftGrade["status"] };
+                          updateDraft(student.id, { status: nextDraft.status });
+                          void saveGrade(student.id, nextDraft);
+                        }}
+                      >
+                        <SelectTrigger className="h-10">
+                          <SelectValue />
+                        </SelectTrigger>
+                        <SelectContent>
+                          {statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
+                        </SelectContent>
+                      </Select>
+
+                      <Input
+                        value={draft.notes}
+                        onChange={(e) => updateDraft(student.id, { notes: e.target.value })}
+                        onBlur={() => saveGrade(student.id)}
+                        placeholder="ملاحظات"
+                        className="h-10"
+                      />
+
+                      <div className="flex items-center justify-end gap-2">
+                        {grade && cls && (
+                          <Badge variant={cls.type === "ok" ? "default" : cls.type === "danger" ? "destructive" : cls.type === "warn" ? "secondary" : "outline"}>
+                            {cls.text}
                           </Badge>
-                          {grade.score !== null && (
-                            <span className="text-sm font-bold">
-                              {grade.score}/{selectedExam.fullMark}
-                            </span>
-                          )}
-                        </div>
-                      )}
-
-                      {isEditing ? (
-                        <div className="flex items-center gap-2 flex-wrap">
-                          <Select
-                            name={`status-${student.id}`}
-                            value={editStatus}
-                            onValueChange={setEditStatus}
-                          >
-                            <SelectTrigger
-                              id={`grade-entry-status-${student.id}`}
-                              className="w-28 h-8"
-                            >
-                              <SelectValue />
-                            </SelectTrigger>
-                            <SelectContent>
-                              <SelectItem value="درجة">درجة</SelectItem>
-                              <SelectItem value="غائب">غائب</SelectItem>
-                              <SelectItem value="مجاز">مجاز</SelectItem>
-                              <SelectItem value="غش">غش</SelectItem>
-                            </SelectContent>
-                          </Select>
-                          {editStatus === "درجة" && (
-                            <Input
-                              id={`grade-entry-score-${student.id}`}
-                              name={`score-${student.id}`}
-                              type="number"
-                              autoComplete="off"
-                              className="w-20 h-8"
-                              value={editScore}
-                              onChange={(e) =>
-                                setEditScore(toLatinDigits(e.target.value))
-                              }
-                              placeholder="الدرجة"
-                              title="اكتب درجة الطالب رقماً فقط"
-                            />
-                          )}
-                          <Input
-                            id={`grade-entry-notes-${student.id}`}
-                            name={`notes-${student.id}`}
-                            autoComplete="off"
-                            className="w-32 h-8"
-                            value={editNotes}
-                            onChange={(e) => setEditNotes(e.target.value)}
-                            placeholder="ملاحظات"
-                            title="اكتب سبب الإجازة أو أي ملاحظة إدارية مهمة"
-                          />
-                          <Button
-                            size="sm"
-                            onClick={() => handleSaveGrade(student.id)}
-                            disabled={isSavingGrade}
-                            title="يحفظ الدرجة ويطبق القوانين تلقائياً"
-                          >
-                            {isSavingGrade ? "جاري الحفظ..." : "حفظ"}
-                          </Button>
-                          <Button
-                            size="sm"
-                            variant="ghost"
-                            onClick={() => setEditGrade(null)}
-                            title="يغلق الإدخال بدون حفظ تغيير جديد"
-                          >
-                            إلغاء
-                          </Button>
-                        </div>
-                      ) : (
-                        <Button
-                          size="sm"
-                          variant="outline"
-                          onClick={() => startEdit(student.id)}
-                        >
-                          {grade ? "تعديل" : "إدخال"}
-                        </Button>
-                      )}
+                        )}
+                        <Badge variant={savedRows[student.id] ? "default" : "outline"} className="text-[10px]">
+                          {isSaving ? "جاري الحفظ" : savedRows[student.id] ? `تم ${savedRows[student.id]}` : grade ? "محفوظ" : "غير محفوظ"}
+                        </Badge>
+                      </div>
                     </div>
-                  </div>
-                );
-              })}
+                  );
+                })
+              )}
             </div>
           </CardContent>
         </Card>
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/components/teacher-pro/grade-records.tsx /mnt/data/work/TeacherPro-main/src/components/teacher-pro/grade-records.tsx
--- /mnt/data/original/TeacherPro-main/src/components/teacher-pro/grade-records.tsx	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/components/teacher-pro/grade-records.tsx	2026-05-28 14:02:52.092444316 +0000
@@ -1,8 +1,8 @@
 "use client";
 
-import React, { useState, useMemo } from "react";
+import React, { useMemo, useState } from "react";
 import { useTeacherStore } from "@/lib/teacher-store";
-import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
+import { Card, CardContent } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { Badge } from "@/components/ui/badge";
@@ -25,10 +25,20 @@
   AlertDialogHeader,
   AlertDialogTitle,
 } from "@/components/ui/alert-dialog";
+import {
+  Dialog,
+  DialogContent,
+  DialogFooter,
+  DialogHeader,
+  DialogTitle,
+} from "@/components/ui/dialog";
 import { toast } from "sonner";
+import { toLatinDigits } from "@/lib/format";
 import { searchAny } from "@/lib/validation";
 import { useActionLock } from "@/hooks/use-action-lock";
 
+type GradeStatus = "درجة" | "غائب" | "مجاز" | "غش";
+
 export function GradeRecordsView() {
   const {
     grades,
@@ -47,74 +57,71 @@
   const [accountingChecked, setAccountingChecked] = useState(false);
   const [page, setPage] = useState(1);
   const [pageSize, setPageSize] = useState(10);
-  const [deleteDialog, setDeleteDialog] = useState({
+  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: "", label: "" });
+  const [editDialog, setEditDialog] = useState({
     open: false,
     id: "",
-    label: "",
+    status: "درجة" as GradeStatus,
+    score: "",
+    notes: "",
+    accountingChecked: false,
   });
-  const { locked: isDeletingGrade, runLocked: runDeleteGradeLocked } =
-    useActionLock();
+  const { locked: isDeletingGrade, runLocked: runDeleteGradeLocked } = useActionLock();
 
   const filtered = useMemo(() => {
-    return grades.filter((g) => {
-      const student = students.find((s) => s.id === g.studentId);
-      const exam = exams.find((e) => e.id === g.examId);
+    return grades.filter((grade) => {
+      const student = students.find((item) => item.id === grade.studentId);
+      const exam = exams.find((item) => item.id === grade.examId);
       if (!student || !exam) return false;
-      if (
-        search &&
-        !searchAny(search, [student.name, student.code, student.telegram])
-      )
-        return false;
-      if (filterExamId && g.examId !== filterExamId) return false;
-      if (filterStatus && g.status !== filterStatus) return false;
-      if (filterCourseId && !exam.courseIds.includes(filterCourseId))
-        return false;
-      if (accountingChecked && !g.accountingChecked) return false;
+      if (search && !searchAny(search, [student.name, student.code, student.telegram, exam.name])) return false;
+      if (filterExamId && grade.examId !== filterExamId) return false;
+      if (filterStatus && grade.status !== filterStatus) return false;
+      if (filterCourseId && !exam.courseIds.includes(filterCourseId)) return false;
+      if (accountingChecked && !grade.accountingChecked) return false;
       return true;
     });
-  }, [
-    grades,
-    students,
-    exams,
-    search,
-    filterExamId,
-    filterStatus,
-    filterCourseId,
-    accountingChecked,
-  ]);
+  }, [grades, students, exams, search, filterExamId, filterStatus, filterCourseId, accountingChecked]);
 
-  const totalPages = Math.ceil(filtered.length / pageSize);
+  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
   const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
 
-  const handleEditGrade = (gradeId: string) => {
-    const grade = grades.find((g) => g.id === gradeId);
+  const openEditGradeDialog = (gradeId: string) => {
+    const grade = grades.find((item) => item.id === gradeId);
     if (!grade) return;
-    const nextStatus = prompt(
-      "الحالة: درجة / غائب / مجاز / غش",
-      grade.status,
-    ) as "درجة" | "غائب" | "مجاز" | "غش" | null;
-    if (!nextStatus || !["درجة", "غائب", "مجاز", "غش"].includes(nextStatus))
+    setEditDialog({
+      open: true,
+      id: grade.id,
+      status: grade.status as GradeStatus,
+      score: grade.score !== null && grade.score !== undefined ? String(grade.score) : "",
+      notes: grade.notes || "",
+      accountingChecked: grade.accountingChecked,
+    });
+  };
+
+  const handleSaveEditGrade = () => {
+    const grade = grades.find((item) => item.id === editDialog.id);
+    const exam = grade ? exams.find((item) => item.id === grade.examId) : null;
+    if (!grade || !exam) return;
+    const score = editDialog.status === "درجة" ? Number(toLatinDigits(editDialog.score)) : null;
+    if (editDialog.status === "درجة" && (!Number.isFinite(score) || score === null || score < 0 || score > exam.fullMark)) {
+      toast.error(`الدرجة يجب أن تكون بين 0 و ${exam.fullMark}`);
       return;
-    const nextScore =
-      nextStatus === "درجة"
-        ? Number(prompt("الدرجة", String(grade.score ?? 0)) || 0)
-        : null;
-    const notes = prompt("الملاحظات", grade.notes) ?? grade.notes;
-    updateGrade(gradeId, { status: nextStatus, score: nextScore, notes });
-    toast.success("تم تعديل السجل");
+    }
+    updateGrade(editDialog.id, {
+      status: editDialog.status,
+      score,
+      notes: editDialog.notes,
+      accountingChecked: editDialog.accountingChecked,
+    });
+    setEditDialog({ open: false, id: "", status: "درجة", score: "", notes: "", accountingChecked: false });
+    toast.success("تم تعديل الدرجة وإعادة الاحتساب");
   };
 
   const openDeleteGradeDialog = (gradeId: string) => {
-    const grade = grades.find((g) => g.id === gradeId);
-    const student = grade
-      ? students.find((s) => s.id === grade.studentId)
-      : null;
-    const exam = grade ? exams.find((e) => e.id === grade.examId) : null;
-    setDeleteDialog({
-      open: true,
-      id: gradeId,
-      label: [student?.name, exam?.name].filter(Boolean).join(" - "),
-    });
+    const grade = grades.find((item) => item.id === gradeId);
+    const student = grade ? students.find((item) => item.id === grade.studentId) : null;
+    const exam = grade ? exams.find((item) => item.id === grade.examId) : null;
+    setDeleteDialog({ open: true, id: gradeId, label: [student?.name, exam?.name].filter(Boolean).join(" - ") });
   };
 
   const handleDeleteGrade = runDeleteGradeLocked(async () => {
@@ -124,33 +131,13 @@
   });
 
   const exportCSV = () => {
-    const headers = [
-      "الطالب",
-      "الكود",
-      "التليكرام",
-      "الامتحان",
-      "الحالة",
-      "الدرجة",
-      "التصنيف",
-      "محاسبة",
-      "ملاحظات",
-    ];
-    const rows = filtered.map((g) => {
-      const student = students.find((s) => s.id === g.studentId);
-      const exam = exams.find((e) => e.id === g.examId);
-      const cls = classification(g, exam!);
-      return [
-        student?.name || "",
-        student?.code || "",
-        student?.telegram || "",
-        exam?.name || "",
-        g.status,
-        g.score?.toString() || "",
-        cls.text,
-        g.accountingChecked ? "نعم" : "لا",
-        g.notes,
-      ]
-        .map((v) => `"${v}"`)
+    const headers = ["الطالب", "الكود", "التليكرام", "الامتحان", "الحالة", "الدرجة", "التصنيف", "محاسبة", "ملاحظات"];
+    const rows = filtered.map((grade) => {
+      const student = students.find((item) => item.id === grade.studentId);
+      const exam = exams.find((item) => item.id === grade.examId);
+      const cls = exam ? classification(grade, exam) : { text: "" };
+      return [student?.name || "", student?.code || "", student?.telegram || "", exam?.name || "", grade.status, grade.score?.toString() || "", cls.text, grade.accountingChecked ? "نعم" : "لا", grade.notes || ""]
+        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
         .join(",");
     });
     const csv = "\ufeff" + [headers.join(","), ...rows].join("\n");
@@ -166,274 +153,118 @@
 
   return (
     <div className="space-y-4">
-      {/* Filters */}
       <Card>
         <CardContent className="p-4">
           <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
             <div className="space-y-1">
-              <Label htmlFor="grade-records-search" className="text-xs">
-                بحث
-              </Label>
-              <Input
-                id="grade-records-search"
-                name="search"
-                autoComplete="off"
-                value={search}
-                onChange={(e) => {
-                  setSearch(e.target.value);
-                  setPage(1);
-                }}
-                placeholder="اسم / كود / تليكرام"
-              />
+              <Label htmlFor="grade-records-search" className="text-xs">بحث</Label>
+              <Input id="grade-records-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="اسم / كود / تليكرام / امتحان" />
             </div>
             <div className="space-y-1">
-              <Label htmlFor="grade-records-exam" className="text-xs">
-                الامتحان
-              </Label>
-              <Select
-                name="examId"
-                value={filterExamId}
-                onValueChange={(v) => {
-                  setFilterExamId(v === "all" ? "" : v);
-                  setPage(1);
-                }}
-              >
-                <SelectTrigger id="grade-records-exam">
-                  <SelectValue placeholder="الكل" />
-                </SelectTrigger>
-                <SelectContent>
-                  <SelectItem value="all">الكل</SelectItem>
-                  {exams.map((e) => (
-                    <SelectItem key={e.id} value={e.id}>
-                      {e.name}
-                    </SelectItem>
-                  ))}
-                </SelectContent>
+              <Label htmlFor="grade-records-exam" className="text-xs">الامتحان</Label>
+              <Select value={filterExamId || "all"} onValueChange={(v) => { setFilterExamId(v === "all" ? "" : v); setPage(1); }}>
+                <SelectTrigger id="grade-records-exam"><SelectValue placeholder="الكل" /></SelectTrigger>
+                <SelectContent><SelectItem value="all">الكل</SelectItem>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.name}</SelectItem>)}</SelectContent>
               </Select>
             </div>
             <div className="space-y-1">
-              <Label htmlFor="grade-records-status" className="text-xs">
-                الحالة
-              </Label>
-              <Select
-                name="status"
-                value={filterStatus}
-                onValueChange={(v) => {
-                  setFilterStatus(v === "all" ? "" : v);
-                  setPage(1);
-                }}
-              >
-                <SelectTrigger id="grade-records-status">
-                  <SelectValue placeholder="الكل" />
-                </SelectTrigger>
-                <SelectContent>
-                  <SelectItem value="all">الكل</SelectItem>
-                  <SelectItem value="درجة">درجة</SelectItem>
-                  <SelectItem value="غائب">غائب</SelectItem>
-                  <SelectItem value="مجاز">مجاز</SelectItem>
-                  <SelectItem value="غش">غش</SelectItem>
-                </SelectContent>
+              <Label htmlFor="grade-records-status" className="text-xs">الحالة</Label>
+              <Select value={filterStatus || "all"} onValueChange={(v) => { setFilterStatus(v === "all" ? "" : v); setPage(1); }}>
+                <SelectTrigger id="grade-records-status"><SelectValue placeholder="الكل" /></SelectTrigger>
+                <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="درجة">درجة</SelectItem><SelectItem value="غائب">غائب</SelectItem><SelectItem value="مجاز">مجاز</SelectItem><SelectItem value="غش">غش</SelectItem></SelectContent>
               </Select>
             </div>
             <div className="space-y-1">
-              <Label htmlFor="grade-records-course" className="text-xs">
-                الدورة
-              </Label>
-              <Select
-                name="courseId"
-                value={filterCourseId}
-                onValueChange={(v) => {
-                  setFilterCourseId(v === "all" ? "" : v);
-                  setPage(1);
-                }}
-              >
-                <SelectTrigger id="grade-records-course">
-                  <SelectValue placeholder="الكل" />
-                </SelectTrigger>
-                <SelectContent>
-                  <SelectItem value="all">الكل</SelectItem>
-                  {courses.map((c) => (
-                    <SelectItem key={c.id} value={c.id}>
-                      {c.name}
-                    </SelectItem>
-                  ))}
-                </SelectContent>
+              <Label htmlFor="grade-records-course" className="text-xs">الدورة</Label>
+              <Select value={filterCourseId || "all"} onValueChange={(v) => { setFilterCourseId(v === "all" ? "" : v); setPage(1); }}>
+                <SelectTrigger id="grade-records-course"><SelectValue placeholder="الكل" /></SelectTrigger>
+                <SelectContent><SelectItem value="all">الكل</SelectItem>{courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}</SelectContent>
               </Select>
             </div>
             <div className="flex items-center gap-2 pt-5">
-              <Checkbox
-                id="grade-records-accounting"
-                name="accounting"
-                checked={accountingChecked}
-                onCheckedChange={(v) => {
-                  setAccountingChecked(!!v);
-                  setPage(1);
-                }}
-              />
-              <Label htmlFor="grade-records-accounting" className="text-xs">
-                محاسبة فقط
-              </Label>
-            </div>
-            <div className="space-y-1">
-              <span className="text-xs font-medium">تصدير</span>
-              <Button
-                variant="outline"
-                size="sm"
-                className="w-full h-9"
-                onClick={exportCSV}
-              >
-                تصدير CSV
-              </Button>
+              <Checkbox id="grade-records-accounting" checked={accountingChecked} onCheckedChange={(value) => { setAccountingChecked(!!value); setPage(1); }} />
+              <Label htmlFor="grade-records-accounting" className="text-xs">محاسبة فقط</Label>
             </div>
+            <div className="space-y-1"><span className="text-xs font-medium">تصدير</span><Button variant="outline" size="sm" className="h-9 w-full" onClick={exportCSV}>تصدير CSV</Button></div>
           </div>
         </CardContent>
       </Card>
 
-      {/* Count */}
       <div className="flex items-center justify-between text-sm text-muted-foreground">
-        <span>
-          عرض {paged.length} من {filtered.length} سجل
-        </span>
+        <span>عرض {paged.length} من {filtered.length} سجل</span>
         <div className="flex items-center gap-2">
-          <Label htmlFor="grade-records-pageSize" className="text-xs">
-            حجم الصفحة:
-          </Label>
-          <Select
-            name="pageSize"
-            value={String(pageSize)}
-            onValueChange={(v) => {
-              setPageSize(Number(v));
-              setPage(1);
-            }}
-          >
-            <SelectTrigger id="grade-records-pageSize" className="w-20 h-8">
-              <SelectValue />
-            </SelectTrigger>
-            <SelectContent>
-              <SelectItem value="10">10</SelectItem>
-              <SelectItem value="50">50</SelectItem>
-              <SelectItem value="100">100</SelectItem>
-            </SelectContent>
+          <Label htmlFor="grade-records-pageSize" className="text-xs">حجم الصفحة:</Label>
+          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
+            <SelectTrigger id="grade-records-pageSize" className="h-8 w-20"><SelectValue /></SelectTrigger>
+            <SelectContent><SelectItem value="10">10</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent>
           </Select>
         </div>
       </div>
 
-      {/* Grade Cards */}
       <div className="space-y-2">
-        {paged.map((g) => {
-          const student = students.find((s) => s.id === g.studentId);
-          const exam = exams.find((e) => e.id === g.examId);
+        {paged.map((grade) => {
+          const student = students.find((item) => item.id === grade.studentId);
+          const exam = exams.find((item) => item.id === grade.examId);
           if (!student || !exam) return null;
-          const cls = classification(g, exam);
-
+          const cls = classification(grade, exam);
           return (
-            <div
-              key={g.id}
-              className="flex items-center justify-between gap-3 p-3 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
-            >
-              <div className="flex-1 min-w-0">
-                <div className="flex items-center gap-2">
-                  <p className="font-medium text-sm truncate">{student.name}</p>
-                  <Badge variant="outline" className="text-[10px]">
-                    {student.code}
-                  </Badge>
-                </div>
-                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
-                  <span>{student.telegram}</span>
-                  <span>•</span>
-                  <span>{exam.name}</span>
-                  <span>•</span>
-                  <span>{g.createdAt}</span>
-                </div>
+            <div key={grade.id} className="flex items-center justify-between gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
+              <div className="min-w-0 flex-1">
+                <div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{student.name}</p><Badge variant="outline" className="text-[10px]">{student.code}</Badge></div>
+                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span>{student.telegram}</span><span>•</span><span>{exam.name}</span><span>•</span><span>{grade.createdAt}</span></div>
               </div>
               <div className="flex items-center gap-2">
-                {g.score !== null && (
-                  <span className="font-bold">
-                    {g.score}/{exam.fullMark}
-                  </span>
-                )}
-                <Badge
-                  variant={
-                    cls.type === "ok"
-                      ? "default"
-                      : cls.type === "danger"
-                        ? "destructive"
-                        : cls.type === "warn"
-                          ? "secondary"
-                          : "outline"
-                  }
-                >
-                  {cls.text}
-                </Badge>
-                {g.accountingChecked && <Badge variant="outline">محاسبة</Badge>}
-                <Button
-                  variant="secondary"
-                  size="sm"
-                  onClick={() => handleEditGrade(g.id)}
-                >
-                  تعديل
-                </Button>
-                <Button
-                  variant="destructive"
-                  size="sm"
-                  onClick={() => openDeleteGradeDialog(g.id)}
-                >
-                  حذف
-                </Button>
+                {grade.score !== null && <span className="font-bold">{grade.score}/{exam.fullMark}</span>}
+                <Badge variant={cls.type === "ok" ? "default" : cls.type === "danger" ? "destructive" : cls.type === "warn" ? "secondary" : "outline"}>{cls.text}</Badge>
+                {grade.accountingChecked && <Badge variant="outline">محاسبة</Badge>}
+                <Button variant="secondary" size="sm" onClick={() => openEditGradeDialog(grade.id)}>تعديل</Button>
+                <Button variant="destructive" size="sm" onClick={() => openDeleteGradeDialog(grade.id)}>حذف</Button>
               </div>
             </div>
           );
         })}
       </div>
 
-      {/* Pagination */}
       {totalPages > 1 && (
         <div className="flex items-center justify-center gap-2">
-          <Button
-            variant="outline"
-            size="sm"
-            disabled={page <= 1}
-            onClick={() => setPage((p) => p - 1)}
-          >
-            السابق
-          </Button>
-          <span className="text-sm text-muted-foreground">
-            {page} / {totalPages}
-          </span>
-          <Button
-            variant="outline"
-            size="sm"
-            disabled={page >= totalPages}
-            onClick={() => setPage((p) => p + 1)}
-          >
-            التالي
-          </Button>
+          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>السابق</Button>
+          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
+          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>التالي</Button>
         </div>
       )}
 
-      <AlertDialog
-        open={deleteDialog.open}
-        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
-      >
+      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}>
+        <DialogContent dir="rtl">
+          <DialogHeader><DialogTitle>تعديل درجة الطالب</DialogTitle></DialogHeader>
+          <div className="grid gap-3 sm:grid-cols-2">
+            <div className="space-y-1">
+              <Label>الحالة</Label>
+              <Select value={editDialog.status} onValueChange={(value) => setEditDialog((prev) => ({ ...prev, status: value as GradeStatus }))}>
+                <SelectTrigger><SelectValue /></SelectTrigger>
+                <SelectContent><SelectItem value="درجة">درجة</SelectItem><SelectItem value="غائب">غائب</SelectItem><SelectItem value="مجاز">مجاز</SelectItem><SelectItem value="غش">غش</SelectItem></SelectContent>
+              </Select>
+            </div>
+            <div className="space-y-1">
+              <Label>الدرجة</Label>
+              <Input type="number" disabled={editDialog.status !== "درجة"} value={editDialog.score} onChange={(e) => setEditDialog((prev) => ({ ...prev, score: toLatinDigits(e.target.value) }))} />
+            </div>
+            <div className="space-y-1 sm:col-span-2">
+              <Label>الملاحظات</Label>
+              <Input value={editDialog.notes} onChange={(e) => setEditDialog((prev) => ({ ...prev, notes: e.target.value }))} placeholder="سبب الإجازة أو ملاحظة التصحيح" />
+            </div>
+            <label className="flex items-center gap-2 text-sm sm:col-span-2">
+              <Checkbox checked={editDialog.accountingChecked} onCheckedChange={(value) => setEditDialog((prev) => ({ ...prev, accountingChecked: Boolean(value) }))} />
+              تم تدقيقه من المحاسبة
+            </label>
+          </div>
+          <DialogFooter><Button variant="ghost" onClick={() => setEditDialog({ open: false, id: "", status: "درجة", score: "", notes: "", accountingChecked: false })}>إلغاء</Button><Button onClick={handleSaveEditGrade}>حفظ التعديل</Button></DialogFooter>
+        </DialogContent>
+      </Dialog>
+
+      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}>
         <AlertDialogContent dir="rtl">
-          <AlertDialogHeader>
-            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
-            <AlertDialogDescription>
-              هل أنت متأكد من حذف سجل الدرجة
-              {deleteDialog.label ? ` (${deleteDialog.label})` : ""}؟ لا يمكن
-              التراجع عن هذه العملية.
-            </AlertDialogDescription>
-          </AlertDialogHeader>
-          <AlertDialogFooter>
-            <AlertDialogCancel>إلغاء</AlertDialogCancel>
-            <AlertDialogAction
-              onClick={handleDeleteGrade}
-              disabled={isDeletingGrade}
-              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
-            >
-              {isDeletingGrade ? "جاري الحذف..." : "حذف"}
-            </AlertDialogAction>
-          </AlertDialogFooter>
+          <AlertDialogHeader><AlertDialogTitle>تأكيد الحذف</AlertDialogTitle><AlertDialogDescription>هل أنت متأكد من حذف سجل الدرجة{deleteDialog.label ? ` (${deleteDialog.label})` : ""}؟ لا يمكن التراجع عن هذه العملية.</AlertDialogDescription></AlertDialogHeader>
+          <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={handleDeleteGrade} disabled={isDeletingGrade} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isDeletingGrade ? "جاري الحذف..." : "حذف"}</AlertDialogAction></AlertDialogFooter>
         </AlertDialogContent>
       </AlertDialog>
     </div>
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/components/teacher-pro/layout.tsx /mnt/data/work/TeacherPro-main/src/components/teacher-pro/layout.tsx
--- /mnt/data/original/TeacherPro-main/src/components/teacher-pro/layout.tsx	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/components/teacher-pro/layout.tsx	2026-05-28 14:05:48.946761988 +0000
@@ -29,8 +29,12 @@
   LogOut,
   Copy,
   ChevronDown,
+  WalletCards,
+  KeyRound,
 } from "lucide-react";
 import { Button } from "@/components/ui/button";
+import { Input } from "@/components/ui/input";
+import { Label } from "@/components/ui/label";
 import {
   AlertDialog,
   AlertDialogAction,
@@ -83,6 +87,12 @@
     sub: "بطاقات",
     icon: ClipboardList,
   },
+  {
+    id: "accounting",
+    title: "الأقساط والمحاسبة",
+    sub: "متابعة",
+    icon: WalletCards,
+  },
   { id: "exam-new", title: "إضافة الامتحان", sub: "القواعد", icon: FileText },
   { id: "grade-entry", title: "تسجيل الدرجات", sub: "إدخال", icon: PenTool },
   { id: "exam-records", title: "سجل الامتحانات", sub: "PDF", icon: FileCheck },
@@ -102,7 +112,7 @@
 const menuFamilies: { title: string; itemIds: SectionId[] }[] = [
   { title: "الدورات", itemIds: ["course-new", "group-new", "site-management"] },
   { title: "الفرص", itemIds: ["chapters", "opportunities"] },
-  { title: "الطلاب", itemIds: ["student-register", "student-registry"] },
+  { title: "الطلاب", itemIds: ["student-register", "student-registry", "accounting"] },
   {
     title: "الامتحانات والدرجات",
     itemIds: ["exam-new", "grade-entry", "exam-records", "grade-records"],
@@ -140,6 +150,7 @@
 import { GradeEntryView } from "./grade-entry";
 import { ExamRecordsView } from "./exam-records";
 import { GradeRecordsView } from "./grade-records";
+import { AccountingView } from "./accounting";
 import { OpportunitiesView } from "./opportunities";
 import { ECorrectionView } from "./e-correction";
 import { WhatsAppView } from "./whatsapp";
@@ -156,6 +167,7 @@
   chapters: ChaptersView,
   "student-register": StudentRegisterView,
   "student-registry": StudentRegistryView,
+  accounting: AccountingView,
   "exam-new": ExamNewView,
   "grade-entry": GradeEntryView,
   "exam-records": ExamRecordsView,
@@ -182,6 +194,81 @@
   URL.revokeObjectURL(url);
 }
 
+type LoginScreenProps = {
+  theme: string;
+  toggleTheme: () => void;
+  login: (username: string, password: string) => { ok: boolean; message: string };
+};
+
+function LoginScreen({ theme, toggleTheme, login }: LoginScreenProps) {
+  const [username, setUsername] = useState("admin");
+  const [password, setPassword] = useState("1993");
+  const [loading, setLoading] = useState(false);
+
+  const handleSubmit = (event: React.FormEvent) => {
+    event.preventDefault();
+    setLoading(true);
+    const result = login(username, password);
+    setLoading(false);
+    if (result.ok) toast.success(result.message);
+    else toast.error(result.message);
+  };
+
+  return (
+    <div className="app-bg min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
+      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,rgba(147,51,234,0.18),transparent_32rem)]" />
+      <div className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl">
+        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary via-fuchsia-500 to-indigo-500" />
+        <div className="p-7 space-y-6">
+          <div className="flex items-center justify-between gap-3">
+            <div>
+              <h1 className="text-3xl font-extrabold text-gradient-brand">TeacherPro</h1>
+              <p className="mt-1 text-sm text-muted-foreground">تسجيل دخول مدير النظام</p>
+            </div>
+            <Button variant="outline" size="icon" className="rounded-full" onClick={toggleTheme} type="button">
+              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
+            </Button>
+          </div>
+
+          <form onSubmit={handleSubmit} className="space-y-4">
+            <div className="space-y-2">
+              <Label htmlFor="login-username">اسم المستخدم</Label>
+              <Input
+                id="login-username"
+                autoComplete="username"
+                value={username}
+                onChange={(event) => setUsername(event.target.value)}
+                placeholder="admin"
+                className="h-12 rounded-2xl"
+              />
+            </div>
+            <div className="space-y-2">
+              <Label htmlFor="login-password">الرمز</Label>
+              <Input
+                id="login-password"
+                type="password"
+                autoComplete="current-password"
+                value={password}
+                onChange={(event) => setPassword(event.target.value)}
+                placeholder="1993"
+                className="h-12 rounded-2xl"
+              />
+            </div>
+            <Button type="submit" className="h-12 w-full rounded-2xl text-base font-bold" disabled={loading}>
+              <KeyRound className="ml-2 h-4 w-4" />
+              {loading ? "جاري الدخول..." : "دخول للنظام"}
+            </Button>
+          </form>
+
+          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
+            الحساب الافتراضي: <b>admin</b> — الرمز: <b>1993</b>. يمكن لاحقاً إدارة الحسابات والصلاحيات من داخل النظام.
+          </div>
+        </div>
+      </div>
+    </div>
+  );
+}
+
 export function TeacherProLayout() {
   const {
     currentSection,
@@ -196,6 +283,8 @@
     exportMonthlyReport,
     currentUser,
     canAccess,
+    isAuthenticated,
+    login,
     logout,
     activeDemoId,
     isDemoActive,
@@ -364,6 +453,10 @@
     if (fileInputRef.current) fileInputRef.current.value = "";
   };
 
+  if (!isAuthenticated && !activeDemoId) {
+    return <LoginScreen theme={theme} toggleTheme={toggleTheme} login={login} />;
+  }
+
   return (
     <div className="app-bg min-h-screen flex bg-background" dir="rtl">
       {sidebarOpen && (
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/components/teacher-pro/student-registry.tsx /mnt/data/work/TeacherPro-main/src/components/teacher-pro/student-registry.tsx
--- /mnt/data/original/TeacherPro-main/src/components/teacher-pro/student-registry.tsx	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/components/teacher-pro/student-registry.tsx	2026-05-28 14:06:44.335245354 +0000
@@ -172,6 +172,7 @@
     setSection,
     courseName,
     groupName,
+    activeChapterForCourse,
   } = useTeacherStore();
 
   const [search, setSearch] = useState("");
@@ -825,9 +826,15 @@
                 </div>
                 <div>
                   <span className="text-muted-foreground text-xs">الفرص</span>
-                  <p className="font-medium text-xs">
-                    {student.opportunities} / {student.baseOpportunities}
-                  </p>
+                  {activeChapterForCourse(student.courseId) ? (
+                    <p className="font-medium text-xs">
+                      {student.opportunities} / {student.baseOpportunities}
+                    </p>
+                  ) : (
+                    <p className="font-semibold text-xs text-destructive">
+                      0 / 0 - لم يتم اختيار الفصل لهم بعد
+                    </p>
+                  )}
                 </div>
                 <div>
                   <span className="text-muted-foreground text-xs">تليكرام</span>
@@ -1497,8 +1504,14 @@
                 <div>
                   <span className="text-muted-foreground">الفرص:</span>{" "}
                   <strong>
-                    {fileDialog.student.opportunities} /{" "}
-                    {fileDialog.student.baseOpportunities}
+                    {activeChapterForCourse(fileDialog.student.courseId) ? (
+                      <>
+                        {fileDialog.student.opportunities} /{" "}
+                        {fileDialog.student.baseOpportunities}
+                      </>
+                    ) : (
+                      "0 / 0 - لم يتم اختيار الفصل لهم بعد"
+                    )}
                   </strong>
                 </div>
                 <div>
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/lib/exam-utils.ts /mnt/data/work/TeacherPro-main/src/lib/exam-utils.ts
--- /mnt/data/original/TeacherPro-main/src/lib/exam-utils.ts	1970-01-01 00:00:00.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/lib/exam-utils.ts	2026-05-28 13:58:03.093382382 +0000
@@ -0,0 +1,57 @@
+export type ExamLike = {
+  active: boolean;
+  scheduledActivateAt?: string | null;
+  scheduledDeactivateAt?: string | null;
+};
+
+export type ExamStatusLabel = 'نشط' | 'تفعيل مجدول' | 'تعطيل مجدول' | 'معطل';
+
+export function splitSelection(value?: string | null): string[] {
+  return String(value || '')
+    .split(',')
+    .map((item) => item.trim())
+    .filter(Boolean);
+}
+
+function hasFutureDate(value?: string | null, now = new Date()): boolean {
+  if (!value) return false;
+  const date = new Date(value);
+  return Number.isFinite(date.getTime()) && date > now;
+}
+
+export function getExamStatus(exam: ExamLike, now = new Date()): ExamStatusLabel {
+  if (!exam.active && hasFutureDate(exam.scheduledActivateAt, now)) return 'تفعيل مجدول';
+  if (exam.active && hasFutureDate(exam.scheduledDeactivateAt, now)) return 'تعطيل مجدول';
+  return exam.active ? 'نشط' : 'معطل';
+}
+
+export function isExamAvailableForEntry(exam: ExamLike, now = new Date()): boolean {
+  const status = getExamStatus(exam, now);
+  return status === 'نشط' || status === 'تعطيل مجدول';
+}
+
+export function hasActiveChapterLink(
+  courseChapters: Array<{ courseId: string; active: boolean; archived: boolean }>,
+  courseId: string,
+): boolean {
+  return courseChapters.some((link) => link.courseId === courseId && link.active && !link.archived);
+}
+
+export function escapeHtml(value: unknown): string {
+  return String(value ?? '')
+    .replaceAll('&', '&amp;')
+    .replaceAll('<', '&lt;')
+    .replaceAll('>', '&gt;')
+    .replaceAll('"', '&quot;')
+    .replaceAll("'", '&#039;');
+}
+
+export function downloadTextFile(content: string, filename: string, type: string) {
+  const blob = new Blob([content], { type });
+  const url = URL.createObjectURL(blob);
+  const a = document.createElement('a');
+  a.href = url;
+  a.download = filename;
+  a.click();
+  URL.revokeObjectURL(url);
+}
diff -ruN '--exclude=*.tsbuildinfo' /mnt/data/original/TeacherPro-main/src/lib/teacher-store.ts /mnt/data/work/TeacherPro-main/src/lib/teacher-store.ts
--- /mnt/data/original/TeacherPro-main/src/lib/teacher-store.ts	2026-05-28 13:33:59.000000000 +0000
+++ /mnt/data/work/TeacherPro-main/src/lib/teacher-store.ts	2026-05-28 14:11:39.656509711 +0000
@@ -105,6 +105,8 @@
   opportunitiesPenalty: number | 'فصل مؤقت';
   dismissalGrade: number | null;
   active: boolean;
+  scheduledActivateAt?: string;
+  scheduledDeactivateAt?: string;
   attendanceClosed: boolean;
   attendance: string[];
 }
@@ -278,6 +280,7 @@
   | 'chapters'
   | 'student-register'
   | 'student-registry'
+  | 'accounting'
   | 'exam-new'
   | 'grade-entry'
   | 'exam-records'
@@ -328,6 +331,8 @@
   { id: 'students.add', label: 'تسجيل طالب', category: 'الطلاب', level: 'write', description: 'تسجيل طالب جديد' },
   { id: 'students.edit', label: 'تعديل بيانات طالب', category: 'الطلاب', level: 'write', description: 'تعديل بيانات طالب' },
   { id: 'students.delete', label: 'حذف طالب', category: 'الطلاب', level: 'delete', description: 'حذف طالب من النظام' },
+  { id: 'accounting.view', label: 'عرض الأقساط والمحاسبة', category: 'الطلاب', level: 'read', description: 'عرض تفاصيل الأقساط والمحاسبة للدورات الخاصة' },
+  { id: 'accounting.manage', label: 'إدارة الأقساط والمحاسبة', category: 'الطلاب', level: 'manage', description: 'تسجيل دفعات الأقساط ومتابعة المتبقي' },
   // الامتحانات
   { id: 'exams.view', label: 'عرض الامتحانات', category: 'الامتحانات', level: 'read', description: 'عرض قائمة الامتحانات' },
   { id: 'exams.add', label: 'إضافة امتحان', category: 'الامتحانات', level: 'write', description: 'إنشاء امتحان جديد' },
@@ -367,6 +372,7 @@
   'chapters': 'chapters.view',
   'student-register': 'students.add',
   'student-registry': 'students.view',
+  'accounting': 'accounting.view',
   'exam-new': 'exams.add',
   'grade-entry': 'grades.add',
   'exam-records': 'exams.view',
@@ -477,6 +483,7 @@
   studentPageSize: number;
   gradePageSize: number;
   currentUserId: string;
+  isAuthenticated: boolean;
 
   loadFromServer: () => Promise<boolean>;
 
@@ -486,6 +493,7 @@
   toggleTheme: () => void;
 
   currentUser: () => User | null;
+  login: (username: string, password: string) => { ok: boolean; message: string };
   canAccess: (section: SectionId | string) => boolean;
   logout: () => void;
 
@@ -535,6 +543,7 @@
   addGrade: (grade: Omit<Grade, 'id' | 'createdAt' | 'updatedAt'>) => void;
   updateGrade: (id: string, updates: Partial<Grade>) => void;
   deleteGrade: (id: string) => boolean;
+  recalculateAcademicEffects: () => void;
 
   adjustOpportunities: (studentId: string, amount: number, reason: string) => void;
   resetOpportunities: (studentId: string) => void;
@@ -623,7 +632,7 @@
   const roles: Role[] = DEFAULT_ROLES.map(r => ({ ...r, permissions: [...r.permissions] }));
 
   const users: User[] = [
-    { id: 'u_admin', username: 'admin', name: 'مدير النظام', roleId: 'role_admin', role: 'مدير عام', permissions: [...ALL_PERMISSION_IDS], active: true, password: 'admin123' },
+    { id: 'u_admin', username: 'admin', name: 'مدير النظام', roleId: 'role_admin', role: 'مدير عام', permissions: [...ALL_PERMISSION_IDS], active: true, password: '1993' },
   ];
 
   return {
@@ -748,6 +757,103 @@
   ];
 }
 
+
+function isRuleManagedDismissal(student: Student): boolean {
+  const reason = student.dismissalReason || '';
+  return [
+    'غياب امتحان',
+    'أول حالة غش',
+    'غش متكرر',
+    'درجة فصل',
+    'درجة صفر',
+    'انتهاء الفرص',
+  ].some((part) => reason.includes(part));
+}
+
+function examPenaltyValue(exam: Exam): number {
+  return typeof exam.opportunitiesPenalty === 'number'
+    ? exam.opportunitiesPenalty
+    : Number(exam.opportunitiesPenalty) || 1;
+}
+
+function recalculateStudentsFromAcademicRules(state: Pick<TeacherState, 'students' | 'grades' | 'exams'>): Student[] {
+  const examsById = new Map(state.exams.map((exam) => [exam.id, exam]));
+  return state.students.map((student) => {
+    const manualDismissal = student.status === 'مفصول' && !isRuleManagedDismissal(student);
+    if (manualDismissal) return student;
+
+    let opportunities = Number(student.baseOpportunities || 0);
+    let dismissalType = '';
+    let dismissalReason = '';
+    let dismissalPriority = -1;
+    let cheatCount = 0;
+
+    const studentGrades = state.grades
+      .filter((grade) => grade.studentId === student.id)
+      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
+
+    const setDismissal = (type: string, reason: string, priority: number) => {
+      if (priority >= dismissalPriority) {
+        dismissalType = type;
+        dismissalReason = reason;
+        dismissalPriority = priority;
+      }
+    };
+
+    for (const grade of studentGrades) {
+      const exam = examsById.get(grade.examId);
+      if (!exam) continue;
+      if (grade.status === 'مجاز') continue;
+
+      if (grade.status === 'غش') {
+        cheatCount += 1;
+        if (cheatCount === 1) {
+          opportunities = 0;
+          setDismissal('فصل مؤقت', `أول حالة غش في امتحان: ${exam.name}`, 80);
+        } else {
+          setDismissal('فصل نهائي', `غش متكرر في امتحان: ${exam.name}`, 100);
+        }
+        continue;
+      }
+
+      if (grade.status === 'غائب') {
+        if (exam.type === 'تراكمي' || exam.type === 'فاينل') {
+          setDismissal('فصل مؤقت', `غياب امتحان ${exam.type}: ${exam.name}`, 70);
+        } else {
+          opportunities -= examPenaltyValue(exam);
+        }
+        continue;
+      }
+
+      if (grade.status === 'درجة' && grade.score !== null) {
+        const score = Number(grade.score);
+        if (score <= exam.discountMark) {
+          opportunities -= examPenaltyValue(exam);
+          if ((exam.type === 'تراكمي' || exam.type === 'فاينل') && exam.dismissalGrade !== null && score <= exam.dismissalGrade) {
+            setDismissal('فصل مؤقت', `درجة فصل (${score}): ${exam.name}`, 75);
+          }
+        }
+        if (score === 0 && (exam.type === 'تراكمي' || exam.type === 'فاينل')) {
+          setDismissal('فصل مؤقت', `درجة صفر في امتحان ${exam.type}: ${exam.name}`, 76);
+        }
+      }
+    }
+
+    opportunities = Math.max(0, opportunities);
+    if (opportunities === 0 && Number(student.baseOpportunities || 0) > 0 && !dismissalType) {
+      setDismissal('فصل مؤقت', 'انتهاء الفرص', 60);
+    }
+
+    return {
+      ...student,
+      opportunities,
+      status: dismissalType ? 'مفصول' : 'نشط',
+      dismissalType,
+      dismissalReason,
+    };
+  });
+}
+
 function syncToServer(getState: () => TeacherState, action: () => unknown): void {
   if (getState().activeDemoId) return;
   void Promise.resolve()
@@ -768,6 +874,7 @@
       studentPageSize: 10,
       gradePageSize: 10,
       currentUserId: 'u_admin',
+      isAuthenticated: false,
       dbConnected: false,
       dbLoading: false,
 
@@ -840,6 +947,8 @@
             opportunitiesPenalty: ex.opportunitiesPenalty === 'فصل مؤقت' ? 'فصل مؤقت' as const : Number(ex.opportunitiesPenalty || 1),
             dismissalGrade: ex.dismissalGrade === null || ex.dismissalGrade === undefined ? null : Number(ex.dismissalGrade),
             active: Boolean(ex.active),
+            scheduledActivateAt: ex.scheduledActivateAt ? String(ex.scheduledActivateAt).slice(0, 10) : '',
+            scheduledDeactivateAt: ex.scheduledDeactivateAt ? String(ex.scheduledDeactivateAt).slice(0, 10) : '',
             attendanceClosed: Boolean(ex.attendanceClosed),
             date: ex.date ? String(ex.date).slice(0, 10) : todayISO(),
           })) as Exam[];
@@ -866,6 +975,7 @@
 
           const parsedUsers = (serverData.users || []).map((u: Record<string, unknown>) => ({
             ...u,
+            password: String(u.password || u.passwordHash || (u.username === 'admin' ? '1993' : '')),
             permissions: parseArrayField<string>(u.permissions),
             active: u.active !== undefined ? Boolean(u.active) : true,
           })) as User[];
@@ -929,7 +1039,19 @@
       }),
 
       currentUser: () => get().users.find((u) => u.id === get().currentUserId && u.active) || null,
+      login: (username, password) => {
+        const normalizedUsername = username.trim();
+        const user = get().users.find((u) => u.username === normalizedUsername && u.active);
+        const expectedPassword = user?.password || (normalizedUsername === 'admin' ? '1993' : '');
+        if (!user || expectedPassword !== password) {
+          return { ok: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
+        }
+        set({ currentUserId: user.id, isAuthenticated: true, currentSection: 'dashboard' });
+        get().logAction('تسجيل الدخول', 'دخول للنظام', user.name);
+        return { ok: true, message: 'تم تسجيل الدخول بنجاح' };
+      },
       canAccess: (section) => {
+        if (!get().isAuthenticated && !get().activeDemoId) return false;
         const user = get().currentUser();
         if (!user) return false;
         // Admin role always has access
@@ -951,8 +1073,8 @@
           return;
         }
         const admin = get().users.find((u) => u.roleId === 'role_admin' && u.active);
-        set({ currentUserId: admin?.id || 'u_admin', currentSection: 'dashboard' });
-        get().logAction('تسجيل الدخول', 'تسجيل خروج', 'رجوع إلى مدير النظام المحلي');
+        set({ currentUserId: admin?.id || 'u_admin', currentSection: 'dashboard', isAuthenticated: false });
+        get().logAction('تسجيل الدخول', 'تسجيل خروج', 'إغلاق جلسة المستخدم');
       },
 
       courseName: (id) => get().courses.find((c) => c.id === id)?.name || 'غير محدد',
@@ -1269,6 +1391,7 @@
         set((s) => ({ exams: s.exams.map((e) => e.id === id ? { ...e, ...updates } : e) }));
         get().logAction('الامتحانات', 'تعديل امتحان', get().exams.find((e) => e.id === id)?.name || id);
         syncToServer(get, () => examApi.update(id, updates as Record<string, unknown>));
+        get().recalculateAcademicEffects();
       },
       toggleExam: (id) => {
         const exam = get().exams.find((e) => e.id === id);
@@ -1311,53 +1434,25 @@
       addGrade: (gradeData) => {
         const stateBefore = get();
         const existing = stateBefore.grades.find((g) => g.studentId === gradeData.studentId && g.examId === gradeData.examId);
-        const oldSame = existing && existing.status === gradeData.status && existing.score === gradeData.score;
         const grade: Grade = existing
-          ? { ...existing, ...gradeData, updatedAt: todayISO() }
+          ? {
+              ...existing,
+              ...gradeData,
+              accountingChecked: gradeData.accountingChecked ?? existing.accountingChecked,
+              updatedAt: todayISO(),
+            }
           : { ...gradeData, id: uid('gr'), createdAt: todayISO(), updatedAt: todayISO() };
 
         set((s) => ({ grades: existing ? s.grades.map((g) => g.id === existing.id ? grade : g) : [...s.grades, grade] }));
         get().logAction('الدرجات', existing ? 'تعديل درجة' : 'إدخال درجة', `${get().studentName(grade.studentId)} - ${stateBefore.exams.find((e) => e.id === grade.examId)?.name || ''}`);
-        // Sync grade to DB
         syncToServer(get, () => gradeApi.add(grade as unknown as Record<string, unknown>));
-
-        const exam = stateBefore.exams.find((e) => e.id === grade.examId);
-        const student = stateBefore.students.find((s) => s.id === grade.studentId);
-        if (!exam || !student || oldSame) return;
-
-        if (gradeData.status === 'غائب') {
-          if (exam.type === 'تراكمي' || exam.type === 'فاينل') {
-            get().dismissStudent(grade.studentId, 'فصل مؤقت', `غياب امتحان ${exam.type}: ${exam.name}`);
-          } else {
-            const penalty = typeof exam.opportunitiesPenalty === 'number' ? exam.opportunitiesPenalty : 1;
-            get().adjustOpportunities(grade.studentId, -penalty, `غياب امتحان يومي: ${exam.name}`);
-          }
-        } else if (gradeData.status === 'غش') {
-          const previousCheatCount = stateBefore.grades.filter((g) => g.studentId === grade.studentId && g.status === 'غش' && g.id !== existing?.id).length;
-          if (previousCheatCount === 0) {
-            get().dismissStudent(grade.studentId, 'فصل مؤقت', `أول حالة غش في امتحان: ${exam.name}`);
-            get().adjustOpportunities(grade.studentId, -student.opportunities, `غش أول - حجز جميع الفرص: ${exam.name}`);
-          } else {
-            get().dismissStudent(grade.studentId, 'فصل نهائي', `غش متكرر في امتحان: ${exam.name}`);
-          }
-        } else if (gradeData.status === 'درجة' && gradeData.score !== null) {
-          const score = Number(gradeData.score);
-          if (score <= exam.discountMark) {
-            const penalty = typeof exam.opportunitiesPenalty === 'number' ? exam.opportunitiesPenalty : 1;
-            get().adjustOpportunities(grade.studentId, -penalty, `درجة مخصومة (${score}/${exam.fullMark}): ${exam.name}`);
-            if ((exam.type === 'تراكمي' || exam.type === 'فاينل') && exam.dismissalGrade !== null && score <= exam.dismissalGrade) {
-              get().dismissStudent(grade.studentId, 'فصل مؤقت', `درجة فصل (${score}): ${exam.name}`);
-            }
-          }
-          if (score === 0 && (exam.type === 'تراكمي' || exam.type === 'فاينل')) {
-            get().dismissStudent(grade.studentId, 'فصل مؤقت', `درجة صفر في امتحان ${exam.type}: ${exam.name}`);
-          }
-        }
+        get().recalculateAcademicEffects();
       },
       updateGrade: (id, updates) => {
         set((s) => ({ grades: s.grades.map((g) => g.id === id ? { ...g, ...updates, updatedAt: todayISO() } : g) }));
         get().logAction('الدرجات', 'تعديل مباشر للدرجة', id);
         syncToServer(get, () => gradeApi.update(id, updates as Record<string, unknown>));
+        get().recalculateAcademicEffects();
       },
       deleteGrade: (id) => {
         const grade = get().grades.find((g) => g.id === id);
@@ -1365,8 +1460,31 @@
         set((s) => ({ grades: s.grades.filter((g) => g.id !== id) }));
         get().logAction('الدرجات', 'حذف درجة', `${get().studentName(grade.studentId)} - ${get().exams.find((e) => e.id === grade.examId)?.name || ''}`);
         syncToServer(get, () => gradeApi.remove(id));
+        get().recalculateAcademicEffects();
         return true;
       },
+      recalculateAcademicEffects: () => {
+        const before = get().students;
+        const recalculated = recalculateStudentsFromAcademicRules(get());
+        set({ students: recalculated });
+        recalculated.forEach((student) => {
+          const oldStudent = before.find((item) => item.id === student.id);
+          if (!oldStudent) return;
+          if (
+            oldStudent.opportunities !== student.opportunities ||
+            oldStudent.status !== student.status ||
+            oldStudent.dismissalType !== student.dismissalType ||
+            oldStudent.dismissalReason !== student.dismissalReason
+          ) {
+            syncToServer(get, () => studentApi.update(student.id, {
+              opportunities: student.opportunities,
+              status: student.status,
+              dismissalType: student.dismissalType,
+              dismissalReason: student.dismissalReason,
+            }));
+          }
+        });
+      },
       adjustOpportunities: (studentId, amount, reason) => {
         const stateBefore = get();
         const studentBefore = stateBefore.students.find((st) => st.id === studentId);
@@ -1657,7 +1775,7 @@
         if (demo.expiresAt && new Date(demo.expiresAt) < new Date()) return;
         const mainSnapshot = state.mainSnapshotBeforeDemo || snapshotOperationalData(state);
         const demoData = restoreOperationalData(demo.snapshot);
-        set({ ...demoData, mainSnapshotBeforeDemo: mainSnapshot, activeDemoId: id, currentUserId: demo.demoUserId, currentSection: 'dashboard' });
+        set({ ...demoData, mainSnapshotBeforeDemo: mainSnapshot, activeDemoId: id, currentUserId: demo.demoUserId, currentSection: 'dashboard', isAuthenticated: true });
         get().logAction('نسخ الديمو', 'دخول نسخة ديمو', demo.name);
       },
       exitDemoCopy: () => {
@@ -1674,6 +1792,7 @@
           mainSnapshotBeforeDemo: null,
           currentUserId: 'u_admin',
           currentSection: 'dashboard',
+          isAuthenticated: false,
         }));
         syncToServer(get, () => demoCopyApi.update(demo.id, { snapshot: currentSnapshot }));
         get().logAction('نسخ الديمو', 'خروج من نسخة ديمو', demo.name);

```
