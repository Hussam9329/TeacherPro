const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');

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

const grace = load('src/lib/student-grace.ts');
const { recalculateAcademicState } = load('src/lib/academic-engine.ts');
const { reconcileProtectedGradeMarkersForStudentAcademicEdit, ensureProtectedGradeMarkers } = load('src/lib/protected-grade-markers-server.ts');

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((condition) => matches(row, condition));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
}

function select(row, selection) {
  if (!selection) return { ...row };
  return Object.fromEntries(Object.entries(selection).filter(([, value]) => value).map(([key, value]) => [
    key, value === true ? row[key] : select(row[key], value.select),
  ]));
}

// Dates are intentionally in the past so missing-grade materialization does
// not depend on the wall-clock day when CI runs this test.
function fixture({ missingFirstGrade = false, secondExam = false } = {}) {
  const student = {
    id: 'student', courseId: 'course', status: 'نشط',
    createdAt: new Date('2020-06-01T00:00:00Z'), accountingGraceDays: 6,
    gracePeriodStartDate: new Date('2020-09-05T00:00:00Z'),
    gracePeriodEndedAt: null, gracePeriodHistory: [],
    opportunities: 3, baseOpportunities: 3, dismissalReason: '', dismissalNotes: '',
    mainSite: null, subSite: null, locationScope: null,
  };
  const makeExam = (id, date) => ({
    id, name: id, type: 'يومي', date: new Date(date), courseIds: '["course"]',
    mainSite: '', fullMark: 20, passMark: 10, discountMark: 7,
    opportunitiesPenalty: 1, dismissalGrade: null, noDiscount: false, active: true,
    examCourses: [{ courseId: 'course', chapterId: 'chapter' }],
  });
  const exams = [makeExam('first', '2020-09-06T00:00:00Z')];
  if (secondExam) exams.push(makeExam('second', '2020-09-15T00:00:00Z'));
  let grades = missingFirstGrade ? [] : [{
    id: 'grade-first', studentId: student.id, examId: 'first',
    status: 'ضمن فترة السماح', score: null, academicEffectExcluded: false,
    notes: 'تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان',
    createdAt: new Date('2020-09-06T00:00:00Z'), updatedAt: new Date('2020-09-06T00:00:00Z'),
  }];
  let nextId = 0;
  const client = {
    student: { async findMany({ select: selection }) { return [select(student, selection)]; } },
    exam: {
      async findUnique({ where, select: selection }) { return select(exams.find((row) => matches(row, where)), selection); },
      async findMany({ select: selection }) { return exams.map((row) => select(row, selection)); },
    },
    studentLeave: { async findMany() { return []; } },
    studentLeaveGradeBackup: { async findMany() { return []; } },
    grade: {
      async findMany({ where = {}, select: selection } = {}) {
        return grades.filter((row) => matches(row, where)).map((row) => select({
          ...row, student, exam: exams.find((exam) => exam.id === row.examId),
        }, selection));
      },
      async delete({ where }) { grades = grades.filter((row) => !matches(row, where)); },
      async createMany({ data }) {
        grades.push(...data.map((row) => ({ ...row, id: `generated-${++nextId}`, createdAt: new Date(), updatedAt: new Date() })));
        return { count: data.length };
      },
    },
  };
  const calculate = () => recalculateAcademicState({
    students: [{ ...student, createdAt: student.createdAt.toISOString(), gracePeriodStartDate: student.gracePeriodStartDate?.toISOString(), gracePeriodEndedAt: student.gracePeriodEndedAt?.toISOString() }],
    exams: exams.map((exam) => ({ ...exam, date: exam.date.toISOString(), courseIds: ['course'] })),
    grades: grades.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
    courseChapters: [{ id: 'link', courseId: 'course', chapterId: 'chapter', active: true, archived: false }],
    chapters: [{ id: 'chapter', name: 'الفصل', opportunities: 3 }],
    opportunityLogs: [], studentLeaves: [], studentNotes: [],
  }, new Set([student.id]));
  const renew = (date, days = 6) => {
    student.gracePeriodHistory = grace.preserveStudentGraceHistory(student, { now: new Date(date) });
    student.accountingGraceDays = days;
    student.gracePeriodStartDate = new Date(date);
    student.gracePeriodEndedAt = null;
  };
  return { student, exams, client, calculate, renew, grades: () => grades };
}

