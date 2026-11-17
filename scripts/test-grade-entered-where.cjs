// «سجل الدرجات» coverage card: the database filter that decides which grades
// count as entered must agree with isGradeEnteredUnified on every grade,
// including scores outside the exam's range, and the stats route must use it
// instead of loading every grade.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = process.cwd(), resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function (r, p, ...a) { return resolve.call(this, r.startsWith('@/') ? path.join(root, 'src', r.slice(2)) : r, p, ...a); };
Module._load = function (r, p, ...a) { return r === '@/lib/db' ? { db: {} } : load.call(this, r, p, ...a); };
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);

const { isGradeEnteredUnified } = require('../src/lib/grade-classification.ts');
const { enteredGradeWhere } = require('../src/lib/grade-status-filter-server.ts');

const exams = [10, 20, 50, 100, 100].map((fullMark, index) => ({ id: `e${index}`, fullMark }));
const statuses = ['درجة', 'غائب', 'غش', 'مجاز', 'قبل تسجيل الطالب', 'ضمن فترة السماح'];
const grades = [];
for (const exam of exams) {
  for (const status of statuses) {
    const scores = status === 'درجة' ? [null, -1, 0, 1, exam.fullMark - 1, exam.fullMark, exam.fullMark + 1, 1000] : [null];
    for (const score of scores) grades.push({ id: `g${grades.length}`, status, score, examId: exam.id });
  }
}

// The condition forms enteredGradeWhere uses, applied to one grade.
function matches(grade, where) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return condition.some((part) => matches(grade, part));
    if (key === 'exam') return Object.entries(condition.is).every(([field, value]) => exams.find((exam) => exam.id === grade.examId)[field] === value);
    const value = grade[key];
    if (condition === null || typeof condition !== 'object') return value === condition;
    if ('in' in condition) return condition.in.includes(value);
    if ('gte' in condition || 'lte' in condition) {
      return value !== null && (!('gte' in condition) || value >= condition.gte) && (!('lte' in condition) || value <= condition.lte);
    }
    throw new Error(`unsupported condition on ${key}: ${JSON.stringify(condition)}`);
  });
}

const where = enteredGradeWhere(exams.map((exam) => exam.fullMark));
let entered = 0;
for (const grade of grades) {
  const expected = isGradeEnteredUnified(grade, exams.find((exam) => exam.id === grade.examId));
  assert.equal(matches(grade, where), expected, `${grade.status} ${grade.score} / ${grade.examId}`);
  if (expected) entered += 1;
}
assert.ok(entered > 0 && entered < grades.length, 'the fixture has entered and not-entered grades');
assert.equal(where.OR.length, 1 + new Set(exams.map((exam) => exam.fullMark)).size, 'one score condition per distinct full mark');
console.log(`PASS: the entered-grade database filter equals isGradeEnteredUnified on ${grades.length} grades (${entered} entered)`);

const route = fs.readFileSync(path.join(root, 'src/app/api/grades/stats/route.ts'), 'utf8');
assert.ok(route.includes('enteredGradeWhere(fullMarks)') && route.includes('db.grade.groupBy'), 'the coverage card asks the database for the students with an entered grade');
assert.ok(!route.includes('db.grade.findMany'), 'the coverage card must not load every grade');
console.log('PASS: the coverage card reads one row per student, not every grade');
