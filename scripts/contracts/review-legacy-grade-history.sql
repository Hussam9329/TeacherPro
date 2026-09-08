-- Preserve historical grades. A current enrollment mismatch cannot prove a bad
-- historical grade; overlapping leaves likewise do not justify deleting scores.
BEGIN;
INSERT INTO "AuditLog" (id,module,action,details,"time")
SELECT 'p2_legacy_grade_history_review','صيانة النظام','جرد درجات النقل والإجازات مع حفظ التاريخ',
 jsonb_build_object(
 'disposition','Preserve grade history; exclude different current course and respect current leave rules. No automatic promotion of pending smart notes.',
 'crossCourseGrades',(SELECT jsonb_agg(jsonb_build_object('gradeId',g.id,'studentId',s.id,'studentCourseId',s."courseId",'examId',e.id,'examCourseIds',e."courseIds",'gradeStatus',g.status,'score',g.score)) FROM "Grade" g JOIN "Student" s ON s.id=g."studentId" JOIN "Exam" e ON e.id=g."examId" WHERE NOT (e."courseIds"::jsonb ? s."courseId")),
 'numericGradesCoveredByLeave',(SELECT jsonb_agg(DISTINCT jsonb_build_object('gradeId',g.id,'studentId',s.id,'examId',e.id,'score',g.score)) FROM "Grade" g JOIN "Student" s ON s.id=g."studentId" JOIN "Exam" e ON e.id=g."examId" JOIN "StudentLeave" l ON l."studentId"=s.id AND (l."leaveType"='exam' AND l."examId"=e.id OR l."leaveType"='period' AND (e.date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date BETWEEN (COALESCE(l."dateFrom",l.date) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date AND (COALESCE(l."dateTo",l."dateFrom",l.date) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date) WHERE g.status='درجة' AND s.status<>'مؤرشف')
 )::text,CURRENT_TIMESTAMP
ON CONFLICT (id) DO NOTHING;
COMMIT;
