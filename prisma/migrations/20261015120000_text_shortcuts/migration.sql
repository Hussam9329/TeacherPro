-- Additive: «اختصارات», ready texts the admin and the supervisors copy with
-- one click. A new table only; no existing row or column changes.
CREATE TABLE IF NOT EXISTS "TextShortcut" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdByName" TEXT NOT NULL DEFAULT '',
  "updatedById" TEXT,
  "updatedByName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TextShortcut_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TextShortcut_sortOrder_idx" ON "TextShortcut"("sortOrder");
