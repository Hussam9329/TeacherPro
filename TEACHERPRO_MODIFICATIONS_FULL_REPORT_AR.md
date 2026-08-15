# تقرير تعديلات TeacherPro الكامل

تم تطبيق التعديلات المطلوبة داخل المشروع مباشرة. هذا الملف يجمع التقرير، أماكن الملفات، الأسطر التقريبية بعد التعديل، وأهم الكودات التي تمت إضافتها أو تغييرها.

## طريقة تشغيل النسخة بعد استلامها

1. افتح مجلد المشروع.
2. نفّذ تثبيت الحزم:

```bash
npm install
```

3. لأن حقل `accountingStart` تغير من تاريخ إلى رقم أيام، ولأن اختيار الكروبات في الامتحان أصبح يقبل أكثر من كروب، نفّذ تحديث مخطط Prisma بعد أخذ نسخة احتياطية من قاعدة البيانات:

```bash
npm run db:push
npm run db:generate
```

4. شغّل المشروع:

```bash
npm run dev
```

5. لاختبار الإنتاج:

```bash
npm run build
```

> ملاحظة فحص: تم تشغيل `npx tsc --noEmit` داخل بيئة العمل، لكن المشروع المرفوع لا يحتوي `node_modules`، لذلك ظهرت أخطاء نقص الحزم مثل React وNext. بعد تنفيذ `npm install` في جهازك يمكن تشغيل `npm run build` للتحقق الكامل.

---

## 1) إلغاء عنوان ووصف لوحة التحكم

**الملف:** `src/components/teacher-pro/dashboard.tsx`

**ما تم:** حذف بلوك `PageHero` الذي كان يعرض:

```text
لوحة تحكم TeacherPro
ملخص سريع لحالة الطلاب والتصحيح، بتصميم مريح للعمل اليومي الطويل.
```

**المواضع بعد التعديل:**

- السطر 7: حذف استيراد `LayoutDashboard`.
- السطر 8: حذف `PageHero` من الاستيراد.
- يبدأ المحتوى مباشرة من كارتات الإحصائيات عند السطر 28.

---

## 2) حل مشكلة اختيار نوع دورة خاصة بدون وجود دورات خاصة

**الملف:** `src/components/teacher-pro/student-register.tsx`

**ما تم:**

- فلترة الدورات حسب النوع المختار عند الأسطر 31-34.
- عند عدم وجود دورات لنوع الدورة المختار، تظهر رسالة `لا توجد دورات مسجلة` داخل خانة الدورات.
- عند عدم وجود كروبات، تظهر رسالة واضحة في خانة الكروبات.
- منع التسجيل إذا لم توجد دورة أو كروب صالح.

**الكود الأساسي المضاف:**

```tsx
const filteredCourses = useMemo(
  () => courses.filter(c => c.type === form.courseType && c.active),
  [courses, form.courseType],
);
```

**مواضع الرسائل:**

- الدورات: الأسطر 260-270 تقريباً.
- الكروبات: الأسطر 303-320 تقريباً.

---

## 3) جعل كل تبويبة رابطاً يمكن فتحه بزر الفأرة الأيمن في تبويبة جديدة

**الملف:** `src/components/teacher-pro/layout.tsx`

**ما تم:**

- إضافة رابط مستقل لكل تبويبة بصيغة:

```text
/?section=student-register
/?section=student-registry
/?section=exam-new
```

- تحويل عناصر القائمة من أزرار `button` إلى روابط `a`.
- إضافة قراءة تلقائية للرابط عند فتح الصفحة.
- دعم الرجوع/التقدم من المتصفح `popstate`.

**الكود الأساسي:**

```tsx
function sectionHref(section: SectionId) {
  return `/?section=${encodeURIComponent(section)}`;
}

function readSectionFromLocation(): SectionId | null {
  const querySection = new URLSearchParams(window.location.search).get('section');
  const hashSection = window.location.hash.replace(/^#/, '');
  const value = querySection || hashSection;
  return sectionIds.has(value as SectionId) ? value as SectionId : null;
}
```

**المواضع:**

- الدوال الجديدة: الأسطر 46-56.
- معالج الضغط على الرابط: الأسطر 121-133.
- روابط القائمة: الأسطر 266-282، 314-330، 343-359.

---

## 4) فصل المناطق الفرعية حسب المنطقة الرئيسية

**الملفات:**

