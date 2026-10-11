-- Additive: «إحصائيات المكالمات», the calls a course needs on one Baghdad
-- day. A new table only; no existing table, row or column changes.
CREATE TABLE "CallDailyTarget" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallDailyTarget_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CallDailyTarget_target_not_negative" CHECK ("target" >= 0)
);

CREATE UNIQUE INDEX "CallDailyTarget_day_courseId_key"
ON "CallDailyTarget"("day", "courseId");

CREATE INDEX "CallDailyTarget_day_idx"
ON "CallDailyTarget"("day");
