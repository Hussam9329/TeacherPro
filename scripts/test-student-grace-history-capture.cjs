const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loaded = new Map();
function load(relative) {
  const file = path.resolve(relative);
  if (loaded.has(file)) return loaded.get(file).exports;
  const entry = { exports: {} };
  loaded.set(file, entry);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', js)((name) => {
    assert.notEqual(name, '@/lib/db', 'capture tests never access a real database');
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    if (name.startsWith('.')) return load(`${path.resolve(path.dirname(file), name)}.ts`);
    return require(name);
  }, entry, entry.exports);
  return entry.exports;
}

const { captureStudentGraceHistory } = load('src/lib/student-grace-history-server.ts');
const { isExamWithinStudentGraceWindow, getStudentGraceDaysRemaining } = load('src/lib/student-grace.ts');
const now = new Date('2026-09-24T10:00:00Z');
const endedStudent = { id: 'student', createdAt: '2026-08-01', accountingGraceDays: 0, gracePeriodStartDate: null, gracePeriodEndedAt: now };
const row = (id, date, overrides = {}) => ({
  studentId: 'student', status: 'ضمن فترة السماح', score: null,
  exam: { id, date: new Date(`${date}T00:00:00Z`) }, ...overrides,
});

function fixture() {
  const grades = [
    row('past', '2026-09-10'), row('today', '2026-09-24'), row('future', '2026-09-25'),
    row('trigger', '2026-09-11'), row('other-student', '2026-09-12', { studentId: 'someone-else' }),
    row('numeric', '2026-09-13', { status: 'درجة', score: 18 }),
    row('absence', '2026-09-14', { status: 'غائب' }),
    row('invalid-marker', '2026-09-15', { score: 8 }),
  ];
  const backups = [row('under-leave', '2026-09-16'), row('past', '2026-09-10'), row('future-backup', '2026-09-26')];
  const reads = [];
  const before = structuredClone({ grades, backups });
  const delegate = (name, rows) => new Proxy({}, { get(_target, operation) {
    assert.equal(operation, 'findMany', 'capture must never mutate a record');
    return async ({ where, select }) => {
      assert.deepEqual(where, { studentId: 'student', status: 'ضمن فترة السماح', score: null });
      assert.deepEqual(select, { exam: { select: { id: true, date: true } } });
      reads.push(name);
      return rows.filter((r) => Object.entries(where).every(([key, value]) => r[key] === value))
        .map(({ exam }) => ({ exam }));
    };
  } });
  return { client: { grade: delegate('grades', grades), studentLeaveGradeBackup: delegate('backups', backups) }, reads, grades, backups, before };
}

(async () => {
  const f = fixture();
  const history = await captureStudentGraceHistory(f.client, endedStudent, { now, includeToday: false, excludeExamId: 'trigger' });
  assert.deepEqual(f.reads.sort(), ['backups', 'grades']);
  assert.equal(history.length, 3, 'exactly three known past/today exams survive; duplicate backup is deduplicated');
  const student = { ...endedStudent, gracePeriodHistory: history };
  for (const [id, date] of [['past', '2026-09-10'], ['today', '2026-09-24'], ['under-leave', '2026-09-16']]) {
    assert.equal(isExamWithinStudentGraceWindow(student, { id, date }), true, id);
    assert.equal(isExamWithinStudentGraceWindow(student, { id: `${id}-unrelated`, date }), false,
      'a marker must never protect another exam on the same day');
    assert.equal(isExamWithinStudentGraceWindow(student, { date }), false,
      'an unknown exam id cannot claim exam-specific entitlement');
  }
  for (const [id, date] of [['future', '2026-09-25'], ['future-backup', '2026-09-26'], ['trigger', '2026-09-11'], ['other-student', '2026-09-12'], ['numeric', '2026-09-13'], ['absence', '2026-09-14'], ['invalid-marker', '2026-09-15']]) {
    assert.equal(isExamWithinStudentGraceWindow(student, { id, date }), false, id);
  }
  assert.equal(isExamWithinStudentGraceWindow(student, { id: 'past', date: '2026-09-11' }), false,
    'moving an exam date does not move its captured entitlement');
  assert.equal(getStudentGraceDaysRemaining(student, now), 0, 'history never reopens the current counter');
  assert.deepEqual({ grades: f.grades, backups: f.backups }, f.before, 'capture must leave all source rows untouched');

  const active = { ...endedStudent, accountingGraceDays: 6, gracePeriodStartDate: '2026-09-20', gracePeriodEndedAt: null };
  const retained = await captureStudentGraceHistory(f.client, active, { now, includeToday: false, excludeExamId: 'trigger' });
  const terminated = { ...active, gracePeriodEndedAt: now, gracePeriodHistory: retained };
  assert.equal(isExamWithinStudentGraceWindow(terminated, { id: 'ordinary-prior', date: '2026-09-23' }), true);
  assert.equal(isExamWithinStudentGraceWindow(terminated, { id: 'ordinary-today', date: '2026-09-24' }), false,
    'today is retained only for an actual recorded marker when numeric entry ends grace');

  const failing = fixture();
  failing.client.studentLeaveGradeBackup = { findMany: async () => { throw new Error('read failed'); } };
  await assert.rejects(() => captureStudentGraceHistory(failing.client, endedStudent, { now }), /read failed/,
    'a failed evidence read must abort the caller instead of returning incomplete history');
  console.log('Grace history capture behavior passed: exact exam/date scope, leave backups, future exclusion, trigger exclusion, unchanged data, failure propagation.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
