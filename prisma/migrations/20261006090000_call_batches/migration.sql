-- Additive: «دفعات» in إدارة المكالمات. Each open calls window holds a small
-- batch of students nobody else gets, and every contact action records who
-- made it. New tables and nullable columns only; no existing row changes.
CREATE TABLE "CallWindow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL DEFAULT '',
    "courseId" TEXT NOT NULL DEFAULT '',
    "examId" TEXT NOT NULL DEFAULT '',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CallWindow_lastSeenAt_idx" ON "CallWindow"("lastSeenAt");

CREATE TABLE "CallReservation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallReservation_studentId_examId_key" ON "CallReservation"("studentId", "examId");
CREATE INDEX "CallReservation_windowId_idx" ON "CallReservation"("windowId");
CREATE INDEX "CallReservation_examId_idx" ON "CallReservation"("examId");

ALTER TABLE "CallReservation"
ADD CONSTRAINT "CallReservation_windowId_fkey"
FOREIGN KEY ("windowId") REFERENCES "CallWindow"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallReservation"
ADD CONSTRAINT "CallReservation_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallReservation"
ADD CONSTRAINT "CallReservation_examId_fkey"
FOREIGN KEY ("examId") REFERENCES "Exam"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentCall" ADD COLUMN "actedAt" TIMESTAMP(3);
ALTER TABLE "StudentCall" ADD COLUMN "actedById" TEXT;
ALTER TABLE "StudentCall" ADD COLUMN "actedByName" TEXT;
