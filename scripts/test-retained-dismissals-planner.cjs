const assert = require('node:assert/strict');
const { buildPlan, classifyStudent } = require('./plan-retained-dismissals-repair.cjs');

function fixture() {
  const dismissalReason = 'مخالفة بعد انتهاء الفرص - غياب في امتحان يومي: امتحان قديم';
  const student = { id: 's', code: 'TEST', courseId: 'course', status: 'مفصول', opportunities: 0,
    dismissalReason, baseOpportunities: 3, gracePeriods: [], createdAt: '2026-06-01',
    _rowHash: 'student-hash', _sourceHashes: { Grade: 'g', OpportunityLog: 'l', StudentLeave: 'v', StudentNote: 'n', GradeSmartNote: 's' } };
  const oldExam = { id: 'old-exam', name: 'امتحان قديم', courseIds: '["course"]', type: 'يومي', date: '2026-09-05',
    fullMark: 20, passMark: 10, discountMark: 7, opportunitiesPenalty: '1', active: true, noDiscount: false,
    dismissalGrade: null, examCourses: [{ courseId: 'course', chapterId: 'old' }] };
  const currentExam = { ...oldExam, id: 'current-exam', name: 'امتحان حالي', date: '2026-09-12', opportunitiesPenalty: '2',
    examCourses: [{ courseId: 'course', chapterId: 'current' }] };
  const grade = { id: 'old-grade', studentId: 's', examId: oldExam.id, status: 'غائب', score: null,
    academicEffectExcluded: false, createdAt: '2026-09-06', updatedAt: '2026-09-06' };
  const evidence = { id: 'false-dismissal', studentId: 's', examId: oldExam.id, action: 'فصل تلقائي', amount: 0,
    reason: 'تلقائي: ' + dismissalReason, date: oldExam.date, chapterId: null };
  return {
    capturedAt: '2026-09-17', students: [student], exams: [oldExam, currentExam],
    grades: [grade, { ...grade, id: 'new-grade', examId: currentExam.id, createdAt: '2026-09-14', updatedAt: '2026-09-14' }],
    opportunityLogs: [evidence], studentNotes: [], studentLeaves: [], smartNotes: [],
    chapters: [{ id: 'old', name: 'الفصل السابق', opportunities: 3 }, { id: 'current', name: 'الفصل الحالي', opportunities: 3 }],
    courseChapters: [{ id: 'old-link', courseId: 'course', chapterId: 'old', active: false, archived: false,
      archive: [{ studentId: 's', opportunities: 0, date: '2026-09-13' }] },
    { id: 'new-link', courseId: 'course', chapterId: 'current', active: true, archived: false, archive: [] }],
    priorCorrections: [{ id: 'prior-proof', time: '2026-09-10', _rowHash: 'audit-hash', details: JSON.stringify({ studentId: 's',
      before: { status: 'مفصول', opportunities: 0, dismissalReason }, after: { status: 'نشط', opportunities: 2 },
      removedLogs: [evidence] }) }],
    fingerprints: { Exam: 'e', ExamCourse: 'ec', CourseChapter: 'cc', Chapter: 'c' },
  };
}

const source = fixture();
const before = JSON.stringify(source);
const plan = buildPlan(source);
assert.equal(plan.items.length, 1);
const item = plan.items[0];
assert.deepEqual(item.after, { status: 'نشط', opportunities: 1, dismissalReason: '' });
assert.equal(item.originResult.opportunities, 2);
assert.equal(item.insertLogs.length, 1);
assert.equal(item.insertLogs[0].amount, 2);
assert.equal(item.insertLogs[0].chapterId, 'current');
assert.deepEqual(item.removeLogIds, ['false-dismissal']);
assert.equal(item.ordinaryReplayStable, true);
assert.equal(item.newBalanceGrant, false);
assert.equal(JSON.stringify(source), before, 'the dry run must not mutate the snapshot');
assert.deepEqual(plan.expected.Grade, [{ studentId: 's', hash: 'g' }]);
assert.equal(item.evidence.priorCorrectionAuditHash, 'audit-hash');

const noPrior = fixture(); noPrior.priorCorrections = [];
assert.equal(buildPlan(noPrior).items.length, 0);
assert.equal(buildPlan(noPrior).additionalCandidates.length, 1, 'outsiders remain separately reviewable');

const renamed = fixture();
const historical = JSON.parse(renamed.priorCorrections[0].details);
historical.before.dismissalReason = historical.before.dismissalReason.replace('امتحان قديم', 'عنوان سابق');
renamed.priorCorrections[0].details = JSON.stringify(historical);
assert.equal(buildPlan(renamed).items.length, 0, 'a guessed old title cannot join the audited repair cohort');
renamed.renameAudits = [{ id: 'old-title-proof', _rowHash: 'title-proof-hash',
  details: JSON.stringify({ examId: 'old-exam', examName: 'عنوان سابق' }) }];
const renamedItem = buildPlan(renamed).items[0];
assert.equal(renamedItem.evidence.renamedExamAuditId, 'old-title-proof');
assert.equal(renamedItem.evidence.renamedExamAuditHash, 'title-proof-hash');
renamed.renameAudits[0].details = JSON.stringify({ examId: 'unrelated-exam', examName: 'عنوان سابق' });
assert.equal(buildPlan(renamed).items.length, 0, 'a title audit must belong to the exact cause exam');

const manual = fixture(); manual.studentNotes.push({ id: 'manual', studentId: 's', kind: 'إجراء',
  text: 'فصل الطالب بقرار إداري', date: '2026-09-06' });
