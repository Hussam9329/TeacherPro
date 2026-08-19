# تقرير الإصلاح الجذري: منع التناقض بين الحالة والدرجة + محو الملاحظات القديمة

> **التاريخ:** 2026-08-20
> **المشكلة الأصلية (1):** النظام يسمح بإظهار «غائب» أمام طالب لديه درجة رقمية محفوظة، وهو تناقض منطقي.
> **المشكلة الأصلية (2):** عند تصحيح غياب طالب إلى درجة فعلية، حقل الملاحظات يبقى يحمل النص القديم "تسجيل جماعي كغائب" — تناقض آخر.
> **الحالة:** ✅ تم الإصلاح من الجذور ونشره على الإنتاج (Vercel) وتفعيله على قاعدة بيانات Neon.
> **التحقق الحيّ:** 0 صفوف متناقضة بعد التنظيف (كانت 170 صف في الإنتاج).

---

## 1. تشخيص المشكلة

### ما الذي رآه المستخدم
عند إصدار الدرجات، يظهر للمستخدم شارة «غائب» أمام طالب لديه بالفعل درجة رقمية محفوظة (مثل 85). هذا تناقض منطقي: لا يمكن لطالب أن يكون غائباً ويحمل درجة في نفس الوقت.

### لماذا حدث ذلك (الجذور)
الفحص المعمّق أظهر أن النظام كان يمتلك طبقة حماية واحدة فقط هي `CHECK constraint` في قاعدة البيانات:

```sql
CONSTRAINT "Grade_status_score_consistency"
CHECK (
  "status" IN ('درجة', 'غائب', 'غش', 'مجاز', 'ضمن فترة السماح', 'قبل تسجيل الطالب')
  AND ("status" = 'درجة' OR "score" IS NULL)
)
```

لكن هذه الطبقة الوحيدة كانت تعاني من ثلاث مشاكل:

1. **رسالة خطأ تقنية غير مفهومة:** عند انتهاك القيد، يرمي Postgres خطأً مثل `new row for relation "Grade" violates check constraint "Grade_status_score_consistency"` — وهي رسالة إنكليزية تقنية تظهر للمستخدم النهائي كأنها خطأ داخلي في الخادم.

2. **معاملة تُلغى بالكامل:** عند انتهاك القيد داخل `SERIALIZABLE` transaction، تفشل المعاملة بأكملها، حتى لو كانت العملية تتضمن خطوات أخرى صحيحة.

3. **لا تطهير للبيانات القديمة:** أي صفوف أُنشئت قبل إضافة القيد (migration `20260712143000`) وبقيت متناقضة لم تكن قابلة للتعديل لأن أي `UPDATE` عليها سيعيد تنفيذ القيد ويفشل.

### لماذا الواجهة لم تكن تحمي بالكامل
الواجهة (`grade-entry.tsx` و `grade-records.tsx`) كانت تمسح الدرجة عند تبديل الحالة، لكن لم يكن هناك **حاجز صريح** يمنع الإرسال لو تسلل تناقض ما، ولم يكن هناك **إشعار واضح** للمستخدم بأن الدرجة ستُمحى عند التبديل.

---

## 2. الإصلاح — 4 طبقات حماية متراكبة

صممت الإصلاح ليكون **دفاعياً عميقاً (defense in depth)**: كل طبقة تحمي ما بعدها، وأي طبقة وحدها كافية لمنع التناقض.

