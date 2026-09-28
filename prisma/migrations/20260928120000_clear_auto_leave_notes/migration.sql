-- The historical backfills 20260820120000 and 20260820130000 wrote one of two
-- explanatory notes on every leave they created. The owner does not want them
-- shown anywhere. The leave itself, its exam and its reason
-- («مجاز تلقائياً من تسوية تاريخية») stay untouched, so the record still says
-- where it came from. Only these two exact auto texts are cleared; a note a
-- person wrote is never touched. Re-running it changes nothing.
UPDATE "StudentLeave"
SET "notes" = ''
WHERE btrim("notes", E' \t\r\n') IN (
  'تم إنشاء هذا السجل تلقائياً من تسوية تاريخية للدرجات المحوّلة من غائب إلى مجاز.',
  'تم إنشاء هذا السجل تلقائياً من تسوية تاريخية.'
);
