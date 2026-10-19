-- Additive: push notifications for the student mobile app.
-- 1. "StudentDevice"."pushToken": the device's native push token (APNs on
--    iOS, FCM registration token on Android), null until the app reports it.
-- 2. "StudentPushLog": every notification the server sent (manual sends from
--    «إرسال إشعار» and the exam-window push). "examId" is unique so the
--    one-minute cron claims each exam once; no foreign keys so the log keeps
--    its names after a course, chapter or exam is deleted.
ALTER TABLE "StudentDevice" ADD COLUMN IF NOT EXISTS "pushToken" TEXT;

CREATE TABLE IF NOT EXISTS "StudentPushLog" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "courseId" TEXT,
  "courseName" TEXT NOT NULL DEFAULT '',
  "chapterId" TEXT,
  "chapterName" TEXT NOT NULL DEFAULT '',
  "examId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "recipients" INTEGER NOT NULL DEFAULT 0,
  "devices" INTEGER NOT NULL DEFAULT 0,
  "sent" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "userName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentPushLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudentPushLog_examId_key" ON "StudentPushLog"("examId");
CREATE INDEX IF NOT EXISTS "StudentPushLog_createdAt_idx" ON "StudentPushLog"("createdAt");
