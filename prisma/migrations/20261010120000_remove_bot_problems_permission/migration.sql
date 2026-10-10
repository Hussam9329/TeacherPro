-- «مشاكل البوت» was removed from the system. Its permission id leaves every
-- role and every account's own list; nothing else on them changes. A list
-- that is not JSON (the old comma form) is cleaned the same way. Re-running
-- it changes nothing. The notebook's table is left in place, unused: a
-- table is never dropped by a deployment.
BEGIN;

DO $$
DECLARE
  item RECORD;
  kept TEXT;
BEGIN
  FOR item IN SELECT "id", "permissions" FROM "Role" WHERE "permissions" LIKE '%bot-problems.manage%'
  LOOP
    BEGIN
      SELECT COALESCE(json_agg(entry.value ORDER BY entry.position)::text, '[]') INTO kept
      FROM json_array_elements_text(item."permissions"::json) WITH ORDINALITY AS entry(value, position)
      WHERE entry.value <> 'bot-problems.manage';
    EXCEPTION WHEN others THEN
      SELECT COALESCE(json_agg(entry.value ORDER BY entry.position)::text, '[]') INTO kept
      FROM (
        SELECT btrim(part) AS value, position
        FROM regexp_split_to_table(item."permissions", ',') WITH ORDINALITY AS split(part, position)
      ) AS entry
      WHERE entry.value <> '' AND entry.value <> 'bot-problems.manage';
    END;
    UPDATE "Role" SET "permissions" = kept WHERE "id" = item."id";
  END LOOP;

  FOR item IN SELECT "id", "permissions" FROM "AppUser" WHERE "permissions" LIKE '%bot-problems.manage%'
  LOOP
    BEGIN
      SELECT COALESCE(json_agg(entry.value ORDER BY entry.position)::text, '[]') INTO kept
      FROM json_array_elements_text(item."permissions"::json) WITH ORDINALITY AS entry(value, position)
      WHERE entry.value <> 'bot-problems.manage';
    EXCEPTION WHEN others THEN
      SELECT COALESCE(json_agg(entry.value ORDER BY entry.position)::text, '[]') INTO kept
      FROM (
        SELECT btrim(part) AS value, position
        FROM regexp_split_to_table(item."permissions", ',') WITH ORDINALITY AS split(part, position)
      ) AS entry
      WHERE entry.value <> '' AND entry.value <> 'bot-problems.manage';
    END;
    UPDATE "AppUser" SET "permissions" = kept WHERE "id" = item."id";
  END LOOP;
END $$;

COMMIT;
