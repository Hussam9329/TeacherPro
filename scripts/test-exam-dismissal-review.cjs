const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  return resolve.call(this, request.startsWith('@/')
    ? path.join(process.cwd(), 'src', request.slice(2)) : request, parent, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename,
);
const engine = require('../src/lib/academic-engine.ts');
const calculate = engine.recalculateAcademicState;
let reviewReplayCount = 0;
engine.recalculateAcademicState = (...args) => { reviewReplayCount++; return calculate(...args); };
const { recalculateWithExamEditReview } = require('../src/lib/exam-dismissal-review.ts');

function exam(id, day, extra = {}) {
  return { id, name: `امتحان ${id}`, type: 'يومي', date: `2026-09-${day}T08:00:00.000Z`,
    fullMark: 20, passMark: 10, discountMark: 7, opportunitiesPenalty: 1,
    dismissalGrade: null, noDiscount: false, active: true, courseIds: ['c'], mainSite: 'بغداد',
    examCourses: [{ courseId: 'c', chapterId: 'ch' }], ...extra };
}
function fixture(exams, { id = 's', cap = 3, gradeOverrides = {}, studentOverrides = {} } = {}) {
  return {
    students: [{ id, courseId: 'c', mainSite: 'بغداد', status: 'نشط', dismissalReason: '',
      opportunities: cap, baseOpportunities: cap, createdAt: '2026-06-01', accountingGraceDays: 0,
      ...studentOverrides }],
    exams,
    grades: exams.map(e => ({ id: `${id}-${e.id}`, studentId: id, examId: e.id, status: 'غائب',
      score: null, createdAt: e.date, updatedAt: e.date, ...(gradeOverrides[e.id] || {}) })),
    chapters: [{ id: 'ch', name: 'الحالي', opportunities: cap }],
    courseChapters: [{ id: 'cc', courseId: 'c', chapterId: 'ch', active: true, archived: false }],
    opportunityLogs: [], studentLeaves: [], studentNotes: [],
  };
}
function persist(state) {
  const result = calculate(state, new Set(state.students.map(s => s.id)));
  return { ...state, students: result.students, opportunityLogs: result.opportunityLogs };
}
function change(before, id, patch) {
  return { ...before, exams: before.exams.map(e => e.id === id ? { ...e, ...patch } : e) };
}
function review(before, current, id, targets = new Set(current.students.map(s => s.id))) {
  const original = structuredClone({ before, current });
  const ordinary = calculate(current, targets);
  reviewReplayCount = 0;
  const result = recalculateWithExamEditReview(current, targets, ordinary, before, id);
  assert.deepEqual({ before, current }, original, 'review never mutates either snapshot');
  const existingManual = new Map(current.opportunityLogs.filter(l => !engine.isAutomaticOpportunityLog(l)).map(l => [l.id, l]));
  for (const log of result.opportunityLogs.filter(l => !engine.isAutomaticOpportunityLog(l))) {
    assert.deepEqual(log, existingManual.get(log.id), 'no manual grant, reset or pledge is created or rewritten');
  }
  return { result, ordinary, replayCount: reviewReplayCount };
}
const student = result => result.students.find(s => s.id === 's');
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS:', name); }

test('direct final-exam cause restores the real positive balance without a grant', () => {
  const before = persist(fixture([exam('e9', '09', { type: 'فاينل', dismissalGrade: 7 })]));
  assert.equal(student(before).status, 'مفصول');
  const { result, ordinary, replayCount } = review(before, change(before, 'e9', { noDiscount: true }), 'e9');
  assert.equal(student(ordinary).status, 'مفصول', 'ordinary engine keeps its protection');
  assert.deepEqual([student(result).status, student(result).opportunities, student(result).dismissalReason], ['نشط', 3, '']);
  assert.equal(replayCount, 2);
  assert.equal(result.opportunityLogs.filter(engine.isAutomaticOpportunityLog).length, 0);
});

test('removing the fourth absence restores active status at exactly zero opportunities', () => {
  const before = persist(fixture([exam('e1', '01'), exam('e2', '02'), exam('e3', '03'), exam('e9', '09')]));
  assert.equal(student(before).status, 'مفصول');
  const { result } = review(before, change(before, 'e9', { noDiscount: true }), 'e9');
  assert.deepEqual([student(result).status, student(result).opportunities], ['نشط', 0]);
  assert.deepEqual(result.opportunityLogs.filter(engine.isAutomaticOpportunityLog).map(l => l.examId), ['e1', 'e2', 'e3']);
});

