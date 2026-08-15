-- Normalize duplicated / renamed Iraqi locations in existing data.
-- القادسية والديوانية نفس المحافظة عملياً داخل النظام، والاعتماد يكون على الديوانية.
-- ذي قار تُعرض داخل النظام باسم الناصرية حسب طلب العمل.

UPDATE "Student"
SET "subSite" = 'الديوانية'
WHERE "subSite" = 'القادسية';

UPDATE "Student"
SET "mainSite" = 'الديوانية'
WHERE "mainSite" = 'القادسية';

UPDATE "Student"
SET "subSite" = 'الناصرية'
WHERE "subSite" = 'ذي قار';

UPDATE "Student"
SET "mainSite" = 'الناصرية'
WHERE "mainSite" = 'ذي قار';

UPDATE "Course"
SET "locationConfig" = replace(replace("locationConfig", '"القادسية"', '"الديوانية"'), '"ذي قار"', '"الناصرية"')
WHERE "locationConfig" LIKE '%القادسية%' OR "locationConfig" LIKE '%ذي قار%';
