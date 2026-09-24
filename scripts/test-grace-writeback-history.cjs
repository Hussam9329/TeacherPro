const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const forbidden = () => { throw new Error('This local test must not connect to a database or use server recalculation.'); };
const mocks = new Map([
  ['@/lib/db', { db: new Proxy({}, { get: forbidden }) }],
  ['@/lib/serializable-transaction', { withSerializableTransaction: forbidden }],
  ['@/lib/academic-recalculate-server', { recalculateStudentsAcademicState: forbidden }],
  ['@/lib/student-leave-grade-override-server', { endLeavesCoveringExamForGrade: forbidden }],
]);
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
    if (mocks.has(name)) return mocks.get(name);
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    if (name.startsWith('.')) return load(`${path.resolve(path.dirname(file), name)}.ts`);
    return require(name);
  }, entry, entry.exports);
  return entry.exports;
}

const { syncAcademicGradeWriteback } = load('src/lib/academic-grade-writeback-server.ts');
const { recalculateAcademicState } = load('src/lib/academic-engine.ts');
const { parseGraceDateOnly, isExamWithinStudentGraceWindow, getStudentGraceDaysRemaining } = load('src/lib/student-grace.ts');

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'studentId_examId') return matches(row, value);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
}
function select(row, selection) {
  if (!row) return null;
  if (!selection) return structuredClone(row);
  return Object.fromEntries(Object.entries(selection).filter(([, value]) => value).map(([key, value]) => [
    key, value === true ? structuredClone(row[key]) : select(row[key], value.select),
  ]));
}

function fixture() {
  // Actual writeback uses the clock. Relative Baghdad days keep these cases
  // inside grace without freezing timers or depending on a particular year.
  const today = parseGraceDateOnly(new Date());
  const day = (offset) => new Date(today.getTime() + offset * 86400000);
  const student = {
    id: 'student', courseId: 'course', status: 'نشط', createdAt: day(-20),
    accountingGraceDays: 6, gracePeriodStartDate: day(-2), gracePeriodEndedAt: null,
    gracePeriodHistory: [], opportunities: 3, baseOpportunities: 3,
    dismissalReason: '', dismissalNotes: '', mainSite: null, subSite: null, locationScope: null,
  };
  const makeExam = (id, offset) => ({
    id, name: id, type: 'يومي', date: day(offset), courseIds: '["course"]', mainSite: '',
    fullMark: 20, passMark: 10, discountMark: 7, opportunitiesPenalty: 1,
    dismissalGrade: null, noDiscount: false, active: true, scheduledActivateAt: null,
    examCourses: [{ courseId: 'course', chapterId: 'chapter' }],
  });
  const exams = [makeExam('trigger', 0), makeExam('prior-marker', -1), makeExam('legacy-marker', -10), makeExam('prior-absence', -2), makeExam('after-end', 0), makeExam('pre-registration', -21)];
  const grades = ['prior-marker', 'legacy-marker'].map((examId) => ({
    id: `grade-${examId}`, studentId: 'student', examId,
    status: 'ضمن فترة السماح', score: null, notes: 'تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان',
    academicEffectExcluded: false, smartNoteId: null, createdAt: day(-1), updatedAt: day(-1),
  }));
  grades.push({ id: 'absence', studentId: 'student', examId: 'prior-absence', status: 'غائب', score: null, academicEffectExcluded: false, smartNoteId: null, createdAt: day(-2), updatedAt: day(-2) });
  let studentUpdates = 0;
  const client = {
    student: {
      async findUnique({ where, select: selection }) { return matches(student, where) ? select(student, selection) : null; },
      async updateMany({ where, data }) {
        if (!matches(student, where)) return { count: 0 };
        studentUpdates += 1;
        Object.assign(student, structuredClone(data));
        return { count: 1 };
      },
    },
    exam: { async findUnique({ where, select: selection }) { return select(exams.find((row) => matches(row, where)), selection); } },
    studentLeave: { async findFirst() { return null; } },
    studentLeaveGradeBackup: { async findMany() { return []; } },
    gradeSmartNote: { async updateMany() { return { count: 0 }; } },
    grade: {
      async findMany({ where, select: selection }) {
        return grades.filter((row) => matches(row, where)).map((row) => select({ ...row, exam: exams.find((exam) => exam.id === row.examId) }, selection));
      },
      async findUnique({ where, select: selection }) { return select(grades.find((row) => matches(row, where)), selection); },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of grades) if (matches(row, where)) { Object.assign(row, structuredClone(data)); count += 1; }
        return { count };
      },
      async upsert({ where, update, create }) {
        let row = grades.find((entry) => matches(entry, where));
        if (row) Object.assign(row, structuredClone(update), { updatedAt: new Date() });
        else {
          row = { id: `new-${grades.length}`, academicEffectExcluded: false, smartNoteId: null, createdAt: new Date(), updatedAt: new Date(), ...structuredClone(create) };
          grades.push(row);
        }
        return structuredClone(row);
      },
    },
  };
  const write = (examId, status, score) => syncAcademicGradeWriteback({
    tx: client, studentId: student.id, examId, status, score,
    deferAcademicRecalculation: true, enforceExamAvailability: true,
  });
  const calculate = () => recalculateAcademicState({
    students: [{ ...student, createdAt: student.createdAt.toISOString(), gracePeriodStartDate: student.gracePeriodStartDate?.toISOString(), gracePeriodEndedAt: student.gracePeriodEndedAt?.toISOString() }],
    exams: exams.map((exam) => ({ ...exam, date: exam.date.toISOString(), courseIds: ['course'] })),
    grades: grades.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
    courseChapters: [{ id: 'link', courseId: 'course', chapterId: 'chapter', active: true, archived: false }],
    chapters: [{ id: 'chapter', name: 'الفصل', opportunities: 3 }],
    opportunityLogs: [], studentLeaves: [], studentNotes: [],
  }, new Set([student.id]));
  return { student, exams, grades, write, calculate, studentUpdates: () => studentUpdates };
}

