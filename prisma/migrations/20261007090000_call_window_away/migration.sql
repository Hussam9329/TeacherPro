-- «دفعات»: a calls window that went to the background (the caller is on a
-- call from the same phone, or the screen locked) keeps its batch until
-- "awayUntil" instead of losing it after two silent minutes.
ALTER TABLE "CallWindow" ADD COLUMN "awayUntil" TIMESTAMP(3);
