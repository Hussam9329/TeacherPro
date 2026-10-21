-- «اغلاق الكودات»: a code counts as closed only after both steps of the
-- current dismissal (☢️ on the platform, and the notice by the bot or the
-- Telegram chat). Codes marked closed without both go back to «غير مغلق».
--
-- Touches only "dismissedChecked" of dismissed students; their epoch, status,
-- balances and history stay as they are (the dismissed-check trigger keeps
-- the epoch when only the flag changes). The students it reopens are listed
-- in one audit entry first, so the change can be traced and undone.

INSERT INTO "AuditLog" ("id", "module", "action", "details", "time", "userName")
SELECT
  'reopen_unfinished_code_closures_20261021',
  'سجل الطلاب',
  'إرجاع أكواد لم تكتمل خطوات إغلاقها',
  json_build_object(
    'count', COUNT(*),
    'studentIds', COALESCE(json_agg("id" ORDER BY "id"), '[]'::json),
    'rule', 'closed requires closurePlatformEpoch and closureTelegramEpoch = dismissedCheckEpoch'
  )::text,
  CURRENT_TIMESTAMP,
  'النظام'
FROM "Student"
WHERE "status" = 'مفصول'
  AND "dismissedChecked" = true
  AND NOT (
    COALESCE("closurePlatformEpoch", -1) = "dismissedCheckEpoch"
    AND COALESCE("closureTelegramEpoch", -1) = "dismissedCheckEpoch"
  )
ON CONFLICT ("id") DO NOTHING;

UPDATE "Student"
SET "dismissedChecked" = false
WHERE "status" = 'مفصول'
  AND "dismissedChecked" = true
  AND NOT (
    COALESCE("closurePlatformEpoch", -1) = "dismissedCheckEpoch"
    AND COALESCE("closureTelegramEpoch", -1) = "dismissedCheckEpoch"
  );