(async () => {
  const current = fixture();
  const originalMarkers = structuredClone(current.grades.filter((grade) => grade.status === 'ضمن فترة السماح'));
  const first = await current.write('trigger', 'درجة', 0);
  assert.equal(first.graceEnded, true, 'zero is a real score and must end current grace');
  assert.equal(current.student.accountingGraceDays, 0);
  assert.equal(current.student.gracePeriodStartDate, null);
  assert.ok(current.student.gracePeriodEndedAt instanceof Date);
  assert.equal(first.grade.academicEffectExcluded, false);
  assert.equal(getStudentGraceDaysRemaining(current.student), 0);
  assert.deepEqual(current.grades.filter((grade) => grade.status === 'ضمن فترة السماح'), originalMarkers);
  for (const id of ['prior-marker', 'legacy-marker', 'prior-absence']) {
    assert.equal(isExamWithinStudentGraceWindow(current.student, current.exams.find((exam) => exam.id === id)), true, `${id} must retain known history`);
  }
  let computed = current.calculate();
  assert.equal(computed.students[0].opportunities, 2);
  assert.deepEqual(computed.opportunityLogs.map((row) => row.examId), ['trigger']);
  const savedHistory = structuredClone(current.student.gracePeriodHistory);
  const savedEnd = current.student.gracePeriodEndedAt.getTime();
  const repeat = await current.write('trigger', 'درجة', 0);
  assert.equal(repeat.graceEnded, false, 'replay must not reterminate grace');
  assert.equal(current.studentUpdates(), 1);
  assert.deepEqual(current.student.gracePeriodHistory, savedHistory);
  assert.equal(current.student.gracePeriodEndedAt.getTime(), savedEnd);
  assert.equal(current.calculate().students[0].opportunities, 2);
  for (const id of ['prior-marker', 'legacy-marker', 'prior-absence']) {
    await assert.rejects(current.write(id, 'غائب', null), (error) => error.status === 409 && error.message.includes('ضمن فترة السماح'));
  }
  const afterEnd = await current.write('after-end', 'غائب', null);
  assert.equal(afterEnd.grade.status, 'غائب');
  computed = current.calculate();
  assert.equal(computed.students[0].opportunities, 1);
  assert.deepEqual(computed.opportunityLogs.map((row) => row.examId).sort(), ['after-end', 'trigger']);

  const historical = fixture();
  const preExam = historical.exams.find((exam) => exam.id === 'pre-registration');
  const backdated = await historical.write('pre-registration', 'درجة', 0);
  assert.equal(backdated.registrationBackdated, true);
  assert.equal(historical.student.createdAt.getTime(), preExam.date.getTime());
  assert.equal(historical.student.accountingGraceDays, 0);
  assert.equal(getStudentGraceDaysRemaining(historical.student), 0);
  assert.equal(backdated.grade.academicEffectExcluded, false);
  for (const id of ['prior-marker', 'legacy-marker', 'prior-absence']) {
    assert.equal(isExamWithinStudentGraceWindow(historical.student, historical.exams.find((exam) => exam.id === id)), true);
  }
  const backdatedState = historical.calculate();
  assert.equal(backdatedState.students[0].opportunities, 2);
  assert.deepEqual(backdatedState.opportunityLogs.map((row) => row.examId), ['pre-registration']);
  console.log('PASS: actual numeric-grade writeback captures grace history, counts its trigger, preserves historical protection, handles retry, and backdates pre-registration grades without losing history.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
