BEGIN;
ALTER TABLE "AppUser" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
CREATE FUNCTION tp_revoke_changed_credentials() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" OR NEW."active" IS DISTINCT FROM OLD."active" THEN
  NEW."sessionVersion" := GREATEST(OLD."sessionVersion" + 1, NEW."sessionVersion");
 ELSE
  NEW."sessionVersion" := GREATEST(OLD."sessionVersion", NEW."sessionVersion");
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER tp_revoke_changed_credentials BEFORE UPDATE ON "AppUser"
FOR EACH ROW EXECUTE FUNCTION tp_revoke_changed_credentials();
CREATE TABLE "LoginRateBucket" (
 "key" TEXT PRIMARY KEY, "attempts" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "LoginRateBucket_expiresAt_idx" ON "LoginRateBucket" ("expiresAt");
COMMIT;