assert.equal(classifyStudent(manual, manual.students[0]).classification, 'manual-dismissal-override');

const legitimate = fixture();
for (let i = 1; i <= 3; i++) {
  legitimate.exams.push({ ...legitimate.exams[0], id: 'other-old-' + i, date: `2026-09-0${i}`, name: 'خصم سابق ' + i });
  legitimate.grades.push({ ...legitimate.grades[0], id: 'other-grade-' + i, examId: 'other-old-' + i,
    createdAt: `2026-09-0${i}`, updatedAt: `2026-09-0${i}` });
}
legitimate.smartNotes.push({ id: 'pending', studentId: 's', examId: 'old-exam', category: 'DISMISSED_PENDING', status: 'PENDING', score: 20 });
const retained = classifyStudent(legitimate, legitimate.students[0]);
assert.equal(retained.classification, 'legitimate-origin-chapter-dismissal', 'a new chapter cannot erase a proved legitimate earlier dismissal');
assert.deepEqual(retained.reviewPendingGrades, ['pending'], 'a pending grade is reported but never promoted');

const newer = fixture();
for (let i = 1; i <= 3; i++) {
  newer.exams.push({ ...newer.exams[1], id: 'later-' + i, date: `2026-09-${13 + i}` });
  newer.grades.push({ ...newer.grades[1], id: 'later-grade-' + i, examId: 'later-' + i,
    createdAt: `2026-09-${14 + i}`, updatedAt: `2026-09-${14 + i}` });
}
assert.equal(classifyStudent(newer, newer.students[0]).classification, 'legitimate-current-chapter-dismissal');

const edited = fixture(); edited.grades[0].updatedAt = '2026-09-16';
assert.equal(classifyStudent(edited, edited.students[0]).classification, 'origin-grade-edited-after-transition', 'current scores cannot be mistaken for an unchanged historical snapshot');
const missingBoundary = fixture(); missingBoundary.courseChapters[0].archive = [];
assert.equal(classifyStudent(missingBoundary, missingBoundary.students[0]).classification, 'missing-origin-transition-boundary');
const ambiguous = fixture(); ambiguous.courseChapters[0].active = true;
assert.equal(classifyStudent(ambiguous, ambiguous.students[0]).classification, 'ambiguous-active-chapter');
const noEvidence = fixture(); noEvidence.opportunityLogs = [];
assert.equal(classifyStudent(noEvidence, noEvidence.students[0]).classification, 'no-exact-automatic-dismissal-evidence');

const missedTransition = fixture();
missedTransition.students[0].code = 'BIO-663';
missedTransition.priorCorrections = [];
missedTransition.transitionEvidence = [{ id: 'actual-transition', _rowHash: 'transition-hash',
  studentId: 'another-student', courseId: 'course', chapterId: 'current', examId: null,
  action: 'إعادة تعيين', amount: 3, balanceAfter: 3, ledgerVersion: 2,
  reason: 'تسوية تاريخية: تحويل فصل يدوي', date: '2026-09-13T13:22:45.012Z' }];
const transitionPlan = buildPlan(missedTransition);
assert.equal(transitionPlan.items.length, 1);
const transitioned = transitionPlan.items[0];
assert.equal(transitioned.after.opportunities, 1);
assert.equal(transitioned.evidence.kind, 'missing-chapter-transition');
assert.equal(transitioned.evidence.sourceTransitionLogHash, 'transition-hash');
assert.equal(transitioned.balanceCheckpoint.id, 'retained_dismissal_20260917_v1_checkpoint_s');
assert.equal(transitioned.balanceCheckpoint.date, missedTransition.transitionEvidence[0].date);
assert.equal(transitioned.balanceCheckpoint.reason, missedTransition.transitionEvidence[0].reason);
assert.equal(transitioned.balanceCheckpoint.settledGradeIds, '[]', 'no existing grade is frozen by the opening-balance correction');
for (const key of ['requestedAmount', 'appliedAmount', 'balanceBefore', 'reversalOfLogId']) {
  assert.equal(transitioned.balanceCheckpoint[key], null);
}
assert.equal(transitioned.insertLogs[0].amount, 2, 'the real current-exam penalty survives the opening checkpoint');
const improved = structuredClone(missedTransition);
improved.grades[1].status = 'درجة'; improved.grades[1].score = 20;
assert.equal(buildPlan(improved).items[0].after.opportunities, 3, 'later correction of a current grade remains effective');
const noTransitionProof = structuredClone(missedTransition); delete noTransitionProof.transitionEvidence[0]._rowHash;
assert.equal(buildPlan(noTransitionProof).items.length, 0);
const alreadySettled = structuredClone(missedTransition);
alreadySettled.opportunityLogs.push({ ...missedTransition.transitionEvidence[0], studentId: 's' });
assert.equal(buildPlan(alreadySettled).items.length, 0, 'an existing current-chapter reset cannot be silently overwritten');

const positiveArchive = fixture();
positiveArchive.students[0].code = 'BIO-915'; positiveArchive.priorCorrections = [];
positiveArchive.courseChapters[0].archive[0].opportunities = 2;
assert.equal(buildPlan(positiveArchive).items[0].evidence.kind, 'verified-historical-replay');
positiveArchive.courseChapters[0].archive[0].opportunities = 1;
assert.equal(buildPlan(positiveArchive).items.length, 0, 'archive evidence must agree with the historical replay');

console.log('PASS: retained-dismissal planner requires historical and current proof, preserves real dismissals/manual decisions/pending grades, computes earned balance, proves ordinary replay stability and never writes to a database');
