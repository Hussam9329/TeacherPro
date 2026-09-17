WITH targets AS (SELECT id FROM "Student" WHERE status='مفصول')
SELECT jsonb_build_object(
 'capturedAt',CURRENT_TIMESTAMP,
 'students',(SELECT jsonb_agg((to_jsonb(s)-ARRAY['phone','phoneKey','parentPhone','telegram','telegramKey','school']) || jsonb_build_object('_rowHash',md5(to_jsonb(s)::text), '_sourceHashes',jsonb_build_object(
   'Grade',(SELECT md5(coalesce(string_agg(to_jsonb(g)::text,',' ORDER BY id),'')) FROM "Grade" g WHERE g."studentId"=s.id),
   'OpportunityLog',(SELECT md5(coalesce(string_agg(to_jsonb(l)::text,',' ORDER BY id),'')) FROM "OpportunityLog" l WHERE l."studentId"=s.id),
   'StudentLeave',(SELECT md5(coalesce(string_agg(to_jsonb(l)::text,',' ORDER BY id),'')) FROM "StudentLeave" l WHERE l."studentId"=s.id),
   'StudentNote',(SELECT md5(coalesce(string_agg(to_jsonb(n)::text,',' ORDER BY id),'')) FROM "StudentNote" n WHERE n."studentId"=s.id),
   'GradeSmartNote',(SELECT md5(coalesce(string_agg(to_jsonb(n)::text,',' ORDER BY id),'')) FROM "GradeSmartNote" n WHERE n."studentId"=s.id)
 )) ORDER BY s.id) FROM "Student" s WHERE s.id IN (SELECT id FROM targets)),
 'grades',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY id),'[]') FROM "Grade" g WHERE "studentId" IN (SELECT id FROM targets)),
 'opportunityLogs',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY date,id),'[]') FROM "OpportunityLog" l WHERE "studentId" IN (SELECT id FROM targets)),
 'studentLeaves',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') FROM "StudentLeave" l WHERE "studentId" IN (SELECT id FROM targets)),
 'studentNotes',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM "StudentNote" n WHERE "studentId" IN (SELECT id FROM targets)),
 'smartNotes',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM "GradeSmartNote" n WHERE "studentId" IN (SELECT id FROM targets)),
 'exams',(SELECT coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('examCourses',(SELECT coalesce(jsonb_agg(to_jsonb(ec) ORDER BY id),'[]') FROM "ExamCourse" ec WHERE ec."examId"=e.id)) ORDER BY e.id),'[]') FROM "Exam" e),
 'courseChapters',(SELECT jsonb_agg((to_jsonb(cc)-'archive') || jsonb_build_object('_rowHash',md5(to_jsonb(cc)::text),'archive',(SELECT coalesce(jsonb_agg(entry),'[]') FROM jsonb_array_elements(coalesce(nullif(cc.archive,''),'[]')::jsonb) entry WHERE entry->>'studentId' IN (SELECT id FROM targets)),'chapter',(SELECT to_jsonb(c) FROM "Chapter" c WHERE c.id=cc."chapterId")) ORDER BY cc.id) FROM "CourseChapter" cc),
 'chapters',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM "Chapter" c),
 'courses',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id) FROM "Course"),
 'priorCorrections',(SELECT coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('_rowHash',md5(to_jsonb(a)::text)) ORDER BY id),'[]') FROM "AuditLog" a WHERE a.id LIKE 'chapter_scope_20260910_v2_%'),
 'renameAudits',(SELECT coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('_rowHash',md5(to_jsonb(a)::text)) ORDER BY id),'[]') FROM "AuditLog" a WHERE a.id IN ('cmtfxjyuo001ald045890gvp6','cmthqc62p0004ld04988urit7')),
 'transitionEvidence',(SELECT coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('_rowHash',md5(to_jsonb(l)::text),'courseId',s."courseId") ORDER BY l.id),'[]') FROM "OpportunityLog" l JOIN "Student" s ON s.id=l."studentId" WHERE l.id IN ('cmtzugdrc017djn048wur93of','cmtzujawi0003jv044r3kdvfk')),
 'fingerprints',jsonb_build_object(
   'Student',(SELECT md5(coalesce(string_agg(to_jsonb(s)::text,',' ORDER BY id),'')) FROM "Student" s),
   'Grade',(SELECT md5(coalesce(string_agg(to_jsonb(g)::text,',' ORDER BY id),'')) FROM "Grade" g),
   'Exam',(SELECT md5(coalesce(string_agg(to_jsonb(e)::text,',' ORDER BY id),'')) FROM "Exam" e),
   'ExamCourse',(SELECT md5(coalesce(string_agg(to_jsonb(e)::text,',' ORDER BY id),'')) FROM "ExamCourse" e),
   'CourseChapter',(SELECT md5(coalesce(string_agg(to_jsonb(e)::text,',' ORDER BY id),'')) FROM "CourseChapter" e),
   'Chapter',(SELECT md5(coalesce(string_agg(to_jsonb(e)::text,',' ORDER BY id),'')) FROM "Chapter" e)
 )
) AS snapshot;
