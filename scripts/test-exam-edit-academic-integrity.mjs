#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const examsRoute = read('src/app/api/exams/route.ts');
const studentsRoute = read('src/app/api/students/route.ts');
const gradesRoute = read('src/app/api/grades/route.ts');
const gradesExport = read('src/app/api/grades/export/route.ts');
const examStats = read('src/app/api/exams/stats/route.ts');
const dashboardStats = read('src/app/api/stats/route.ts');
const engine = read('src/lib/academic-engine.ts');
const recalc = read('src/lib/academic-recalculate-server.ts');
const writeback = read('src/lib/academic-grade-writeback-server.ts');
const protectedMarkers = read('src/lib/protected-grade-markers-server.ts');
const dismissedMigration = read('src/lib/grade-smart-note-reactivation-server.ts');
const dismissedHistory = read('src/app/api/dismissed-students/history/route.ts');
const cronRoute = read('src/app/api/internal/academic-maintenance/route.ts');
const cronHelper = read('src/lib/scheduled-exam-activation-server.ts');
const repairRoute = read('src/app/api/internal/academic-integrity/protected-markers/route.ts');
const vercelConfig = read('vercel.json');

assert.match(examsRoute, /mainSite:\s*String\(exam\.mainSite/);
assert.match(examsRoute, /reconcileProtectedGradeMarkersForExamEdit\(tx, exam\.id\)/);
assert.match(examsRoute, /includeAbsent:\s*protectedScopeChanged/);
assert.match(examsRoute, /studentLeave\.findMany[\s\S]*leaveType:\s*'exam'/);
assert.match(examsRoute, /baghdadDateKey\(leave\.date\) === oldExamDay/);
assert.match(examsRoute, /StudentLeaveUpdateInput/);
assert.match(examsRoute, /gradeEntryMissingNote\.updateMany/);
assert.match(examsRoute, /opportunityLog\.findMany[\s\S]*reason:\s*\{ contains: oldName \}/);
assert.match(examsRoute, /split\(oldName\)\.join\(newName\)/);
assert.match(examsRoute, /gradeSmartNote\.aggregate/);
assert.match(examsRoute, /studentLeaveGradeBackup\.aggregate/);
console.log('✅ الاسم يزامن النصوص دون إعادة احتساب، وباقي التعديلات الأكاديمية تعيد المزامنة وتحمي fullMark');

assert.match(studentsRoute, /reconcileProtectedGradeMarkersForStudentAcademicEdit/);
assert.match(studentsRoute, /includeAbsent:\s*true/);
console.log('✅ تعديل تاريخ تسجيل الطالب/السماح يعالج العلامات القديمة بالاتجاهين');

assert.match(engine, /studentMatchesExamMainSites/);
assert.match(engine, /examA\?\.date/);
assert.match(engine, /exam\.date \|\| grade\.updatedAt/);
assert.match(recalc, /mainSite:\s*true/);
assert.match(recalc, /locationScope:\s*true/);
console.log('✅ المحرك الأكاديمي يرتب حسب تاريخ الامتحان ويحترم موقعه');

assert.match(protectedMarkers, /convertedToExcused/);
assert.match(protectedMarkers, /restoredFromLeaveBackup/);
assert.match(protectedMarkers, /removedStaleMarkers/);
assert.match(protectedMarkers, /reconcileProtectedGradeMarkersForStudentAcademicEdit/);
assert.match(protectedMarkers, /getExamEntryAvailability\(exam\)\.available/);
assert.match(protectedMarkers, /status: "مجاز"/);
assert.match(protectedMarkers, /isExamWithinStudentGraceWindow/);
assert.match(protectedMarkers, /isExamOnOrAfterStudentRegistration/);
console.log('✅ تاريخ الامتحان يصلح الإجازة/السماح/قبل التسجيل ويحوّل الحالة القديمة إلى غياب فقط إذا صار الامتحان مستحقاً');

assert.match(gradesRoute, /examSiteDatabaseValues/);
assert.match(gradesRoute, /startsWith: "خارج القطر"/);
assert.match(gradesExport, /examSiteDatabaseValues/);
assert.match(gradesRoute, /studentMatchesExamMainSites/);
assert.match(gradesExport, /studentMatchesExamMainSites/);
assert.match(examStats, /studentMatchesExamMainSites/);
assert.match(writeback, /الطالب ليس ضمن موقع هذا الامتحان/);
console.log('✅ التفاصيل والإحصائيات والتصدير وحفظ الدرجة تستخدم نطاق الدورة + الموقع نفسه');

assert.match(dismissedMigration, /exam:\s*\{\s*select:\s*\{\s*fullMark:\s*true/);
assert.match(dismissedMigration, /note\.score > Number\(note\.exam\.fullMark/);
console.log('✅ الدرجة المعلقة بعد الفصل لا يمكن ترحيلها فوق الدرجة الكاملة الحالية');

assert.match(dismissedHistory, /text\(exam\.name\) \|\| text\(note\.examNameSnapshot\)/);
console.log('✅ العرض التاريخي يفضل اسم الامتحان الحالي مع الاحتفاظ باللقطة القديمة داخلياً');

assert.match(cronRoute, /process\.env\.CRON_SECRET/);
assert.match(cronRoute, /settleDueScheduledExamActivations/);
assert.match(cronRoute, /reconcileExpiredGracePendingGrades/);
assert.match(cronHelper, /scheduledActivateAt:\s*\{ not: null, lte: now \}/);
assert.match(cronHelper, /data:\s*\{ active: true \}/);
assert.match(cronHelper, /recalculateStudentsForExam/);
assert.match(vercelConfig, /\/api\/internal\/academic-maintenance/);
assert.match(examsRoute, /settleDueScheduledExamActivations\(\{ batchSize: 5 \}\)/);
assert.match(dashboardStats, /settleDueScheduledExamActivations\(\{ batchSize: 5 \}\)/);
assert.match(vercelConfig, /0 0 \* \* \*/);
console.log('✅ التفعيل المجدول وانتهاء فترة السماح لهما صيانة يومية، مع تسوية كسولة للتفعيل عند استخدام النظام');

assert.match(repairRoute, /dryRun:\s*true/);
assert.match(repairRoute, /previewToken/);
assert.match(repairRoute, /requiresFreshPreview/);
assert.match(repairRoute, /reconcileProtectedGradeMarkersForExamEdit/);
assert.match(repairRoute, /filter\(\(candidate\) => candidate\.examId === examId\)/);
assert.match(repairRoute, /studentIds:\s*examStudentIds/);
assert.match(repairRoute, /repairProtectedAbsencesForStudents/);
assert.match(repairRoute, /recalculateStudentsAcademicState/);
console.log('✅ إصلاح البيانات القديمة Preview-first ولا يطبق على معاينة قديمة');

console.log('\nكل فحوصات سلامة تعديل الامتحان الأكاديمية نجحت.');