- `src/components/teacher-pro/student-register.tsx`
- `src/components/teacher-pro/student-registry.tsx`
- `src/components/teacher-pro/sites.tsx`
- `src/lib/iraq.ts`

**ما تم:**

- لم تعد المناطق الفرعية تُعرض بشكل عام لكل المناطق.
- عند اختيار محافظة/منطقة رئيسية، لا تظهر إلا المناطق الفرعية التابعة لها وللدورة المختارة.
- في صفحة تعديل الطالب تم تطبيق نفس المنطق.

**الكود الأساسي في تسجيل الطالب:**

```tsx
const subSiteOptions = useMemo(() => {
  if (!form.courseId || !form.mainSite) return [];
  const courseSites = sites.filter(
    s => s.active && s.courseId === form.courseId && s.main === form.mainSite
  );
  const uniqueSubs = [...new Set(courseSites.map(s => s.sub))];
  return uniqueSubs;
}, [form.courseId, form.mainSite, sites]);
```

**المواضع:**

- تسجيل الطالب: الأسطر 50-57.
- سجل الطلاب/تعديل الطالب: الأسطر 137-145.
- إدارة المواقع: تم تحويل الموقع الرئيسي إلى Select ثابت عند الأسطر 86-94 و155-163.

---

## 5) تعديل معرف التلكرام ليقبل الإدخال بدون @

**الملفات:**

- `src/lib/student-utils.ts`
- `src/components/teacher-pro/student-register.tsx`
- `src/components/teacher-pro/student-registry.tsx`
- `src/app/api/students/route.ts`

**ما تم:**

- أي `@` يكتبه المستخدم يتم حذفها تلقائياً.
- الحقل يقبل النص كمعرف بدون اشتراط وجود `@`.
- تم تطبيق نفس التنظيف في API والـ Store.

**الكود الأساسي:**

```ts
export function sanitizeTelegramInput(value: string): string {
  return toLatinDigits(value).replace(/@/g, '').trim();
}
```

**المواضع:**

- الدالة: `src/lib/student-utils.ts` السطر 14.
- حقل التسجيل: `student-register.tsx` السطر 219.
- حقل التعديل: `student-registry.tsx` السطر 515.

---

## 6) تغيير بداية المحاسبة من Calendar إلى رقم أيام 1-30

**الملفات:**

- `src/components/teacher-pro/student-register.tsx`
- `src/components/teacher-pro/student-registry.tsx`
- `src/app/api/students/route.ts`
- `src/lib/student-utils.ts`
- `prisma/schema.prisma`

**ما تم:**

- حذف حقل التاريخ من بداية المحاسبة.
- استبداله بحقل رقم فقط.
- الرقم المقبول من 1 إلى 30.
- إضافة شرح للمستخدم أن الرقم يمثل عدد الأيام المتاحة قبل بدء محاسبة الطالب.
- تغيير Prisma من:

```prisma
accountingStart DateTime?
```

إلى:

```prisma
accountingStart Int?
```

**الكود الأساسي للتحقق:**

```ts
export function isValidAccountingGraceDays(value: string): boolean {
  return /^(?:[1-9]|[12][0-9]|30)$/.test(toLatinDigits(value).trim());
}
```

**المواضع:**

- حقل تسجيل الطالب: `student-register.tsx` الأسطر 343-355.
- حقل تعديل الطالب: `student-registry.tsx` الأسطر 592-594.
- API: `students/route.ts` الأسطر 45-47 و104-109.
- Prisma: `schema.prisma` السطر 79.

---

## 7) جعل إشعار إضافة الطالب في الوسط وواضحاً

**الملف:** `src/app/layout.tsx`

**ما تم:**

- تغيير مكان الـ Toaster من أعلى اليسار إلى أعلى الوسط.
- إضافة ألوان واضحة وزر إغلاق.

**الكود:**

```tsx
<Toaster position="top-center" dir="rtl" richColors closeButton />
```

**الموضع:** السطر 26.

وفي التسجيل تمت إضافة وصف للإشعار:

```tsx
toast.success('تم تسجيل الطالب', {
  description: 'تمت إضافة الطالب إلى سجل الطلاب بنجاح'
});
```

---

## 8) جعل جميع حقول تسجيل الطالب Required

**الملف:** `src/components/teacher-pro/student-register.tsx`

**ما تم:**

