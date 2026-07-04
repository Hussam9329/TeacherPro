# ربط بوت التليغرام مع التصحيح الإلكتروني في TeacherPro

هذا التعديل يضيف إلى TeacherPro مسار استقبال مباشر لتسليمات البوت:

```http
POST /api/telegram-exam-submissions
Authorization: Bearer <TEACHERPRO_BOT_INGEST_TOKEN>
Content-Type: application/json
```

أو يمكن إرسال التوكن بالهيدر:

```http
x-teacherpro-bot-token: <TEACHERPRO_BOT_INGEST_TOKEN>
```

## المتغيرات المطلوبة

في بيئة TeacherPro أضف توكن الاستقبال:

```env
TEACHERPRO_BOT_INGEST_TOKEN="replace-with-a-long-random-bot-ingest-token"
```

وفي بيئة بوت التليغرام ضع رابط TeacherPro ونفس التوكن بالضبط:

```env
TEACHERPRO_API_URL="https://teacherpro-eight.vercel.app"
TEACHERPRO_BOT_INGEST_TOKEN="replace-with-a-long-random-bot-ingest-token"
```

داخل صفحة **التصحيح الإلكتروني → مستلمات البوت** سيظهر لك رابط `TEACHERPRO_API_URL` المقترح وحالة تفعيل التوكن. التوكن الحقيقي لا يظهر في الواجهة لأسباب أمنية.

> مهم: أنشئ توكن عشوائي طويل، وضع نفس قيمة `TEACHERPRO_BOT_INGEST_TOKEN` في Vercel داخل مشروع TeacherPro وفي ملف `.env` داخل مشروع البوت. إذا اختلف حرف واحد لن يقبل TeacherPro التسليمات.

## شكل البيانات التي يرسلها البوت

```json
{
  "studentId": "c...",
  "examId": "c...",
  "telegramUserId": "123456789",
  "telegramUsername": "student_username",
  "telegramChatId": "123456789",
  "sourceMessageIds": ["101", "102"],
  "submittedAt": "2026-06-25T16:00:00.000Z",
  "pages": [
    {
      "pageNumber": 1,
      "fileName": "page_1.jpg",
      "mimeType": "image/jpeg",
      "url": "https://.../page_1.jpg",
      "fileId": "telegram_file_id",
      "messageId": "101"
    }
  ],
  "notes": "اختياري"
}
```

## ماذا يفعل TeacherPro عند الاستلام؟

- يتأكد من صحة التوكن.
- يتأكد أن الطالب والامتحان موجودان.
- ينشئ أو يحدث سجل `Grade` للطالب والامتحان بحالة `درجة` حتى يظهر الطالب كمسلم للامتحان.
- يخزن بيانات التسليم في جدول `TelegramExamSubmission`.
- تعرض صفحة **التصحيح الإلكتروني → مستلمات البوت** كل التسليمات مع تفاصيل الطالب والامتحان والصفحات.

## ملاحظات مهمة عن الصور

TeacherPro يستطيع عرض الصورة مباشرة إذا أرسل البوت أحد الحقول التالية داخل كل صفحة:

- `url`: رابط صورة قابل للفتح من المتصفح.
- `dataUrl`: صورة base64 بصيغة `data:image/jpeg;base64,...`.

إذا أرسل البوت `localPath` فقط مثل `submissions/student_x/exam_y/page_1.jpg`، سيعرض TeacherPro المسار كمعلومة، لكنه لا يقدر يفتح الصورة إلا إذا كان نفس المسار متاحاً من سيرفر TeacherPro.
