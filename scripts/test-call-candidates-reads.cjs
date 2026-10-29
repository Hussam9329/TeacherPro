// «المتابعة»: the candidates route reads the database in two rounds of
// parallel queries instead of one query after another, and the export fetches
// its pages a few at a time, in order, without holding anyone.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const route = read('src/app/api/student-calls/candidates/route.ts');
const round1 = route.slice(route.indexOf('// Round 1:'), route.indexOf('if (!exam || !examIncludesCourse(exam, courseId))'));
assert.ok(round1.includes('await Promise.all(['), 'round 1 runs its reads together');
for (const read of ['db.exam.findUnique(', 'db.exam.findMany(', 'db.student.findMany(', 'db.grade.findMany(', 'db.gradeSmartNote.findMany(']) {
  assert.ok(round1.includes(read), `round 1 reads ${read}`);
}
const round2 = route.slice(route.indexOf('// Round 2:'), route.indexOf('for (const student of selectedStudents)'));
assert.ok(round2.includes('await Promise.all(['), 'round 2 runs its reads together');
for (const read of ['loadActiveGracePeriodsByStudent(db, candidateStudentIds)', 'db.studentLeave.findMany(', 'loadNoteCalls()', 'db.studentCall.findMany(']) {
  assert.ok(round2.includes(read), `round 2 reads ${read}`);
}
const gradeSelect = round1.slice(round1.indexOf('db.grade.findMany('), round1.indexOf('db.gradeSmartNote.findMany('));
assert.ok(!gradeSelect.includes('student: {\n            select'), 'the exam grades do not load a second copy of each student');
console.log('PASS: the candidates route reads in two parallel rounds, without duplicate students');

// The export: the real callCandidatesApi.listAll over a fake fetch.
const compiled = ts.transpileModule(read('src/lib/api.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function apiWith(fetchImpl) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', compiled)(
    (name) => (name === './read-deadline' ? { withReadDeadline: (fn) => fn() } : {}),
    module, module.exports, fetchImpl,
  );
  return module.exports.callCandidatesApi;
}

(async () => {
  const totalPages = 7;
  let inFlight = 0, maxInFlight = 0;
  const asked = [];
  const pageFetch = (failPage) => async (url) => {
    const params = new URL(url, 'https://teacherpro.test').searchParams;
    const page = Number(params.get('page'));
    asked.push({ page, window: params.get('window'), claim: params.get('claim') });
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 10 + (totalPages - page) * 3)); // later pages answer first
    inFlight--;
    if (page === failPage) return Response.json({ error: 'x' }, { status: 500 });
    return Response.json({
      rows: [{ id: `row-${page}` }], students: [{ id: `student-${page}` }], grades: [], studentCalls: [],
      exams: [{ id: 'e1' }], totalCount: 7, page, pageSize: 1, totalPages, hasMore: page < totalPages, source: 'database',
    });
  };

  const all = await apiWith(pageFetch(0)).listAll({ courseId: 'c', examId: 'e1', exportAll: true, pageSize: 1 });
  assert.deepEqual(all.rows.map((row) => row.id), Array.from({ length: totalPages }, (_, i) => `row-${i + 1}`), 'every page, in page order');
  assert.equal(all.students.length, totalPages);
  assert.equal(all.exams.length, 1, 'exams are listed once');
  assert.equal(all.totalCount, 7);
  assert.deepEqual([...new Set(asked.map((item) => item.page))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7], 'each page once');
  assert.equal(asked.length, totalPages);
  assert.equal(maxInFlight, 3, 'three pages at a time');
  assert.ok(asked.every((item) => !item.window && !item.claim), 'the export holds no one');
  console.log('PASS: the export fetches every page once, three at a time, and keeps their order');

  asked.length = 0; maxInFlight = 0;
  assert.equal(await apiWith(pageFetch(5)).listAll({ courseId: 'c', examId: 'e1', exportAll: true, pageSize: 1 }), null, 'a failed page fails the export');
  asked.length = 0; maxInFlight = 0;
  await apiWith(pageFetch(0)).listAll({ courseId: 'c', examId: 'e1', window: 'w1', pageSize: 1 });
  assert.equal(maxInFlight, 1, 'a request from a calls window keeps its pages one after another');
  console.log('PASS: a failed page fails the export; a calls window keeps pages in sequence');
})().catch((error) => { console.error(error); process.exitCode = 1; });