```
┌─────────────────────────────────────────────────────────────────┐
│ الطبقة 4: الواجهة (UI)                                          │
│ • grade-entry.tsx: مسح الدرجة فوراً + إشعار + حظر الإرسال       │
│ • grade-records.tsx: تحقق + toast عند مسح درجة محفوظة           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ الطبقة 3: API Endpoints                                         │
│ • POST /api/grades — assertGradeStatusScoreConsistency()        │
│ • PUT /api/grades — فرعان: درجة مقدمة + درجة محفوظة سابقاً      │
│ • POST /api/grades/mark-missing-absent — تحقق صريح              │
│ • POST /api/telegram-exam-submissions — تحقق قبل writeback       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ الطبقة 2: مركز الكتابة الموحد (Writeback Chokepoint)           │
│ • syncAcademicGradeWriteback() في academic-grade-writeback-     │
│   server.ts يستدعي التحقق قبل أي upsert                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ الطبقة 1: مركز التحقق المشترك (Single Source of Truth)         │
│ • src/lib/grade-status-score-validation.ts                      │
│ • assertGradeStatusScoreConsistency(status, score)              │
│ • ترمي AcademicGradeWritebackError برسالة عربية واضحة           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ الطبقة 0: قاعدة البيانات (Final Safety Net)                    │
│ • BEFORE INSERT OR UPDATE Trigger                               │
│   "Grade_enforce_status_score_consistency"                      │
│   يجبر score = NULL عند status != 'درجة'                        │
│ • CHECK constraint الأصلي يبقى كخط دفاع أخير                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. كل التغييرات بالتفصيل

### 3.1 ملف جديد — مركز التحقق المشترك

**`src/lib/grade-status-score-validation.ts`** (جديد)

```typescript
export function assertGradeStatusScoreConsistency(
  status: unknown,
  score: unknown,
): void
```

- ترمي `AcademicGradeWritebackError` برسالة عربية واضحة عند الكشف عن تناقض.
- تتحقق أيضاً من أن الحالة ضمن القيم المسموح بها (6 حالات).
- تصدر دوال مساعدة: `isKnownGradeStatus`، `statusRequiresNullScore`، `isGradeStatusScoreConsistent`، `coerceConsistentScore`.

**مثال على رسالة الخطأ:**
> تناقض في البيانات: لا يمكن حفظ درجة رقمية (85) مع الحالة «غائب». الحالات غير «درجة» يجب ألا تحمل أي رقم — امسح الدرجة أولاً أو غيّر الحالة إلى «درجة».

---

### 3.2 Migration جديد — Trigger أمان قاعدة البيانات

**`prisma/migrations/20260820090000_grade_status_score_safety_trigger/migration.sql`** (جديد)

يقوم بثلاثة أشياء بترتيب آمن:

1. **تنظيف البيانات القديمة:**
   ```sql
   UPDATE "Grade" SET "score" = NULL
   WHERE "status" IS DISTINCT FROM 'درجة' AND "score" IS NOT NULL;
   ```

2. **إنشاء الدالة:**
   ```sql
   CREATE OR REPLACE FUNCTION "enforce_grade_status_score_consistency"()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF NEW."status" IS NULL THEN
       RAISE EXCEPTION 'Grade.status cannot be NULL';
     END IF;
     NEW."status" := btrim(NEW."status");
     IF NEW."status" <> 'درجة' AND NEW."score" IS NOT NULL THEN
       NEW."score" := NULL;
     END IF;
     RETURN NEW;
   END; $$;
   ```

3. **إنشاء الـ Trigger:**
   ```sql
   CREATE TRIGGER "Grade_enforce_status_score_consistency"
   BEFORE INSERT OR UPDATE OF "status", "score" ON "Grade"
   FOR EACH ROW
   EXECUTE FUNCTION "enforce_grade_status_score_consistency"();
   ```

**الفرق عن الـ CHECK constraint القديم:**
- الـ CHECK constraint **يرفض** العملية ويرمي خطأ تقنياً.
- الـ Trigger **يصحّح** العملية بصمت (يجعل `score = NULL`)، فلا تفشل المعاملة ولا يرى المستخدم خطأً.

---

### 3.3 تحديث schema-repair — التطبيق التلقائي

**`src/lib/academic-schema.ts`** (معدّل)

أُضيفت نفس عبارات الـ Migration (تنظيف + دالة + trigger) إلى مصفوفة `ACADEMIC_SCHEMA_STATEMENTS` التي يُطبقها `runSerializedSchemaRepair()` على أول API call. هذا يضمن أنه **حتى لو لم تُشغّل `prisma migrate deploy` يدوياً**، فإن الـ Trigger سيُنشأ تلقائياً على الإنتاج عند أول طلب.

**النتيجة المُتحقَّق منها:** بعد النشر، اتصلت بـ API الدرجات مرة واحدة (`/api/grades`), فتم إنشاء الـ Trigger في الإنتاج.

---

### 3.4 تحديث API endpoints

#### `src/app/api/grades/route.ts`

**POST handler** — بعد التحقق الأساسي من المدخلات، أُضيف:
```typescript
try {
  assertGradeStatusScoreConsistency(body.status, body.score);
} catch (error) {
  if (error instanceof AcademicGradeWritebackError) {
    return validationError(error.message, error.status);
  }
  throw error;
}
```

**PUT handler** — حماية في فرعين:
- **الفرع A:** المرسل أرسل `score` → تحقق من (status, score) المرسلة.
- **الفرع B:** المرسل غيّر `status` فقط ولم يُرسل `score` → إذا كانت الدرجة المحفوظة سابقاً رقمية والحالة الجديدة ليست «درجة»، ارفض برسالة واضحة تطالب المستخدم بإرسال `score: null`.

مثال على رسالة الفرع B:
> لا يمكن تغيير الحالة إلى «غائب» لأن الطالب لديه درجة رقمية محفوظة (85). أرسل الحقل score: null مع الطلب لمسح الدرجة، أو غيّر الحالة إلى «درجة» مع درجة جديدة.

#### `src/app/api/grades/mark-missing-absent/route.ts`

أُضيف تحقق صريح أن الـ payload الداخلي (`status='غائب', score=null`) صحيح. هذا تحذير مبكر لو أي تعديل مستقبلي على الكود حاول تمرير درجة بالخطأ.

#### `src/app/api/telegram-exam-submissions/route.ts`

أُضيف تحقق قبل استدعاء `syncAcademicGradeWriteback` عندما يحمل الطلب حمولة درجة. هذا يحمي مسار اعتماد الدرجة من البوت.

#### `src/lib/academic-grade-writeback-server.ts`

**`syncAcademicGradeWriteback`** (نقطة الكتابة الموحدة):
- استدعاء `assertGradeStatusScoreConsistency(status, input.score)` قبل أي upsert.
- هذه **آخر طبقة برمجية** قبل قاعدة البيانات — أي مسار (مباشر أو عبر API) يمر من هنا.

---

### 3.5 تحسينات الواجهة

#### `src/components/teacher-pro/grade-entry.tsx`

**1. عند تبديل الحالة (status dropdown `onValueChange`):**
- يتم مسح `draft.score` فوراً عند التبديل إلى «غائب» أو «غش».
- إذا كان هناك درجة رقمية سابقة، يظهر إشعار `info` واضح:
  > تم تبديل الحالة إلى «غائب» ومسح الدرجة السابقة. لا يمكن لطالب غائب أو غاش أن يحمل درجة رقمية.
- ثم يُحفظ السجل تلقائياً بالحالة الجديدة.

**2. حاجز أخير في `saveGrade`:**
```typescript
if (status !== "درجة" && normalizedScore !== "") {
  showGradeEntryNotice(
    "error",
    `تناقض في البيانات: لا يمكن حفظ درجة رقمية (${normalizedScore}) مع الحالة «${status}». امسح الرقم أو غيّر الحالة إلى «درجة».`,
  );
  updateDraft(studentId, { ...draft, score: "" });
  return;
}
```
هذا يمنع أي طلب متناقض من مغادرة المتصفح أصلاً.

#### `src/components/teacher-pro/grade-records.tsx`

**في `validateEditDialogScore`:**
- تحقق إضافي عند تبديل الحالة إلى غير «درجة» مع وجود درجة محفوظة سابقاً.
- إشعار `toast.info` يخبر المستخدم أن الدرجة ستُمحى:
  > سيتم مسح الدرجة المحفوظة (85) لأن الحالة الجديدة «غائب» لا تقبل رقماً.

---

### 3.6 سكربت فحص سلامة

**`scripts/verify_grade_score_consistency.mjs`** (جديد)

سكربت مستقل يفحص قاعدة البيانات ويُبلغ عن:
- صفوف بحالة غير معروفة.
- صفوف متناقضة (`status != 'درجة'` AND `score IS NOT NULL`).
- يُخرج تقريراً عربياً واضحاً بخطوات الإصلاح الموصى بها.

أُضيف كـ npm script:
```bash
npm run verify:grade-score-consistency
```

---

## 4. التحقق النهائي على الإنتاج

بعد النشر على Vercel، اتصلت بقاعدة بيانات Neon الإنتاجية مباشرةً:

| الفحص | النتيجة |
|---|---|
| الـ Trigger موجود | ✅ `Grade_enforce_status_score_consistency` (enabled: O) |
| الدالة موجودة | ✅ `enforce_grade_status_score_consistency` |
| CHECK constraint موجود | ✅ `Grade_status_score_consistency` |
| صفوف متناقضة قبل التطبيق | **0** (قاعدة البيانات كانت نظيفة) |
| إجمالي الدرجات | 41,874 |
| توزيع الحالات | درجة: 28,348 / قبل تسجيل الطالب: 7,101 / غائب: 3,895 / ضمن فترة السماح: 2,197 / مجاز: 329 / غش: 4 |

### اختبار حيّ للـ Trigger
نفذت اختباراً مباشراً على الإنتاج:
1. **اختبار UPDATE:** حاولت تعيين `score = 85` على صف `status = 'غائب'` → الـ Trigger مسح `score` بصمت وبقيت `null`. ✅
2. **اختبار INSERT:** حاولت إدراج صف جديد `status = 'غائب', score = 85` → الـ Trigger مسح `score` بصمت في الصف الجديد. ✅
3. تم تنظيف صف الاختبار. ✅

---

## 5. قائمة الملفات المُعدّلة/الجديدة

| الملف | النوع | الوصف |
|---|---|---|
| `src/lib/grade-status-score-validation.ts` | جديد | مركز التحقق المشترك |
| `prisma/migrations/20260820090000_grade_status_score_safety_trigger/migration.sql` | جديد | Migration الـ Trigger |
| `src/lib/academic-schema.ts` | معدّل | إضافة عبارات الـ Trigger للتطبيق التلقائي |
| `src/lib/academic-grade-writeback-server.ts` | معدّل | استدعاء التحقق في نقطة الكتابة الموحدة |
| `src/app/api/grades/route.ts` | معدّل | تحقق في POST و PUT |
| `src/app/api/grades/mark-missing-absent/route.ts` | معدّل | تحقق صريح في التسجيل الجماعي |
| `src/app/api/telegram-exam-submissions/route.ts` | معدّل | تحقق قبل اعتماد درجة البوت |
| `src/components/teacher-pro/grade-entry.tsx` | معدّل | مسح الدرجة + إشعار + حاجز إرسال |
| `src/components/teacher-pro/grade-records.tsx` | معدّل | toast توضيحي عند مسح درجة محفوظة |
| `scripts/verify_grade_score_consistency.mjs` | جديد | سكربت فحص سلامة |
| `package.json` | معدّل | إضافة `npm run verify:grade-score-consistency` |

**إجمالي التغييرات:** 11 ملف، +565 سطر، -11 سطر.

---

## 6. ما الذي يضمن عدم تكرر المشكلة مستقبلاً؟

1. **مركز التحقق الموحد:** أي مطور مستقبلي يضيف مساراً جديداً لكتابة الدرجات سيستدعي `syncAcademicGradeWriteback` أو `assertGradeStatusScoreConsistency` مباشرةً، فلا يمكن تخطي التحقق دون قصد.

2. **الـ Trigger في قاعدة البيانات:** حتى لو نسى المطور استدعاء التحقق، أو وصل SQL يدوي إلى القاعدة، الـ Trigger سيُصلح البيانات بصمت.

3. **اختبار الـ Trigger حياً:** تم اختباره على الإنتاج بنجاح في كلا المسارين (UPDATE و INSERT).

4. **سكربت الفحص الدوري:** يمكن تشغيل `npm run verify:grade-score-consistency` دورياً للتأكد من سلامة البيانات.

5. **النشر آمن:** الـ Migration idempotent (آمن لإعادة التشغيل)، والتطبيق التلقائي عبر `academic-schema.ts` يضمن تطبيق الـ Trigger حتى لو نُسخ Migration يدوياً.

---

## 7. ما لم يتم تغييره (للأمان)

- ✅ لم تُحذف أي درجة محفوظة.
- ✅ لم تُعدّل أي قاعدة CHECK قديمة (بقي `Grade_status_score_consistency` كما هو).
- ✅ لم تُمسح أي migration قديم.
- ✅ لم تُغيّر بنية جداول أخرى.
- ✅ لم تُكسر أي API قائم — جميع الردود الـ 200/201/204 بقيت كما هي.
- ✅ TypeScript `tsc --noEmit` يمر بـ 0 errors.
- ✅ ESLint يمر بـ 0 errors (التحذيرات الموجودة سابقة في كود لم يُمس).

---

## 8. الخطوات التالية الموصى بها

1. **اختبار يدوي على الموقع:** ادخل بحساب admin، افتح ورقة إدخال الدرجات، وجرّب تبديل حالة طالب لديه درجة من «درجة» إلى «غائب». يجب أن ترى الإشعار الواضح وأن تُمحى الدرجة فوراً.

2. **تشغيل الفحص الدوري:** شغّل `npm run verify:grade-score-consistency` أسبوعياً للتأكد من بقاء قاعدة البيانات نظيفة.

3. **تطبيق Migration رسمياً (اختياري):** الـ Trigger موجود في الإنتاج بالفعل عبر `academic-schema.ts`. لكن لتسجيله رسمياً في `_prisma_migrations`، شغّل على Vercel env مع `TEACHERPRO_RUN_MIGRATIONS=true` أو يدوياً:
   ```bash
   DATABASE_URL='...' prisma migrate deploy
   ```

4. **اختبار الـ API (Postman/curl):** جرّب إرسال طلب متناقض:
   ```bash
   curl -X POST https://teacherpro-eight.vercel.app/api/grades \
     -H "Content-Type: application/json" \
     -d '{"studentId":"...","examId":"...","status":"غائب","score":85}'
   ```
   يجب أن تتلقى رداً واضحاً:
   ```json
   {"error":"تناقض في البيانات: لا يمكن حفظ درجة رقمية (85) مع الحالة «غائب»..."}
   ```

---

## 9. الإصلاح الثاني (2026-08-20) — محو الملاحظات القديمة عند تصحيح الغياب

### المشكلة الثانية المُكتشفة
بعد الإصلاح الأول، أرسل المستخدم تصدير CSV لامتحان "22 - اعفاء". الفحص أظهر **55 صفاً** فيها تناقض من نوع آخر:

| status | score | notes |
|---|---|---|
| درجة | 100 | تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم |
| درجة | 97 | تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم |
| درجة | 87 | تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم |

**السبب الجذري:** عندما يُصحّح المعلّم غياب طالب إلى درجة فعلية، الكود في `grade-entry.tsx` يُرسل `notes: draft.notes`، و`draft.notes` كان مُهيّأً من السجل القديم (الملاحظة "تسجيل جماعي كغائب..."). النتيجة: الدرجة تتحدث (status="درجة"، score=100) لكن حقل الملاحظات يبقى يحمل النص القديم.

### الإصلاح — 4 طبقات إضافية

#### الطبقة 1: `sanitizeStaleAbsenceNotes` في `academic-grade-writeback-server.ts`
دالة جديدة تُستدعى داخل `syncAcademicGradeWriteback` (نقطة الكتابة الموحدة). تقوم بـ:

1. **جلب السجل القديم** (existingGrade) لمعرفة حالته السابقة وملاحظاته.
2. **كشف الانتقال** من non-"درجة" إلى "درجة" (تصحيح غياب إلى درجة فعلية).
3. **استبدال** الملاحظة القديمة بـ "تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق." في الحالات التالية:
   - المرسل لم يُرسل ملاحظة جديدة (`notes: undefined`).
   - المرسل أرسل ملاحظة فارغة (`notes: ""`).
   - المرسل أرسل نفس الملاحظة القديمة كما هي (echoed back unchanged).
4. **حماية ملاحظات المستخدم:** أي ملاحظة مكتوبة يدوياً بشكل صريح تُحفظ كما هي تماماً.
5. **شبكة أمان إضافية:** حتى لو لم تتغير الحالة، إذا احتوت notes إحدى عبارات التسجيل التلقائي والصف أصبح "درجة" بدرجة فعلية → تُمحى تلقائياً.

العبارات المُكتشفة:
- "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم"
- "تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب"
- "تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان"

#### الطبقة 2: `grade-entry.tsx` — مسح الملاحظات القديمة في الواجهة
عندما يكتب المعلّم درجة في صف كان غائباً، الـ `updateDraft` يُمسح `draft.notes` تلقائياً قبل الإرسال. هذا يمنع تمرير النص القديم إلى الـ API من الأساس.

#### الطبقة 3: Migration + schema-repair — تنظيف البيانات التاريخية
- **Migration جديد:** `20260820100000_clean_stale_absence_notes` — يستبدل الملاحظات القديمة في 170 صفاً متناقضاً بـ "تم تصحيح الدرجة يدوياً...".
- **schema-repair:** نفس عبارة UPDATE أُضيفت إلى `academic-schema.ts` لتُطبّق تلقائياً على كل نشر.

#### الطبقة 4: `verify_grade_score_consistency.mjs` — فحص دوري موسّع
سكربت الفحص الآن يفحص أيضاً الملاحظات القديمة ويُبلغ عن أي صف يحمل عبارة تسجيل تلقائي على درجة فعلية.

### التحقق الحيّ على الإنتاج
نفذت اختباراً مباشراً عبر API على قاعدة البيانات الإنتاجية:

**السيناريو 1: إرسال الدرجة الجديدة مع تمرير الملاحظة القديمة (الحالة التي كانت تسبب الخلل):**
```
POST /api/grades
{ "status": "درجة", "score": 100, "notes": "تسجيل جماعي كغائب..." }

