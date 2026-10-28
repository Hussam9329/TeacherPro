// «سجل الدرجات»: a classified filter decided over lean rows must return exactly
// the grades the full-row classification returns, in the same order, for every
// filter, with and without settlement exclusions. The classifier may only read
// fields the lean selects load; a new field read fails this test.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
process.env.TZ = 'UTC';
const root = process.cwd(), resolve = Module._resolveFilename, load = Module._load, mocks = new Map();
Module._resolveFilename = function (r, p, ...a) { return resolve.call(this, r.startsWith('@/') ? path.join(root, 'src', r.slice(2)) : r, p, ...a); };
Module._load = function (r, p, ...a) { return mocks.has(r) ? mocks.get(r) : load.call(this, r, p, ...a); };
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);

// Deterministic fixture.
let seed = 20261028;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (items) => items[Math.floor(rand() * items.length)];
const day = (offset) => new Date(Date.UTC(2026, 5, 1 + offset, 9, 0, 0));

const tables = { student: [], exam: [], examCourse: [], grade: [], studentLeave: [], gracePeriod: [], opportunityLog: [], courseChapter: [] };
const courses = ['c1', 'c2', 'c3'];
tables.courseChapter.push({ courseId: 'c1', chapterId: 'ch1', active: true, archived: false }, { courseId: 'c2', chapterId: 'ch2', active: true, archived: false });
for (let i = 0; i < 16; i++) {
  const type = pick(['يومي', 'يومي', 'اسبوعي', 'فاينل']);
  const fullMark = pick([10, 20, 50, 100]);
  const examCourses = courses.filter(() => rand() < 0.6);
  if (!examCourses.length) examCourses.push('c1');
  const inactive = rand() < 0.15;
  tables.exam.push({
    id: `e${i}`, name: `exam ${i}`, type, date: day(i * 3), fullMark,
    passMark: Math.round(fullMark * 0.5), discountMark: Math.round(fullMark * 0.25),
    dismissalGrade: type === 'فاينل' ? Math.round(fullMark * 0.1) : null,
    noDiscount: rand() < 0.15, active: !inactive, scheduledActivateAt: inactive && rand() < 0.5 ? day(400) : null,
    courseIds: JSON.stringify(examCourses), mainSite: 'الكل', opportunitiesPenalty: '1',
  });
  for (const courseId of examCourses) tables.examCourse.push({ examId: `e${i}`, courseId, chapterId: pick(['ch1', 'ch2', null]) });
}
for (let i = 0; i < 70; i++) {
  tables.student.push({ id: `s${i}`, name: `student ${i}`, code: `${1000 + i}`, status: pick(['نشط', 'نشط', 'مفصول']), courseId: pick(courses), createdAt: day(Math.floor(rand() * 30)), phone: '0770', opportunities: 3 });
  if (rand() < 0.25) tables.gracePeriod.push({ id: `gp${i}`, studentId: `s${i}`, startDate: day(Math.floor(rand() * 40)), endDate: day(40 + Math.floor(rand() * 10)), cancelledAt: rand() < 0.3 ? day(1) : null });
  if (rand() < 0.2) tables.studentLeave.push({ id: `l${i}`, studentId: `s${i}`, examId: `e${Math.floor(rand() * 16)}`, leaveType: 'exam', reason: 'x', date: day(0), dateFrom: null, dateTo: null });
  if (rand() < 0.15) { const from = Math.floor(rand() * 40); tables.studentLeave.push({ id: `lp${i}`, studentId: `s${i}`, examId: null, leaveType: 'period', reason: 'x', date: day(from), dateFrom: day(from), dateTo: day(from + 5) }); }
}
let updated = 0;
for (const student of tables.student) {
  for (const exam of tables.exam) {
    if (rand() < 0.35) continue;
    const status = pick(['درجة', 'درجة', 'درجة', 'درجة', 'غائب', 'غش', 'مجاز', 'قبل تسجيل الطالب']);
    const score = status === 'درجة' ? (rand() < 0.03 ? null : rand() < 0.12 ? exam.fullMark : Math.floor(rand() * (exam.fullMark + 1))) : null;
    tables.grade.push({
      id: `g${tables.grade.length}`, studentId: student.id, examId: exam.id, status, score,
      notes: pick([null, '', null, 'تسوية تاريخية بلا أثر: x', 'أثر أكاديمي فعّال بعد التسوية: x']),
      academicEffectExcluded: rand() < 0.05, academicEffectExclusionReason: null, academicEffectExclusionSource: null,
      academicAccountingChecked: false, smartNoteId: null, createdAt: day(0), updatedAt: new Date(Date.UTC(2026, 9, 1) + (updated++) * 7919 % 100000 * 1000),
    });
  }
}
for (const student of tables.student.filter(() => rand() < 0.2)) {
  const own = tables.grade.filter((grade) => grade.studentId === student.id).slice(0, 3).map((grade) => grade.id);
  tables.opportunityLog.push({ id: `ol-${student.id}`, studentId: student.id, action: 'إعادة تعيين', ledgerVersion: 2, settledGradeIds: JSON.stringify(own), reason: 'r', date: day(20), chapterId: pick(['ch1', 'ch2', null]) });
}
for (const student of tables.student.filter(() => rand() < 0.15)) {
  tables.opportunityLog.push({ id: `legacy-${student.id}`, studentId: student.id, action: 'تعديل', ledgerVersion: null, settledGradeIds: null, reason: 'تسوية تاريخية: x', date: day(15), chapterId: null });
}

