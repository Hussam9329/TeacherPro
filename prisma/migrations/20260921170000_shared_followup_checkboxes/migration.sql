-- Shared administrative tracking only. Existing academic data is untouched.
ALTER TABLE "Student" ADD COLUMN "dismissedChecked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StudentCall" ADD COLUMN "noteResolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StudentCall" ADD COLUMN "noteRevision" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "StudentCall_category_examId_noteResolved_idx"
  ON "StudentCall" ("category", "examId", "noteResolved");