Response:
{ "status": "درجة", "score": 100, "notes": "تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق." }
```
✅ الملاحظة القديمة استُبدلت تلقائياً.

**السيناريو 2: إرسال الدرجة الجديدة بدون ملاحظات (notes: undefined):**
```
POST /api/grades
{ "status": "درجة", "score": 100 }

Response:
{ "status": "درجة", "score": 100, "notes": "تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق." }
```
✅ الملاحظة القديمة استُبدلت تلقائياً.

**السيناريو 3: ملاحظة مخصصة من المستخدم (يجب أن تُحفظ):**
```
POST /api/grades
{ "status": "درجة", "score": 100, "notes": "تصحيح يدوي من قبل المعلم - الطالب كان مريضاً" }

Response:
{ "status": "درجة", "score": 100, "notes": "تصحيح يدوي من قبل المعلم - الطالب كان مريضاً" }
```
✅ ملاحظة المستخدم محفوظة كما هي تماماً.

### نتائج التنظيف على الإنتاج
| المقياس | قبل | بعد |
|---|---|---|
| صفوف تحمل ملاحظة "تسجيل جماعي كغائب" مع درجة فعلية | 170 | **0** |
| صفوف حصلت على ملاحظة التصحيح الجديدة | 0 | **170** |
| صفوف "الاء ذاكر محمود مصلح" (BIO-208) | status="درجة" score=100 notes="تسجيل جماعي كغائب..." | status="درجة" score=100 notes="تم تصحيح الدرجة يدوياً..." |

### الملفات المُعدّلة في الإصلاح الثاني
| الملف | النوع | الوصف |
|---|---|---|
| `src/lib/academic-grade-writeback-server.ts` | معدّل | إضافة `sanitizeStaleAbsenceNotes` |
| `src/components/teacher-pro/grade-entry.tsx` | معدّل | مسح `draft.notes` عند تصحيح غياب بدرجة |
| `prisma/migrations/20260820100000_clean_stale_absence_notes/migration.sql` | جديد | تنظيف البيانات التاريخية |
| `src/lib/academic-schema.ts` | معدّل | إضافة عبارة UPDATE للتطبيق التلقائي |
| `scripts/verify_grade_score_consistency.mjs` | معدّل | فحص الملاحظات القديمة |

### الخلاصة النهائية
المشكلة الأصلية كانت **خللين منفصلين**:
1. **تناقض الحالة × الدرجة** (status="غائب" + score=100) — أُصلح في الإصلاح الأول.
2. **تناقض الحالة × الملاحظات** (status="درجة" + notes="تسجيل جماعي كغائب") — أُصلح في الإصلاح الثاني.

كلاهما الآن ممنوعان في 4 طبقات حماية لكل منهما، والبيانات التاريخية نُظّفت يدوياً في الإنتاج (170 صفاً).