// A small Prisma-shaped client over the fixture: the where/select/orderBy forms
// these code paths use.
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return condition.every((part) => matches(row, part));
    if (key === 'OR') return condition.some((part) => matches(row, part));
    const value = row[key];
    if (condition === null || typeof condition !== 'object' || condition instanceof Date) return value === condition;
    if ('in' in condition) return condition.in.includes(value);
    if ('not' in condition) return value !== condition.not;
    if ('startsWith' in condition) return String(value ?? '').startsWith(condition.startsWith);
    throw new Error(`unsupported condition on ${key}: ${JSON.stringify(condition)}`);
  });
}
function project(table, row, select) {
  if (!select) return { ...row };
  const out = {};
  for (const [key, wanted] of Object.entries(select)) {
    if (!wanted) continue;
    if (key === 'examCourses' && table === 'exam') out.examCourses = tables.examCourse.filter((link) => link.examId === row.id).map((link) => project('examCourse', link, wanted.select));
    else if (typeof wanted === 'object') throw new Error(`unsupported nested select ${table}.${key}`);
    else out[key] = row[key];
  }
  return out;
}
function compare(a, b, orderBy) {
  for (const order of [].concat(orderBy || [])) {
    const [[key, direction]] = Object.entries(order);
    const x = a[key] instanceof Date ? a[key].getTime() : a[key], y = b[key] instanceof Date ? b[key].getTime() : b[key];
    if (x === y) continue;
    return (x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1);
  }
  return 0;
}
const reads = { grade: 0 };
const db = Object.fromEntries(Object.keys(tables).map((table) => [table, {
  findMany: async ({ where, select, orderBy } = {}) => {
    if (table === 'grade') reads.grade++;
    return tables[table].filter((row) => matches(row, where)).sort((a, b) => compare(a, b, orderBy)).map((row) => project(table, row, select));
  },
}]));
mocks.set('@/lib/db', { db });

const { gradeMatchesStatusFilterUnified } = require('../src/lib/grade-classification.ts');
const { annotateGradeSettlementEffects } = require('../src/lib/grade-settlement-server.ts');
const { loadActiveGracePeriodsByStudent } = require('../src/lib/grace-periods-server.ts');
const lean = require('../src/lib/grade-status-filter-server.ts');

// The classifier's reads on full rows are recorded, then checked against the lean selects.
const touched = { grade: new Set(), student: new Set(), leave: new Set() };
const watch = (kind, object) => new Proxy(object, { get(target, key, receiver) { if (typeof key === 'string') touched[kind].add(key); return Reflect.get(target, key, receiver); } });

/** What the route did before: every grade with its full student, leaves and exam. */
async function fullRowReference(where, filter, withSettlements) {
  const grades = tables.grade.filter((row) => matches(row, where)).sort((a, b) => compare(a, b, [{ updatedAt: 'desc' }, { id: 'asc' }])).map((row) => ({ ...row }));
  const periods = await loadActiveGracePeriodsByStudent(db, grades.map((grade) => grade.studentId));
  const rows = grades.map((grade) => ({
    ...grade,
    exam: { ...tables.exam.find((exam) => exam.id === grade.examId) },
    student: {
      ...tables.student.find((student) => student.id === grade.studentId),
      studentLeaves: tables.studentLeave.filter((leave) => leave.studentId === grade.studentId).map((leave) => ({ ...leave })),
      gracePeriods: periods.get(grade.studentId) || [],
    },
  }));
  if (withSettlements) await annotateGradeSettlementEffects(rows);
  return rows.filter((grade) => gradeMatchesStatusFilterUnified(filter, watch('grade', grade), grade.exam, {
    student: watch('student', grade.student),
    leaves: grade.student.studentLeaves.map((leave) => watch('leave', leave)),
  })).map((grade) => grade.id);
}