test('an earlier changed deduction can clear a later automatic dismissal', () => {
  const before = persist(fixture([exam('e1', '01'), exam('e2', '02'), exam('e3', '03'), exam('e9', '09')]));
  const { result } = review(before, change(before, 'e1', { noDiscount: true }), 'e1');
  assert.deepEqual([student(result).status, student(result).opportunities], ['نشط', 0]);
  assert.deepEqual(result.opportunityLogs.filter(engine.isAutomaticOpportunityLog).map(l => l.examId), ['e2', 'e3', 'e9']);
});

test('another remaining automatic cause prevents recovery', () => {
  const before = persist(fixture([exam('e9', '08', { type: 'فاينل' }), exam('other', '09', { type: 'فاينل' })]));
  const { result, ordinary } = review(before, change(before, 'e9', { noDiscount: true }), 'e9');
  assert.strictEqual(result, ordinary);
  assert.equal(student(result).status, 'مفصول');
  assert.match(student(result).dismissalReason, /other/);
});

test('a later explicit manual dismissal log or note overrides matching automatic evidence', () => {
  for (const kind of ['log', 'note']) {
    let before = persist(fixture([exam('e9', '09', { type: 'فاينل' })]));
    if (kind === 'log') before = { ...before, opportunityLogs: [...before.opportunityLogs,
      { id: 'manual', studentId: 's', examId: '', action: 'خصم', amount: 0, reason: 'فصل الطالب: قرار إداري', date: '2026-09-10', chapterId: 'ch' }] };
    else before = { ...before, studentNotes: [{ id: 'manual', studentId: 's', kind: 'إجراء', text: 'فصل الطالب: قرار إداري', date: '2026-09-10' }] };
    const { result, ordinary, replayCount } = review(before, change(before, 'e9', { noDiscount: true }), 'e9');
    assert.strictEqual(result, ordinary);
    assert.equal(student(result).status, 'مفصول');
    assert.equal(replayCount, 0);
  }
});

test('stored old dismissal evidence after a settlement is insufficient for recovery', () => {
  let before = persist(fixture([exam('e9', '09', { type: 'فاينل' })]));
  before = { ...before, opportunityLogs: [...before.opportunityLogs, {
    id: 'settled', studentId: 's', examId: '', action: 'إعادة تعيين', amount: 2,
    balanceAfter: 2, ledgerVersion: 2, settledGradeIds: '["s-e9"]', reason: 'رصيد مثبت', date: '2026-09-10', chapterId: 'ch',
  }] };
  const { result, ordinary, replayCount } = review(before, change(before, 'e9', { noDiscount: true }), 'e9');
  assert.strictEqual(result, ordinary);
  assert.equal(student(result).status, 'مفصول');
  assert.equal(replayCount, 1, 'the true old replay must reproduce the current cause before considering recovery');
});

test('editing an unrelated passing exam cannot recover a dismissed student', () => {
  const before = persist(fixture([exam('e1', '01'), exam('e9', '09', { type: 'فاينل' })], {
    gradeOverrides: { e1: { status: 'درجة', score: 20 } },
  }));
  const current = change(change(before, 'e1', { passMark: 11 }), 'e9', { noDiscount: true });
  const { result, ordinary } = review(before, current, 'e1');
  assert.strictEqual(result, ordinary, 'even if a separate change removes the cause, this exam must have contributed');
});

test('site and course edits use the actual old scope, rather than already-edited metadata', () => {
  for (const patch of [{ mainSite: 'محافظات' }, { courseIds: ['other'], examCourses: [{ courseId: 'other', chapterId: 'ch' }] }]) {
    const before = persist(fixture([exam('e9', '09', { type: 'فاينل' })]));
    const current = change(before, 'e9', patch);
    const { result } = review(before, current, 'e9');
    assert.deepEqual([student(result).status, student(result).opportunities], ['نشط', 3]);
  }
});

function pledgedHistoryFixture() {
  const original = fixture([exam('old', '01', { type: 'فاينل' }), exam('e2', '03'), exam('e3', '04'), exam('e9', '09')]);
  const oldResult = persist({ ...original, exams: [original.exams[0]], grades: [original.grades[0]] });
  const source = oldResult.opportunityLogs.find(l => l.action === 'فصل تلقائي');
  const pledge = { id: 'pledge', studentId: 's', examId: 'old', action: 'رصيد بعد تعهد', amount: 2,
    reason: 'إرجاع الطالب بعد تعهد ولي الأمر برصيد فرصتين ' + engine.encodeAcademicReactivationLink({
      sourceGradeId: 's-old', sourceExamId: 'old', sourceAutomaticLogId: source.id,
    }), date: '2026-09-02', chapterId: 'ch' };
  return persist({ ...original, opportunityLogs: [...oldResult.opportunityLogs, pledge] });
}

