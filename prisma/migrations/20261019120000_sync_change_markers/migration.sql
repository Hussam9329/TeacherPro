-- Additive: a cheap change marker for /api/sync/version, which used to
-- COUNT(*) fourteen whole tables on every 12-second poll from every tab.
--
-- Every write statement on a watched table inserts one tiny row into
-- "SyncChange" (an insert, so concurrent writers never wait on each other
-- and nothing can deadlock). The row is visible only once its transaction
-- commits, so a poll never announces a change it cannot read yet. Old rows
-- are folded into "SyncVersion"."folded" by the version route, so
-- folded + live rows is a counter that only grows. No existing table, row
-- or column changes.

CREATE TABLE IF NOT EXISTS "SyncVersion" (
  "scope" TEXT NOT NULL,
  "folded" BIGINT NOT NULL DEFAULT 0,
  "changedAt" TIMESTAMP(3),
  CONSTRAINT "SyncVersion_pkey" PRIMARY KEY ("scope")
);

CREATE TABLE IF NOT EXISTS "SyncChange" (
  "id" BIGSERIAL NOT NULL,
  "scope" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SyncChange_scope_idx" ON "SyncChange"("scope");
CREATE INDEX IF NOT EXISTS "SyncChange_at_idx" ON "SyncChange"("at");

INSERT INTO "SyncVersion" ("scope") VALUES
  ('courses'), ('chapters'), ('courseChapters'), ('students'), ('exams'),
  ('grades'), ('opportunityLogs'), ('studentLeaves'), ('studentCalls'),
  ('studentNotes'), ('users'), ('roles'), ('auditLogs'), ('gradeSmartNotes')
ON CONFLICT ("scope") DO NOTHING;

-- An insert or delete that touched no row (a deleteMany that matched
-- nothing) is not a change.
CREATE OR REPLACE FUNCTION "teacherpro_sync_mark_rows"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sync_changed_rows") THEN
    INSERT INTO "SyncChange" ("scope") VALUES (TG_ARGV[0]);
  END IF;
  RETURN NULL;
END;
$$;

-- An update counts only when some row's content really changed: rewriting
-- a row with the same values (an upsert that only refreshes "updatedAt") is
-- not a change. A changed id shows as an unmatched row, so it counts.
CREATE OR REPLACE FUNCTION "teacherpro_sync_mark_changed_rows"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sync_new_rows" AS n
    FULL JOIN "sync_old_rows" AS o ON o."id" = n."id"
    WHERE o."id" IS NULL
       OR n."id" IS NULL
       OR (to_jsonb(n) - 'updatedAt') IS DISTINCT FROM (to_jsonb(o) - 'updatedAt')
  ) THEN
    INSERT INTO "SyncChange" ("scope") VALUES (TG_ARGV[0]);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "teacherpro_sync_mark"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "SyncChange" ("scope") VALUES (TG_ARGV[0]);
  RETURN NULL;
END;
$$;

DO $sync$
DECLARE
  watched CONSTANT TEXT[][] := ARRAY[
    ['Course', 'courses'],
    ['Chapter', 'chapters'],
    ['CourseChapter', 'courseChapters'],
    ['Student', 'students'],
    ['Exam', 'exams'],
    ['Grade', 'grades'],
    ['OpportunityLog', 'opportunityLogs'],
    ['StudentLeave', 'studentLeaves'],
    ['StudentCall', 'studentCalls'],
    ['StudentNote', 'studentNotes'],
    ['AppUser', 'users'],
    ['Role', 'roles'],
    ['AuditLog', 'auditLogs'],
    ['GradeSmartNote', 'gradeSmartNotes']
  ];
  i INT;
  tbl TEXT;
  scope TEXT;
BEGIN
  FOR i IN 1 .. array_length(watched, 1) LOOP
    tbl := watched[i][1];
    scope := watched[i][2];
    EXECUTE format('DROP TRIGGER IF EXISTS "sync_mark_insert" ON %I', tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS "sync_mark_update" ON %I', tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS "sync_mark_delete" ON %I', tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS "sync_mark_truncate" ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER "sync_mark_insert" AFTER INSERT ON %I REFERENCING NEW TABLE AS "sync_changed_rows" FOR EACH STATEMENT EXECUTE FUNCTION "teacherpro_sync_mark_rows"(%L)',
      tbl, scope);
    EXECUTE format(
      'CREATE TRIGGER "sync_mark_update" AFTER UPDATE ON %I REFERENCING OLD TABLE AS "sync_old_rows" NEW TABLE AS "sync_new_rows" FOR EACH STATEMENT EXECUTE FUNCTION "teacherpro_sync_mark_changed_rows"(%L)',
      tbl, scope);
    EXECUTE format(
      'CREATE TRIGGER "sync_mark_delete" AFTER DELETE ON %I REFERENCING OLD TABLE AS "sync_changed_rows" FOR EACH STATEMENT EXECUTE FUNCTION "teacherpro_sync_mark_rows"(%L)',
      tbl, scope);
    EXECUTE format(
      'CREATE TRIGGER "sync_mark_truncate" AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION "teacherpro_sync_mark"(%L)',
      tbl, scope);
  END LOOP;
END;
$sync$;