(async () => {
  const scopes = [{}, { examId: 'e3' }, { studentId: { in: ['s1', 's2', 's3', 's4', 's5'] } }];
  let compared = 0;
  for (const filter of lean.CLASSIFIED_GRADE_FILTERS) {
    for (const where of scopes) {
      for (const withSettlements of [true, false]) {
        const expected = await fullRowReference(where, filter, withSettlements);
        const actual = (await lean.findGradesMatchingStatusFilter(where, filter, { withSettlements })).map((grade) => grade.id);
        assert.deepEqual(actual, expected, `${filter} ${JSON.stringify(where)} settlements=${withSettlements}`);
        if (where === scopes[0]) assert.ok(expected.length > 0 || filter === 'excused', `the fixture exercises ${filter}`);
        compared += expected.length;
      }
    }
  }
  console.log(`PASS: every classified filter matches the full-row classification (${compared} matches compared, same order)`);

  // The fixture reaches the protected cases, so the comparison above means something.
  const kinds = new Set();
  const { classifyGradeAcademicImpact } = require('../src/lib/grade-classification.ts');
  const periods = await loadActiveGracePeriodsByStudent(db, tables.student.map((student) => student.id));
  const annotated = tables.grade.map((grade) => ({ ...grade }));
  await annotateGradeSettlementEffects(annotated);
  for (const grade of annotated) {
    const student = tables.student.find((row) => row.id === grade.studentId);
    kinds.add(classifyGradeAcademicImpact(grade, tables.exam.find((exam) => exam.id === grade.examId), {
      student: { ...student, gracePeriods: periods.get(student.id) || [] },
      leaves: tables.studentLeave.filter((leave) => leave.studentId === student.id),
    }));
  }
  for (const kind of ['academic-effect-excluded', 'excused', 'grace-period', 'before-registration', 'unavailable-exam', 'cheating', 'absent-deducted', 'discounted', 'academic-accounting', 'failed', 'passed', 'full-mark', 'no-discount-protected']) {
    assert.ok(kinds.has(kind), `the fixture reaches «${kind}»`);
  }
  console.log(`PASS: the fixture reaches ${kinds.size} classification kinds, including every protected one`);

  const allowed = (select) => new Set(Object.keys(select));
  for (const key of touched.grade) if (!['exam', 'student', 'effectiveImpactExcluded', 'effectiveImpactExclusionReason'].includes(key)) assert.ok(allowed(lean.CLASSIFIER_GRADE_SELECT).has(key), `the classifier reads grade.${key}, which the lean select does not load`);
  for (const key of touched.student) if (key !== 'gracePeriods') assert.ok(allowed(lean.CLASSIFIER_STUDENT_SELECT).has(key), `the classifier reads student.${key}, which the lean select does not load`);
  for (const key of touched.leave) assert.ok(allowed(lean.CLASSIFIER_LEAVE_SELECT).has(key), `the classifier reads leave.${key}, which the lean select does not load`);
  console.log('PASS: the classifier reads only fields the lean selects load');

  // has-grade is decided by the database alone: one lean read, no classification.
  assert.equal(lean.gradeStatusFilterIsExact('has-grade'), true);
  for (const filter of lean.CLASSIFIED_GRADE_FILTERS) if (filter !== 'has-grade') assert.equal(lean.gradeStatusFilterIsExact(filter), false, filter);
  const exact = tables.grade.filter((row) => matches(row, lean.gradeStatusFilterWhere('has-grade'))).map((row) => row.id).sort();
  assert.deepEqual(exact, (await fullRowReference({}, 'has-grade', true)).sort(), 'the has-grade where equals its classification');
  for (const filter of ['excused', 'grace-period']) assert.equal(lean.gradeStatusFilterWhere(filter), null, `${filter} can protect any recorded status`);
  console.log('PASS: «عنده درجة» is an exact database filter; «مجاز» and «فترة السماح» are never narrowed by status');

  const route = fs.readFileSync(path.join(root, 'src/app/api/grades/route.ts'), 'utf8');
  assert.ok(!/include: \{ student: \{ include: \{ studentLeaves: true \} \}, exam: true \},?\s*\}\)\);/.test(route), 'the grades route must not load every grade with its full student to filter it');
  assert.ok(route.includes('findGradesMatchingStatusFilter(where, statusFilter, { withSettlements: true })') && route.includes('findGradesMatchingStatusFilter(baseWhere, statusFilter, { withSettlements: false })'), 'both grade views use the lean filter');
  assert.ok(route.includes('where: { id: { in: pageIds } }, include: CLASSIFIED_GRADE_INCLUDE'), 'only the requested page is loaded in full');
  console.log('PASS: the grades route loads full rows for the requested page only');
})().catch((error) => { console.error(error); process.exitCode = 1; });