test('retained dismissal source from an old pledge does not block recovery from the new exam', () => {
  const before = pledgedHistoryFixture();
  assert.equal(student(before).status, 'مفصول');
  assert.match(student(before).dismissalReason, /e9/);
  assert.ok(before.opportunityLogs.some(l => l.examId === 'old' && l.action === 'فصل تلقائي'));
  const historical = before.opportunityLogs.filter(l => l.examId === 'old');
  const { result } = review(before, change(before, 'e9', { noDiscount: true }), 'e9');
  assert.deepEqual([student(result).status, student(result).opportunities], ['نشط', 0]);
  assert.deepEqual(result.opportunityLogs.filter(l => l.examId === 'old'), historical,
    'the original source evidence and pledge remain unchanged');
});

test('retained historical pledge-source logs cannot prove the edited exam contributed', () => {
  const before = pledgedHistoryFixture();
  // Deliberately remove the current cause while claiming an unrelated edit to
  // its older, already-exempted source: old stored evidence must not authorize.
  const current = change(change(before, 'old', { passMark: 11 }), 'e9', { noDiscount: true });
  const { result, ordinary } = review(before, current, 'old');
  assert.strictEqual(result, ordinary);
});

test('legacy reactivation stays tied to the earlier cause after a newer dismissal is recorded', () => {
  const original = fixture([exam('old', '01', { type: 'فاينل' }), exam('e2', '03'), exam('e3', '04'), exam('e9', '09')]);
  const source = persist({ ...original, exams: [original.exams[0]], grades: [original.grades[0]] });
  const legacy = [
    { id: 'legacy-reactivation', studentId: 's', examId: '', action: 'إعادة تفعيل', amount: 0,
      reason: 'تثبيت إعادة التفعيل: الطالب نشط برصيد فرصتين', date: '2026-09-02T12:00:00Z', chapterId: 'ch' },
    { id: 'legacy-balance', studentId: 's', examId: '', action: 'رصيد إعادة التفعيل', amount: 2,
      reason: 'إرجاع الطالب إلى الحالة النشطة برصيد فرصتين', date: '2026-09-02T12:00:01Z', chapterId: 'ch' },
  ];
  const before = persist({ ...original, opportunityLogs: [...source.opportunityLogs, ...legacy] });
  assert.equal(student(before).status, 'مفصول');
  assert.match(student(before).dismissalReason, /e9/);
  const seeded = { ...before, students: before.students.map(s => ({ ...s, status: 'نشط', dismissalReason: '' })) };
  const legacyReplay = calculate(seeded, new Set(['s']));
  assert.equal(student(legacyReplay).status, 'نشط', 'ordinary replay retains the previous legacy interpretation');
  const seededReplay = calculate(seeded, new Set(['s']), { respectLegacyReactivationDates: true });
  assert.equal(student(seededReplay).status, 'مفصول', 'new exam cannot be exempted by re-binding an older reactivation');
  assert.match(student(seededReplay).dismissalReason, /e9/);
  assert.equal(engine.findAcademicReactivationSourceForStudent(before, student(before)).sourceExamId, 'e9',
    'a current explicit manual recovery still selects the latest cause');
  before.opportunityLogs.push({ id: 'manual-add', studentId: 's', examId: '', action: 'إضافة', amount: 1,
    requestedAmount: 1, appliedAmount: 1, balanceBefore: 0, balanceAfter: 1, ledgerVersion: 2,
    reason: 'إضافة يدوية محفوظة', date: '2026-09-10', chapterId: 'ch' });
  const { result } = review(before, change(before, 'e9', { noDiscount: true }), 'e9');
  assert.deepEqual([student(result).status, student(result).opportunities], ['نشط', 1]);
  assert.deepEqual(result.opportunityLogs.filter(l => l.id.startsWith('legacy-')), legacy);
  assert.deepEqual(result.opportunityLogs.filter(l => l.examId === 'old'), source.opportunityLogs);
  const persisted = { ...change(before, 'e9', { noDiscount: true }),
    students: result.students, opportunityLogs: result.opportunityLogs };
  const laterReplay = calculate(persisted, new Set(['s']));
  assert.deepEqual([student(laterReplay).status, student(laterReplay).opportunities], ['نشط', 1],
    'ordinary replay after persistence must keep the recovered balance without rebinding the legacy source');
  const repeated = review(persisted, persisted, 'e9');
  assert.deepEqual(student(repeated.result), student(result), 'repeated unchanged save is stable');
  assert.equal(repeated.replayCount, 0);
});

