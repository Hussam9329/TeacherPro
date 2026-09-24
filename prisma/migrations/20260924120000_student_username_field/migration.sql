-- يوزر تليكرام المستعاد: حقل إضافي مستقل عن telegram (المعرف/ID).
-- nullable، غير فريد، مع فهرس للبحث السريع في كل الواجهات.
ALTER TABLE "Student" ADD COLUMN "username" TEXT;

CREATE INDEX "Student_username_idx" ON "Student"("username");
