-- «مشرف»: every permission in TeacherPro except the accounts and
-- permissions pages, which stay with مدير النظام alone; «إشراف كامل»
-- (system.oversight) lets supervisors act like the admin elsewhere (calls
-- without batches, «منو شغال هسه», the Telegram link, deleting logs).
-- Only the default supervisor role changes; other roles and accounts are not
-- touched. Re-running it changes nothing.
BEGIN;

UPDATE "Role"
SET "permissions" = '["system.dashboard","system.settings","backup.view","backup.restore","system.oversight","system.maintenance","courses.view","courses.add","courses.edit","courses.delete","chapters.view","chapters.add","chapters.edit","chapters.delete","students.view","students.registry.view","students.add","students.edit","students.delete","grace-periods.view","grace-periods.manage","exams.view","exams.add","exams.edit","exams.delete","grades.view","grades.add","grades.edit","grades.delete","opportunities.view","opportunities.manage","follow-up.view","follow-up.manage","follow-up.calls.view","follow-up.calls.manage","follow-up.leaves.view","follow-up.leaves.manage","logs.delete","logs.clear","logs.restore","bot-problems.manage","logs.view"]'
WHERE "id" = 'role_supervisor';

COMMIT;
