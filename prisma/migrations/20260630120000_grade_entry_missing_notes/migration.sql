-- ملاحظات مدخل الدرجات للطلاب غير الموجودين
-- كانت محفوظة محلياً في المتصفح، الآن تنحفظ في قاعدة البيانات.
CREATE TABLE IF NOT EXISTS "GradeEntryMissingNote" (
  "id" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "examName" TEXT NOT NULL DEFAULT '',
  "examDate" TEXT NOT NULL DEFAULT '',
  "text" TEXT NOT NULL,
  "userId" TEXT,
  "userName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GradeEntryMissingNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GradeEntryMissingNote_examId_idx" ON "GradeEntryMissingNote"("examId");
CREATE INDEX IF NOT EXISTS "GradeEntryMissingNote_updatedAt_idx" ON "GradeEntryMissingNote"("updatedAt");