- جعل كل الحقول الظاهرة مطلوبة.
- لا يمكن تسجيل الطالب إذا كان أي حقل ناقصاً.
- حقول الدورة الخاصة المطلوبة: رقم الوصل، تسلسل الكود، القسط الأول.
- رقم ولي الأمر أصبح مطلوباً أيضاً.
- تم دعم التحقق أيضاً في API.

**الكود الأساسي:**

```tsx
const requiredChecks: [boolean, string][] = [
  [Boolean(form.name.trim()), 'اسم الطالب مطلوب'],
  [Boolean(form.telegram.trim()), 'معرف التلكرام مطلوب'],
  [Boolean(form.phone.trim()), 'رقم الطالب مطلوب'],
  [Boolean(form.parentPhone.trim()), 'رقم ولي الأمر مطلوب'],
  [Boolean(form.courseId), 'يرجى اختيار الدورة'],
  [Boolean(form.groupId), 'الكروب الإلكتروني مطلوب'],
  [Boolean(form.mainSite), 'الموقع الرئيسي مطلوب'],
  [Boolean(form.subSite), 'الموقع الفرعي مطلوب'],
  [Boolean(form.createdAt), 'تاريخ إضافة الطالب مطلوب'],
  [Boolean(form.accountingStart), 'بداية المحاسبة مطلوبة'],
];
```

**المواضع:**

- تسجيل الطالب: الأسطر 91-119.
- API: `src/app/api/students/route.ts` الأسطر 20-39.

---

## 9) جعل تعديل الطالب في سجل الطلاب يفتح كل بيانات الطالب

**الملف:** `src/components/teacher-pro/student-registry.tsx`

**ما تم:**

- إلغاء التعديل السريع الذي كان مقتصراً على الاسم والهواتف.
- إضافة نموذج تعديل كامل مطابق عملياً لحقول تسجيل الطالب.
- التعديل يشمل: الاسم، الجنس، التلكرام، الهواتف، نوع الدورة، الدورة، الكروب، الموقع الرئيسي، الموقع الفرعي، بيانات الدورة الخاصة، تاريخ الإضافة، بداية المحاسبة.

**المواضع:**

- إنشاء نموذج التعديل من الطالب: الأسطر 55-73.
- تحقق بيانات التعديل: الأسطر 181-222.
- حفظ التعديل: الأسطر 225-258.
- نافذة التعديل الكاملة: الأسطر 497-602.

---

## 10) إظهار التلكرام والهواتف في كارت الطالب كروابط مباشرة

**الملف:** `src/components/teacher-pro/student-registry.tsx`

**ما تم:**

- عرض معرف التلكرام في الكارت.
- الضغط على التلكرام يفتح محادثة Telegram.
- عرض رقم الطالب ورقم ولي الأمر.
- الضغط على أي رقم يفتح محادثة WhatsApp.

**الكود الأساسي:**

```tsx
function whatsappLink(phone: string): string {
  const sanitized = sanitizePhoneInput(phone);
  if (sanitized.startsWith('07') && sanitized.length === 11) {
    return `https://wa.me/964${sanitized.slice(1)}`;
  }
  return `https://wa.me/${sanitized}`;
}

function telegramLink(telegram: string): string {
  return `https://t.me/${encodeURIComponent(normalizeTelegramIdentifier(telegram))}`;
}
```

**المواضع:**

- دوال الروابط: الأسطر 75-83.
- روابط الكارت: الأسطر 431-447.
- روابط ملف الطالب: الأسطر 658-660.

---

## 11) منع التكرار عند إضافة أو تعديل الطالب

**الملفات:**

- `src/lib/student-utils.ts`
- `src/lib/teacher-store.ts`
- `src/components/teacher-pro/student-register.tsx`
- `src/components/teacher-pro/student-registry.tsx`
- `src/app/api/students/route.ts`

**ما تم:**

- منع إضافة طالب إذا كان هناك تطابق في:
  - معرف التلكرام.
  - رقم هاتف الطالب.
  - الاسم الرباعي بعد تنظيف المسافات.
- تم تطبيق المنع في الواجهة، في Store، وفي API.
- تم تطبيقه أيضاً عند تعديل الطالب مع تجاهل الطالب نفسه.

**الكود الأساسي:**

```ts
export function getStudentDuplicateMessage(
  students: StudentDuplicateCandidate[],
  candidate: StudentDuplicateCandidate,
  excludeId?: string,
): string | null {
  const candidateTelegram = normalizeTelegramIdentifier(candidate.telegram);
  const candidatePhone = normalizePhoneForDuplicate(candidate.phone);
  const candidateName = normalizeStudentName(candidate.name);
  // ...
}
```

**المواضع:**

- الدالة: `student-utils.ts` الأسطر 26-53.
- Store add/update: `teacher-store.ts` الأسطر 1041-1094.
- API POST/PUT: `students/route.ts` الأسطر 41-43 و92-101.

---

## 12) إضافة خيار الكل في إضافة امتحان للمناطق والكروبات كـ Checkboxes

**الملف:** `src/components/teacher-pro/exam-new.tsx`

**ما تم:**

- الدورات أصبحت تحتوي خيار `الكل` أيضاً.
- المناطق الرئيسية أصبحت Checkboxes وبها خيار `الكل`.
- الكروبات أصبحت Checkboxes وبها خيار `الكل`.
- الحضور أصبح يفلتر الطلاب حسب الدورة + المنطقة + الكروب.
- تخزين الاختيارات المتعددة يتم كسلسلة مفصولة بفواصل داخل الحقول الحالية حتى لا تُكسر واجهات العرض القديمة.

**الكود الأساسي:**

```tsx
const toggleAllMainSites = () => {
  setForm(prev => ({
    ...prev,
    mainSites: allMainSitesSelected ? [] : [...availableMainSites]
  }));
};

