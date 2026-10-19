-- Additive: signed-in devices of the student mobile app. Each row keeps only
-- the sha256 of the device token; revocation sets "revokedAt" and keeps the
-- row for the admin list. A new table only; no existing row or column changes.
CREATE TABLE IF NOT EXISTS "StudentDevice" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL DEFAULT '',
  "platform" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "StudentDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudentDevice_tokenHash_key" ON "StudentDevice"("tokenHash");
CREATE INDEX IF NOT EXISTS "StudentDevice_studentId_idx" ON "StudentDevice"("studentId");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StudentDevice_studentId_fkey'
  ) THEN
    ALTER TABLE "StudentDevice"
      ADD CONSTRAINT "StudentDevice_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
