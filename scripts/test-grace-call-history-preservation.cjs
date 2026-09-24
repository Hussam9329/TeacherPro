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
    assert.notEqual(name, '@/lib/db', 'the local regression test must never access a real database');
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    if (name.startsWith('.')) return load(`${path.resolve(path.dirname(file), name)}.ts`);
    return require(name);
  }, entry, entry.exports);
  return entry.exports;
}

const { repairProtectedAbsencesForStudents } = load('src/lib/grace-period-repair-server.ts');

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((condition) => matches(row, condition));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
}

function fixture() {
  const student = {
    createdAt: new Date('2026-09-01T00:00:00Z'),
    accountingGraceDays: 6,
    gracePeriodStartDate: new Date('2026-09-05T00:00:00Z'),
    gracePeriodEndedAt: null,
  };
  const grade = (id, date, overrides = {}) => ({
    id, studentId: 'student', examId: id, status: 'غائب', score: null,
    notes: 'تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم',
    student: structuredClone(student), exam: { date: new Date(date) }, ...overrides,
  });
  const grades = [
    grade('grace-exam', '2026-09-06T00:00:00Z'),
    grade('pre-registration-exam', '2026-08-30T00:00:00Z'),
    grade('unprotected-exam', '2026-09-12T00:00:00Z'),
    grade('numeric-exam', '2026-09-07T00:00:00Z', { status: 'درجة', score: 17, notes: 'درجة حقيقية' }),
    grade('other-student-exam', '2026-09-07T00:00:00Z', { studentId: 'other-student' }),
  ];
  const calls = [];
  for (const examId of ['grace-exam', 'pre-registration-exam', 'unprotected-exam']) {
    calls.push({
      id: `note-${examId}`, studentId: 'student', examId,
      category: 'call-student-note', notes: `ملاحظة أصلية ${examId}`,
      noteResolved: examId === 'grace-exam', noteRevision: 7,
      createdAt: new Date('2026-09-03T12:00:00Z'),
    }, {
      id: `action-${examId}`, studentId: 'student', examId,
      category: 'legacy-absence', status: 'تم الاتصال', completed: true,
      completedAt: new Date('2026-09-03T12:00:00Z'), notes: 'تواصل مسجل مع ولي الأمر',
    });
  }
  calls.push({
    id: 'general-note', studentId: 'student', examId: null,
    category: 'call-student-note', notes: 'ملاحظة عامة قديمة',
    noteResolved: true, noteRevision: 3,
  });
  const beforeCalls = structuredClone(calls);
  const beforeGrades = structuredClone(grades);
  const client = {
    grade: {
      async findMany({ where }) { return grades.filter((row) => matches(row, where)); },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of grades) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    // No deletion/update is legitimate here: candidate visibility is derived
    // from grades, while StudentCall contains original staff work.
    studentCall: new Proxy({}, {
      get(_target, operation) {
        throw new Error(`Grace repair must not access StudentCall.${String(operation)}`);
      },
    }),
  };
  return { client, grades, calls, beforeCalls, beforeGrades };
}

(async () => {
  for (const deleteCalls of [undefined, false, true]) {
    const data = fixture();
    const options = deleteCalls === undefined ? {} : { deleteCalls };
    const result = await repairProtectedAbsencesForStudents(data.client, ['student'], options);
    assert.equal(result.convertedGrades, 1);
    assert.equal(result.convertedBeforeRegistration, 1);
    assert.equal(result.deletedCalls, 0);
    assert.equal(data.grades[0].status, 'ضمن فترة السماح');
    assert.equal(data.grades[1].status, 'قبل تسجيل الطالب');
    assert.deepEqual(data.grades.slice(2), data.beforeGrades.slice(2), 'unprotected/numeric/other-student grades must survive unchanged');
    assert.deepEqual(data.calls, data.beforeCalls, 'all text, shared checked state, revision, dates, and contact history must survive');
    const replay = await repairProtectedAbsencesForStudents(data.client, ['student'], options);
    assert.equal(replay.convertedGrades, 0);
    assert.equal(replay.convertedBeforeRegistration, 0);
    assert.equal(replay.deletedCalls, 0);
    assert.deepEqual(data.calls, data.beforeCalls);
  }

  const scoped = fixture();
  const result = await repairProtectedAbsencesForStudents(scoped.client, ['student'], { examIds: ['grace-exam'] });
  assert.equal(result.convertedGrades, 1);
  assert.equal(result.convertedBeforeRegistration, 0);
  assert.deepEqual(scoped.grades.slice(1), scoped.beforeGrades.slice(1), 'exam-scoped repair must not change other exams');
  assert.deepEqual(scoped.calls, scoped.beforeCalls);
  console.log('PASS: grace and pre-registration repair preserve original notes, shared checked state, and manual contact history, including legacy deleteCalls callers and retries.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
