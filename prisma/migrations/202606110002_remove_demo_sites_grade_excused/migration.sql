-- Remove legacy grade status that duplicated StudentLeave records.
UPDATE "Grade" SET "status" = 'غائب' WHERE "status" = 'مجاز';

-- Remove deleted Demo Copies feature and legacy Sites Management table.
DROP TABLE IF EXISTS "DemoCopy";
DROP TABLE IF EXISTS "Site";
