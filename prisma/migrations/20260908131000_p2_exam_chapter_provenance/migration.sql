BEGIN;
ALTER TABLE "Exam" ADD COLUMN "createdAt" TIMESTAMP(3), ADD COLUMN "createdAtSource" TEXT NOT NULL DEFAULT 'unknown';
UPDATE "Exam" e SET "createdAt" = evidence.first_at, "createdAtSource" = 'first-grade-evidence'
FROM (SELECT "examId", MIN("createdAt") AS first_at FROM "Grade" GROUP BY "examId") evidence WHERE e.id = evidence."examId";
ALTER TABLE "Exam" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP, ALTER COLUMN "createdAtSource" SET DEFAULT 'recorded';
ALTER TABLE "ExamCourse" ADD COLUMN "chapterId" TEXT REFERENCES "Chapter"(id) ON DELETE RESTRICT,
 ADD COLUMN "chapterSource" TEXT NOT NULL DEFAULT 'unknown';
-- Only single-chapter courses provide unambiguous historical membership.
UPDATE "ExamCourse" ec SET "chapterId"=c.chapter_id, "chapterSource"='single-course-chapter'
FROM (SELECT "courseId", MIN("chapterId") chapter_id FROM "CourseChapter" GROUP BY "courseId" HAVING COUNT(DISTINCT "chapterId")=1) c
WHERE ec."courseId"=c."courseId";
-- Freeze reviewed historical membership with provenance; preserve unknowns.
UPDATE "ExamCourse" ec SET "chapterId"=v.chapter_id, "chapterSource"=v.source FROM (VALUES
('ex_mqhgtwrt_i2vns5','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqhgua6f_um1jmj','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqhguw13_a12w21','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqhgxyg0_v09drw','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mr3gse17_0qcvvy','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmr9727oz0000js04irpm2v5m','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqnqllfg_uq9zeq','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqp4akpf_pwaaoz','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqs22nmb_h94a1f','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmtppnemd0000jj04boni2ewu','c_mqgtscvr_2wqgue','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmrdhhgnq0002l704dlnb3kd9','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrhv4q81001sl904diy34az2','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrnn0y560003le042fze9ttr','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrruik5j0003l804m65dl91e','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrxlijen0002l5044ylah1vt','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cms3bpagu0020ju04eyo02nc8','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmsuxc4ww0000jl04s6w2iku4','c_mqgtscvr_2wqgue','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmsvv62lo0000l504uho3ut58','c_mqgtscvr_2wqgue','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmt1hhkgn001yl104jdoy85hg','c_mqgtscvr_2wqgue','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmt5v5isy0004ib0451fhhj0y','c_mqgtscvr_2wqgue','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmtbjihcm0000ih04eekwljty','c_mqgtscvr_2wqgue','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmsnbgea70003jy04tc1sba3t','c_mqgtscvr_2wqgue','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmtlhvwav0006l80489lmcc6k','c_mqgtscvr_2wqgue','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmtfxjyhy0000ld04567sc7pc','c_mqgtscvr_2wqgue','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('ex_mqjnb5x5_rh5j1c','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqnqmejd_xmx3t3','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmr9737kf0004jv04hvh8x9vc','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqjnc4sz_yk0zxr','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqjnctca_f48nyl','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqp468iy_7tewez','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmtppnemd0000jj04boni2ewu','c_mqgttc2y_rs6uwd','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('ex_mqs23uz9_cq0hle','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mqjnajzr_ja3gut','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrdh5c840000jm047s1lqpeh','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('ex_mr3gtkdf_qp4bay','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrhv2xwh001jl9044cx7awyb','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrnn2b780000l804m9qc6tku','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrrufwqz0000l604sbfh4woo','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrxljt9z0042l504ekz0bjzc','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cms3bmr3v0000ju04a3nf6s2v','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmsuxc4ww0000jl04s6w2iku4','c_mqgttc2y_rs6uwd','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmsvv62lo0000l504uho3ut58','c_mqgttc2y_rs6uwd','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmt1hhkgn001yl104jdoy85hg','c_mqgttc2y_rs6uwd','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmt5v5isy0004ib0451fhhj0y','c_mqgttc2y_rs6uwd','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmtbjihcm0000ih04eekwljty','c_mqgttc2y_rs6uwd','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmsnbfime0000jy04lgg3v0ah','c_mqgttc2y_rs6uwd','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmtlhvwav0006l80489lmcc6k','c_mqgttc2y_rs6uwd','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmtfxjyhy0000ld04567sc7pc','c_mqgttc2y_rs6uwd','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmtli0j21000ikv04t1omlb8g','c_mqry9o7z_78jc7b','cmst7zs8g0000kz04uxrkwkan','historical-title'),
('cmrdhic1y0005l704pg7g2don','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrhv1z3b0008l904gc4qbmqi','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrnmz0h90000le04oy91ln94','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrruhhp90000l804bdrpa8g8','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmrxlkwer0049l504tfjcnwsm','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cms3bofca0005ju04u6szecff','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmsnbimos000jjy04hmab917e','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmsuxgy0y0002jo04wezwoyuq','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmsvuhpbj001zjo04momw8mfm','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmt1hg0sx0000l104pb1asisz','c_mqry9o7z_78jc7b',NULL,'ambiguous-accounting-history'),
('cmt5v70lt000vib045sap03mi','c_mqry9o7z_78jc7b','ch_mqhfvbi1_6l36qw','historical-report-evidence'),
('cmtfz2tup0000l20432wijwub','c_mqry9o7z_78jc7b','cmst7zs8g0000kz04uxrkwkan','historical-report-evidence'),
('cmtpprtmx000rjj04mpg6giuq','c_mqry9o7z_78jc7b','cmst7zs8g0000kz04uxrkwkan','historical-title')
) v(exam_id,course_id,chapter_id,source) WHERE ec."examId"=v.exam_id AND ec."courseId"=v.course_id;
CREATE FUNCTION tp_assign_exam_chapter() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('teacherpro.restore_snapshot', true) = 'on' THEN RETURN NEW; END IF;
 IF NEW."chapterId" IS NULL THEN
  SELECT "chapterId" INTO NEW."chapterId" FROM "CourseChapter" WHERE "courseId"=NEW."courseId" AND active AND NOT archived;
  NEW."chapterSource" := CASE WHEN NEW."chapterId" IS NULL THEN 'unknown' ELSE 'active-at-assignment' END;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER tp_assign_exam_chapter BEFORE INSERT ON "ExamCourse" FOR EACH ROW EXECUTE FUNCTION tp_assign_exam_chapter();
COMMIT;