(async () => {
  const saved = fixture();
  assert.equal(saved.calculate().students[0].opportunities, 3);
  saved.renew('2020-09-24T00:00:00Z');
  const reconciliation = await reconcileProtectedGradeMarkersForStudentAcademicEdit(saved.client, ['student']);
  const materialized = await ensureProtectedGradeMarkers(saved.client, { studentIds: ['student'], includeAbsent: true });
  assert.equal(reconciliation.removedStaleMarkers, 0);
  assert.equal(materialized.createdAbsent, 0);
  assert.equal(saved.grades()[0].status, 'ضمن فترة السماح');
  assert.equal(saved.calculate().students[0].opportunities, 3, 'renewal cannot charge an old protected exam');

  const missing = fixture({ missingFirstGrade: true, secondExam: true });
  missing.renew('2020-09-14T00:00:00Z');
  missing.renew('2020-09-24T00:00:00Z');
  const created = await ensureProtectedGradeMarkers(missing.client, { studentIds: ['student'], includeAbsent: true });
  assert.equal(created.createdGrace, 2, 'both past grants protect exams even if no marker was saved at the time');
  assert.equal(created.createdAbsent, 0);
  assert.equal(missing.calculate().students[0].opportunities, 3);
  assert.equal(grace.getStudentGraceDaysRemaining(missing.student, new Date('2020-09-24T10:00:00Z')), 6, 'history must not extend the current counter');
  assert.equal(grace.getStudentGraceDaysRemaining(missing.student, new Date('2020-09-30T00:00:00Z')), 0);
  missing.student.gracePeriodEndedAt = new Date('2020-09-25T00:00:00Z');
  assert.equal(grace.getStudentGraceDaysRemaining(missing.student, new Date('2020-09-25T10:00:00Z')), 0, 'history alone never restarts a counter');
  assert.equal(grace.isExamWithinStudentGraceWindow(missing.student, missing.exams[0]), true);

  const cancelled = fixture();
  cancelled.student.gracePeriodHistory = grace.preserveStudentGraceHistory(cancelled.student, { now: new Date('2020-09-07T10:00:00Z') });
  cancelled.student.accountingGraceDays = 0;
  cancelled.student.gracePeriodStartDate = null;
  assert.equal(grace.isExamWithinStudentGraceWindow(cancelled.student, { id: 'past', date: '2020-09-06' }), true);
  assert.equal(grace.isExamWithinStudentGraceWindow(cancelled.student, { id: 'today', date: '2020-09-07' }), true);
  assert.equal(grace.isExamWithinStudentGraceWindow(cancelled.student, { id: 'future', date: '2020-09-08' }), false, 'cancelled future entitlement must not leak into history');

  const shortened = fixture();
  shortened.student.gracePeriodHistory = grace.preserveStudentGraceHistory(shortened.student, { now: new Date('2020-09-07T10:00:00Z') });
  shortened.student.accountingGraceDays = 3;
  assert.equal(grace.isExamWithinStudentGraceWindow(shortened.student, { id: 'elapsed', date: '2020-09-07' }), true);
  assert.equal(grace.isExamWithinStudentGraceWindow(shortened.student, { id: 'cancelled-future', date: '2020-09-09' }), false);

  const numeric = fixture({ missingFirstGrade: true, secondExam: true });
  numeric.exams[1].date = new Date('2020-09-06T00:00:00Z');
  numeric.student.gracePeriodHistory = grace.preserveStudentGraceHistory(numeric.student, {
    now: new Date('2020-09-07T10:00:00Z'), includeToday: false, excludeExamId: 'first',
  });
  numeric.student.accountingGraceDays = 0;
  numeric.student.gracePeriodStartDate = null;
  numeric.student.gracePeriodEndedAt = new Date('2020-09-07T10:00:00Z');
  numeric.grades().push(
    { id: 'trigger', studentId: 'student', examId: 'first', status: 'درجة', score: 0, createdAt: new Date(), updatedAt: new Date() },
    { id: 'prior-absence', studentId: 'student', examId: 'second', status: 'غائب', score: null, createdAt: new Date(), updatedAt: new Date() },
  );
  const endedResult = numeric.calculate();
  assert.equal(grace.isExamWithinStudentGraceWindow(numeric.student, numeric.exams[0]), false, 'the triggering score must remain chargeable');
  assert.equal(grace.isExamWithinStudentGraceWindow(numeric.student, numeric.exams[1]), true, 'another exam on the same previous day remains protected');
  assert.equal(endedResult.students[0].opportunities, 2);
  assert.deepEqual(endedResult.opportunityLogs.map((row) => row.examId), ['first']);

  const calendar = fixture().student;
  assert.equal(grace.getStudentGraceDaysRemaining(calendar, new Date('2020-09-04T20:59:59Z')), 0);
  assert.equal(grace.getStudentGraceDaysRemaining(calendar, new Date('2020-09-04T21:00:00Z')), 6);
  assert.equal(grace.getStudentGraceDaysRemaining(calendar, new Date('2020-09-10T20:59:59Z')), 1);
  assert.equal(grace.getStudentGraceDaysRemaining(calendar, new Date('2020-09-10T21:00:00Z')), 0);
  assert.equal(grace.isExamWithinStudentGraceWindow(calendar, { date: '2020-09-10' }), true);
  assert.equal(grace.isExamWithinStudentGraceWindow(calendar, { date: '2020-09-11' }), false);
  assert.equal(grace.parseGraceStartDateInput('2026-02-31'), null);
  assert.equal(grace.parseGraceStartDateInput('2026-02-29'), null);
  assert.equal(grace.parseGraceStartDateInput('2024-02-29').toISOString(), '2024-02-29T00:00:00.000Z');
  assert.deepEqual(grace.normalizeStudentGraceHistory([{ start: '2026-02-31', endExclusive: '2026-03-10' }]), []);

  const migration = fs.readFileSync('prisma/migrations/20260924150000_student_grace_history/migration.sql', 'utf8');
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE "Student" (id text PRIMARY KEY, status text, opportunities integer, "accountingGraceDays" integer, "gracePeriodStartDate" timestamptz, "gracePeriodEndedAt" timestamptz);
      INSERT INTO "Student" VALUES ('active','نشط',2,6,'2026-09-24',NULL),('dismissed','مفصول',0,0,NULL,'2026-09-23');`);
    const before = (await pg.query('SELECT * FROM "Student" ORDER BY id')).rows;
    await pg.exec(migration);
    const after = (await pg.query('SELECT * FROM "Student" ORDER BY id')).rows;
    assert.deepEqual(after.map(({ gracePeriodHistory, ...row }) => row), before, 'additive migration cannot change balances, status, dates or grace settings');
    assert.deepEqual(after.map((row) => row.gracePeriodHistory), [[], []]);
    await pg.exec(`INSERT INTO "Student" (id,status,opportunities) VALUES ('new','نشط',3)`);
    assert.deepEqual((await pg.query(`SELECT "gracePeriodHistory" FROM "Student" WHERE id='new'`)).rows[0].gracePeriodHistory, []);
  } finally {
    await pg.close();
  }
  console.log('PASS: repeated grace renewals preserve historical protection and balances; missing historical rows, cancellation, numeric activation, Baghdad boundaries and additive migration are safe.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
