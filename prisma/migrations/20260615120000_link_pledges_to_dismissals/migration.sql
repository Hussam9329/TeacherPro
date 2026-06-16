-- ربط تعهدات ولي الأمر بسجل الفصل/سبب الفصل بدلاً من الاعتماد على نص الملاحظة فقط.
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "sourceId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "StudentNote_sourceType_idx" ON "StudentNote"("sourceType");
CREATE INDEX IF NOT EXISTS "StudentNote_sourceId_idx" ON "StudentNote"("sourceId");
CREATE INDEX IF NOT EXISTS "StudentNote_dismissalKey_idx" ON "StudentNote"("dismissalKey");
