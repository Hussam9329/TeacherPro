-- Owner-reviewed tidy-up of texts the system wrote by itself (report of
-- 2026-09-28). Only exact automatic texts are touched; anything a person
-- wrote is left as it is. The texts the calculation depends on
-- («تسوية تاريخية بلا أثر:», «أثر أكاديمي فعّال بعد التسوية:», «تلقائي:»,
-- «تسوية تاريخية:», «فصل الطالب») are never changed here. Every step is
-- idempotent: running it again changes nothing.
--
-- The same rules are applied to the live rows and to the copies kept inside
-- StudentEnrollmentArchive.snapshot (a student's file before a course
-- transfer or a «new student» reset), because those copies are shown in the
-- dismissed-students history.
--
-- Helper functions live in pg_temp: they exist only for this session.

CREATE FUNCTION pg_temp.tp_clean(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(value, E' \t\r\n')
$$;

-- Grade notes: old long automatic texts → the short texts the system writes
-- today, or nothing. NULL means «no note», so the pre-registration repair
-- (which looks for NULL) still recognises a cleared bulk-absence row.
CREATE FUNCTION pg_temp.tp_tidy_grade_note(note text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN note IS NULL THEN NULL
    WHEN pg_temp.tp_clean(note) IN (
      'تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق.',
      'تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم',
      'تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم.'
    ) THEN NULL
    WHEN pg_temp.tp_clean(note) IN (
      'الطالب مجاز من هذا الامتحان.',
      'الطالب مجاز من هذا الامتحان',
      'تسجيل تلقائي: الطالب مجاز من هذا الامتحان',
      'تسجيل تلقائي: الطالب مجاز من هذا الامتحان.'
    ) THEN 'إجازة'
    WHEN pg_temp.tp_clean(note) IN (
      'تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب',
      'تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب.'
    ) THEN 'قبل تسجيل الطالب'
    WHEN pg_temp.tp_clean(note) IN (
      'تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان',
      'تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان.'
    ) THEN 'فترة سماح'
    WHEN pg_temp.tp_clean(note) IN (
      'تسجيل تلقائي: لم تُدخل درجة الطالب في امتحان سابق',
      'تسجيل تلقائي: لم تُدخل درجة الطالب في امتحان سابق.'
    ) THEN 'غياب تلقائي'
    WHEN pg_temp.tp_clean(note) IN (
      'إجازة: مجاز تلقائياً من تسوية تاريخية',
      'الطالب مجاز من هذا الامتحان: مجاز تلقائياً من تسوية تاريخية'
    ) THEN 'إجازة: تسوية قديمة'
    WHEN pg_temp.tp_clean(note) LIKE 'الطالب مجاز من هذا الامتحان: %'
      THEN 'إجازة: ' || btrim(substr(pg_temp.tp_clean(note), length('الطالب مجاز من هذا الامتحان: ') + 1))
    ELSE note
  END
$$;

-- Leave: the historical auto reason gets a clear wording, and the two auto
-- notes (already cleared from live rows on 2026-09-28) are cleared.
CREATE FUNCTION pg_temp.tp_is_auto_leave_note(note text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(pg_temp.tp_clean(note) IN (
    'تم إنشاء هذا السجل تلقائياً من تسوية تاريخية للدرجات المحوّلة من غائب إلى مجاز.',
    'تم إنشاء هذا السجل تلقائياً من تسوية تاريخية.'
  ), false)
$$;

CREATE FUNCTION pg_temp.tp_is_auto_leave_reason(reason text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(pg_temp.tp_clean(reason) = 'مجاز تلقائياً من تسوية تاريخية', false)
$$;

-- Calls: the calls page used to copy «السبب | الامتحان | الدرجة» into the
-- note of a contact-status row. A person's call notes live in rows of the
-- category «call-student-note», which are never touched.
CREATE FUNCTION pg_temp.tp_is_auto_call_note(category text, note text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(category, '') <> 'call-student-note'
    AND COALESCE(note, '') ~ '^[^|]* \| [^|]* \| [^|]*$'
$$;

-- Live rows ------------------------------------------------------------------

UPDATE "Grade"
SET "notes" = pg_temp.tp_tidy_grade_note("notes")
WHERE "notes" IS NOT NULL
  AND pg_temp.tp_tidy_grade_note("notes") IS DISTINCT FROM "notes";

UPDATE "StudentLeaveGradeBackup"
SET "notes" = pg_temp.tp_tidy_grade_note("notes")
WHERE "notes" IS NOT NULL
  AND pg_temp.tp_tidy_grade_note("notes") IS DISTINCT FROM "notes";

UPDATE "StudentLeave"
SET "reason" = 'إجازة (تسوية قديمة)'
WHERE pg_temp.tp_is_auto_leave_reason("reason");

UPDATE "StudentCall"
SET "notes" = ''
WHERE pg_temp.tp_is_auto_call_note("category", "notes");

-- The transfer reason named courses by their internal ids; use the names.
UPDATE "StudentEnrollmentArchive" archive
SET "reason" = 'نقل الطالب من دورة «'
  || COALESCE(NULLIF(btrim(archive."fromCourseName"), ''), (SELECT course."name" FROM "Course" course WHERE course."id" = archive."fromCourseId"), archive."fromCourseId")
  || '» إلى دورة «'
  || COALESCE(NULLIF(btrim(archive."toCourseName"), ''), (SELECT course."name" FROM "Course" course WHERE course."id" = archive."toCourseId"), archive."toCourseId", '')
  || '» وبدء ملف جديد'
WHERE archive."reason" = 'نقل الطالب من دورة ' || archive."fromCourseId" || ' إلى دورة ' || COALESCE(archive."toCourseId", '') || ' وبدء ملف جديد';

-- Copies inside archive snapshots -----------------------------------------------

CREATE FUNCTION pg_temp.tp_try_jsonb(value text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

CREATE FUNCTION pg_temp.tp_tidy_snapshot_grade(item jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(item) = 'object'
      AND jsonb_typeof(item -> 'notes') = 'string'
      AND pg_temp.tp_tidy_grade_note(item ->> 'notes') IS DISTINCT FROM item ->> 'notes'
    THEN jsonb_set(item, '{notes}', COALESCE(to_jsonb(pg_temp.tp_tidy_grade_note(item ->> 'notes')), 'null'::jsonb))
    ELSE item
  END
$$;

CREATE FUNCTION pg_temp.tp_tidy_snapshot_leave(item jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(item) <> 'object' THEN item
    ELSE item
      || CASE WHEN pg_temp.tp_is_auto_leave_note(item ->> 'notes') THEN jsonb_build_object('notes', '') ELSE '{}'::jsonb END
      || CASE WHEN pg_temp.tp_is_auto_leave_reason(item ->> 'reason') THEN jsonb_build_object('reason', 'إجازة (تسوية قديمة)') ELSE '{}'::jsonb END
  END
$$;

CREATE FUNCTION pg_temp.tp_tidy_snapshot_call(item jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(item) = 'object' AND pg_temp.tp_is_auto_call_note(item ->> 'category', item ->> 'notes')
    THEN jsonb_set(item, '{notes}', '""'::jsonb)
    ELSE item
  END
$$;

CREATE FUNCTION pg_temp.tp_tidy_snapshot_array(items jsonb, kind text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(items) IS DISTINCT FROM 'array' THEN items
    ELSE (
      SELECT COALESCE(jsonb_agg(
        CASE kind
          WHEN 'grade' THEN pg_temp.tp_tidy_snapshot_grade(entry)
          WHEN 'leave' THEN pg_temp.tp_tidy_snapshot_leave(entry)
          WHEN 'call' THEN pg_temp.tp_tidy_snapshot_call(entry)
          ELSE entry
        END
        ORDER BY position
      ), '[]'::jsonb)
      FROM jsonb_array_elements(items) WITH ORDINALITY AS element(entry, position)
    )
  END
$$;

CREATE FUNCTION pg_temp.tp_tidy_snapshot(doc jsonb, next_reason text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(doc) IS DISTINCT FROM 'object' THEN doc
    ELSE doc
      || CASE WHEN doc ? 'grades' THEN jsonb_build_object('grades', pg_temp.tp_tidy_snapshot_array(doc -> 'grades', 'grade')) ELSE '{}'::jsonb END
      || CASE WHEN doc ? 'studentLeaveGradeBackups' THEN jsonb_build_object('studentLeaveGradeBackups', pg_temp.tp_tidy_snapshot_array(doc -> 'studentLeaveGradeBackups', 'grade')) ELSE '{}'::jsonb END
      || CASE WHEN doc ? 'studentLeaves' THEN jsonb_build_object('studentLeaves', pg_temp.tp_tidy_snapshot_array(doc -> 'studentLeaves', 'leave')) ELSE '{}'::jsonb END
      || CASE WHEN doc ? 'studentCalls' THEN jsonb_build_object('studentCalls', pg_temp.tp_tidy_snapshot_array(doc -> 'studentCalls', 'call')) ELSE '{}'::jsonb END
      || CASE WHEN next_reason IS NOT NULL AND doc ? 'reason' THEN jsonb_build_object('reason', next_reason) ELSE '{}'::jsonb END
  END
$$;

-- A snapshot that is not valid JSON is left exactly as it is.
UPDATE "StudentEnrollmentArchive" archive
SET "snapshot" = tidy.doc::text
FROM (
  SELECT
    parsed.id,
    parsed.doc AS original,
    pg_temp.tp_tidy_snapshot(
      parsed.doc,
      CASE
        WHEN jsonb_typeof(parsed.doc) = 'object'
          AND parsed.doc ->> 'reason' = 'نقل الطالب من دورة ' || parsed."fromCourseId" || ' إلى دورة ' || COALESCE(parsed."toCourseId", '') || ' وبدء ملف جديد'
        THEN parsed.reason
      END
    ) AS doc
  FROM (
    SELECT id, reason, "fromCourseId", "toCourseId", pg_temp.tp_try_jsonb(snapshot) AS doc
    FROM "StudentEnrollmentArchive"
  ) parsed
  WHERE parsed.doc IS NOT NULL
) tidy
WHERE archive.id = tidy.id
  AND tidy.doc IS DISTINCT FROM tidy.original;