const toggleAllGroups = () => {
  setForm(prev => ({
    ...prev,
    groupIds: allGroupsSelected ? [] : availableGroups.map(g => g.id)
  }));
};
```

**المواضع:**

- دوال الاختيار: الأسطر 16-22 و102-126.
- واجهة الدورات: الأسطر 160-178.
- واجهة المناطق: الأسطر 181-195.
- واجهة الكروبات: الأسطر 198-218.
- فلترة الحضور: الأسطر 130-140.

---

## 13) إضافة المحافظات العراقية الـ18 كخيار أساسي ثابت

**الملف الجديد:** `src/lib/iraq.ts`

**ما تم:**

- إضافة قائمة ثابتة بالمحافظات العراقية الـ18.
- استخدام القائمة في إدارة المواقع، تسجيل الطالب، تعديل الطالب، وإضافة الامتحان.
- المستخدم لم يعد يكتب الموقع الرئيسي يدوياً في إدارة المواقع، بل يختاره من قائمة ثابتة.

**الكود:**

```ts
export const IRAQI_PROVINCES = [
  'بغداد', 'البصرة', 'نينوى', 'أربيل', 'النجف', 'كربلاء',
  'كركوك', 'السليمانية', 'ديالى', 'الأنبار', 'بابل', 'واسط',
  'ذي قار', 'ميسان', 'المثنى', 'القادسية', 'صلاح الدين', 'دهوك',
] as const;

export const MAIN_SITE_OPTIONS = [...IRAQI_PROVINCES, 'أونلاين'] as const;
```

**المواضع المستخدمة:**

- `sites.tsx` السطر 14.
- `student-register.tsx` السطر 13.
- `student-registry.tsx` السطر 16.
- `exam-new.tsx` السطر 14.

---

# ملفات تم تعديلها أو إضافتها

## ملفات مضافة

1. `src/lib/iraq.ts`
2. `src/lib/student-utils.ts`
3. `TEACHERPRO_MODIFICATIONS_FULL_REPORT_AR.md`

## ملفات معدلة

1. `src/components/teacher-pro/dashboard.tsx`
2. `src/components/teacher-pro/layout.tsx`
3. `src/components/teacher-pro/student-register.tsx`
4. `src/components/teacher-pro/student-registry.tsx`
5. `src/components/teacher-pro/exam-new.tsx`
6. `src/components/teacher-pro/sites.tsx`
7. `src/app/layout.tsx`
8. `src/app/api/students/route.ts`
9. `src/lib/teacher-store.ts`
10. `prisma/schema.prisma`

---

# ملاحظات مهمة قبل النشر

1. يجب أخذ نسخة احتياطية من قاعدة البيانات قبل تنفيذ `npm run db:push`.
2. إذا كانت لديك بيانات قديمة في `accountingStart` كتاريخ، يجب تحويلها إلى رقم أيام من 1 إلى 30.
3. بعد تعديل Prisma، نفّذ:

```bash
npm run db:push
npm run db:generate
```

4. ثم شغّل:

```bash
npm run build
```

5. إذا ظهرت مشكلة بسبب بيانات قديمة في LocalStorage، امسح تخزين المتصفح الخاص بالموقع أو استورد Backup محدث.
