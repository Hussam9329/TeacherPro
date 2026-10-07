-- Supervisor accounts made before «مشرف» lost the accounts pages kept their
-- own copy of the old role, accounts permissions included, and the server
-- adds an account's own list on top of its role. Drop the accounts and
-- permissions entries from those copies; nothing else on the account
-- changes, and other roles' accounts are not touched. A list that is not
-- JSON (the old comma form) is cleaned the same way. Re-running it changes
-- nothing.
BEGIN;

DO $$
DECLARE
  account RECORD;
  kept TEXT;
BEGIN
  FOR account IN
    SELECT "id", "permissions" FROM "AppUser"
    WHERE "roleId" = 'role_supervisor' AND "permissions" LIKE '%accounts.%'
  LOOP
    BEGIN
      SELECT COALESCE(json_agg(item.value ORDER BY item.position)::text, '[]') INTO kept
      FROM json_array_elements_text(account."permissions"::json) WITH ORDINALITY AS item(value, position)
      WHERE item.value NOT LIKE 'accounts.%' AND item.value <> 'page.accounts.view';
    EXCEPTION WHEN others THEN
      SELECT COALESCE(json_agg(item.value ORDER BY item.position)::text, '[]') INTO kept
      FROM (
        SELECT btrim(part) AS value, position
        FROM regexp_split_to_table(account."permissions", ',') WITH ORDINALITY AS split(part, position)
      ) AS item
      WHERE item.value <> '' AND item.value NOT LIKE 'accounts.%' AND item.value <> 'page.accounts.view';
    END;
    UPDATE "AppUser" SET "permissions" = kept WHERE "id" = account."id";
  END LOOP;
END $$;

COMMIT;