test('legacy fallback grades cannot come from an exam after the reactivation day', () => {
  const original = fixture([exam('old', '01', { type: 'فاينل' }), exam('new', '09', { type: 'فاينل' })]);
  original.opportunityLogs = [{ id: 'legacy-balance', studentId: 's', examId: '', action: 'رصيد إعادة التفعيل', amount: 2,
    reason: 'إرجاع الطالب إلى الحالة النشطة برصيد فرصتين', date: '2026-09-02', chapterId: 'ch' }];
  const result = calculate(original, new Set(['s']), { respectLegacyReactivationDates: true });
  assert.equal(student(result).status, 'مفصول');
  assert.match(student(result).dismissalReason, /new/);
  assert.ok(!result.opportunityLogs.some(l => l.examId === 'old'), 'the older cause is the exempted source');
});

test('an existing explicit source link keeps its identity without legacy date inference', () => {
  const original = fixture([exam('old', '01', { type: 'فاينل' }), exam('new', '09', { type: 'فاينل' })]);
  original.opportunityLogs = [{ id: 'explicit-balance', studentId: 's', examId: '', action: 'رصيد بعد تعهد', amount: 2,
    reason: 'بعد تعهد ' + engine.encodeAcademicReactivationLink({ sourceExamId: 'new', sourceGradeId: 's-new' }),
    date: '2026-09-02', chapterId: 'ch' }];
  const result = calculate(original, new Set(['s']), { respectLegacyReactivationDates: true });
  assert.deepEqual([student(result).status, student(result).opportunities], ['نشط', 2]);
  assert.deepEqual(result.opportunityLogs, original.opportunityLogs);
});

test('date change with a rewritten protection marker requires true pre-edit grades', () => {
  const before = persist(fixture([exam('e9', '09', { type: 'فاينل' })], {
    studentOverrides: { createdAt: '2026-09-05' },
  }));
  const current = { ...change(before, 'e9', { date: '2026-09-01T08:00:00.000Z' }),
    grades: before.grades.map(g => ({ ...g, status: 'قبل تسجيل الطالب' })) };
  const { result } = review(before, current, 'e9');
  assert.deepEqual([student(result).status, student(result).opportunities], ['نشط', 3]);
  const reconstructedOld = { ...current, exams: before.exams };
  const unsafe = review(reconstructedOld, current, 'e9');
  assert.strictEqual(unsafe.result, unsafe.ordinary, 'post-edit markers cannot prove the old cause');
});

test('historical chapter evidence and mismatched reasons cannot authorize recovery', () => {
  for (const tamper of ['chapter', 'reason']) {
    let before = persist(fixture([exam('e9', '09', { type: 'فاينل' })]));
    before = tamper === 'chapter'
      ? { ...before, opportunityLogs: before.opportunityLogs.map(l => ({ ...l, chapterId: 'old' })) }
      : { ...before, students: before.students.map(s => ({ ...s, dismissalReason: 'قرار إداري' })) };
    const { result, ordinary, replayCount } = review(before, change(before, 'e9', { noDiscount: true }), 'e9');
    assert.strictEqual(result, ordinary);
    assert.equal(replayCount, 0);
  }
});

test('batch review changes only proved target students and preserves unrelated result records', () => {
  const first = fixture([exam('e9', '09', { type: 'فاينل' })]);
  const count = 150;
  const combined = { ...first,
    students: Array.from({ length: count }, (_, i) => ({ ...first.students[0], id: `s${i}` })),
    grades: Array.from({ length: count }, (_, i) => ({ ...first.grades[0], id: `g${i}`, studentId: `s${i}` })),
  };
  let before = persist(combined);
  before = { ...before, students: before.students.map(s => s.id === 's149' ? { ...s, status: 'مؤرشف' } : s) };
  const current = change(before, 'e9', { noDiscount: true });
  const targets = new Set(before.students.filter(s => !['s148', 's149'].includes(s.id)).map(s => s.id));
  const { result, ordinary, replayCount } = review(before, current, 'e9', targets);
  assert.equal(replayCount, 2, 'all 148 candidates use one old and one new replay');
  for (const s of result.students) {
    if (targets.has(s.id)) assert.deepEqual([s.status, s.opportunities], ['نشط', 3]);
    else assert.strictEqual(s, ordinary.students.find(item => item.id === s.id));
  }
  for (const id of ['s148', 's149']) assert.deepEqual(result.opportunityLogs.filter(l => l.studentId === id),
    ordinary.opportunityLogs.filter(l => l.studentId === id));
});

console.log(`PASS: ${checks} exam-dismissal review scenarios against the real academic engine.`);
