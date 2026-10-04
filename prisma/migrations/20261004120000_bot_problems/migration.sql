-- Additive: «مشاكل البوت», a notebook of Telegram-bot problems per student.
-- A new table only; no existing table, row or column changes.
CREATE TABLE "BotProblem" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByName" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "BotProblem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BotProblem_reason_not_blank" CHECK (length(btrim("reason")) > 0)
);

CREATE INDEX "BotProblem_resolvedAt_createdAt_idx"
ON "BotProblem"("resolvedAt", "createdAt");

CREATE INDEX "BotProblem_studentId_idx"
ON "BotProblem"("studentId");

ALTER TABLE "BotProblem"
ADD CONSTRAINT "BotProblem_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
