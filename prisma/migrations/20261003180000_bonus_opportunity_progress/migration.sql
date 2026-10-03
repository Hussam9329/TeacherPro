BEGIN;

-- «فرصة مكافأة»: the academic replay stores each student's progress toward
-- the next bonus opportunity (0 none, 1 one pass counted, 2 earned but held
-- until a missing grade is recorded) and, while held, the exam it waits for.
ALTER TABLE "Student"
  ADD COLUMN "bonusProgress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bonusWaitingExamName" TEXT;

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_bonusProgress_range" CHECK ("bonusProgress" BETWEEN 0 AND 2);

COMMIT;
