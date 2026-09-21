const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');

const root = path.resolve(__dirname, '..');
const CATEGORY = 'call-student-note';
const courses = [{ id: 'course-a', name: 'الدورة الأولى' }, { id: 'course-b', name: 'الدورة الثانية' }];
const exams = ['a', 'b', 'c'].map((suffix) => ({ id: `exam-${suffix}`, name: `امتحان ${suffix}` }));
const students = [
  { id: 'student-a', name: 'طالب أول', code: 'BIO-A', status: 'نشط', courseId: 'course-a' },
  { id: 'student-b', name: 'طالب ثان', code: 'BIO-B', status: 'مفصول', courseId: 'course-b' },
  { id: 'archived', name: 'طالب مؤرشف', code: 'BIO-X', status: 'مؤرشف', courseId: 'course-a' },
].map((student) => ({ ...student, course: courses.find((course) => course.id === student.courseId) }));
const note = (id, studentId, examId, extra = {}) => ({
  id, studentId, examId, notes: `ملاحظة ${id}`, category: CATEGORY,
  noteRevision: 1, noteResolved: false, createdAt: '2026-09-20T08:00:00.000Z', ...extra,
});
const call = (id, studentId, examId, status, createdAt, extra = {}) => ({
  id, studentId, examId, status, completed: false,
  category: 'followup', notes: '', createdAt, ...extra,
});
const rows = [
  note('a-exam-a', 'student-a', 'exam-a'),
  note('a-exam-b', 'student-a', 'exam-b'),
  note('a-exam-c', 'student-a', 'exam-c'),
  note('a-general', 'student-a', null),
  note('b-exam-b', 'student-b', 'exam-b'),
  note('b-general', 'student-b', null),
  note('resolved', 'student-a', 'exam-a', { noteResolved: true }),
  note('empty', 'student-b', 'exam-a', { notes: '   ' }),
  note('archived-note', 'archived', 'exam-a'),
  call('old-a', 'student-a', 'exam-a', 'الرقم خاطئ', '2026-09-18T08:00:00.000Z'),
  call('latest-a', 'student-a', 'exam-a', 'لم يرد', '2026-09-19T08:00:00.000Z'),
  call('latest-b', 'student-a', 'exam-b', 'تم الاتصال', '2026-09-20T08:00:00.000Z'),
  // A newer placeholder is not evidence of an actual contact for a general note.
  call('placeholder', 'student-a', 'exam-c', '', '2026-09-21T08:00:00.000Z'),
  call('other-student', 'student-b', 'exam-a', 'الرقم خاطئ', '2026-09-21T08:00:00.000Z'),
].map((row) => ({
  ...row,
  student: students.find((student) => student.id === row.studentId),
  exam: exams.find((exam) => exam.id === row.examId) || null,
}));

// Read-only Prisma double. It evaluates the route's actual where/projection
// against independent fixtures; it intentionally has no mutation methods.
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every((part) => matches(row, part));
    if (key === 'OR') return value.some((part) => matches(row, part));
    if (value && typeof value === 'object') {
      if ('is' in value) return matches(row[key], value.is);
      if ('not' in value) return row[key] !== value.not;
      if ('notIn' in value) return !value.notIn.includes(row[key]);
      if ('in' in value) return value.in.includes(row[key]);
      throw new Error(`Unsupported test predicate: ${key}`);
    }
    return row[key] === value;
  });
}
function project(row, select) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key,
    value === true ? row[key] : project(row[key], value.select),
  ]));
}
let permissions = ['follow-up.calls.view'];
let reads = [];
const db = {
  exam: { findUnique: async ({ where, select }) => {
    reads.push('exam');
    return project(exams.find((exam) => exam.id === where.id), select);
  } },
  examCourse: { findFirst: async ({ where }) => {
    reads.push('examCourse');
    return where.courseId === 'course-a' || where.examId === 'exam-b' ? { id: 'link' } : null;
  } },
  studentCall: { findMany: async ({ where, select, orderBy }) => {
    reads.push('studentCall');
    const found = rows.filter((row) => matches(row, where));
    for (const order of [...orderBy].reverse()) {
      const [key, direction] = Object.entries(order)[0];
      found.sort((a, b) => {
        if (key === 'student') return a.student.name.localeCompare(b.student.name);
        return String(a[key]).localeCompare(String(b[key])) * (direction === 'desc' ? -1 : 1);
      });
    }
    return found.map((row) => project(row, select));
  } },
};
class CallNoteMutationError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
const overrides = {
  '@/lib/db': { db },
  '@/lib/server-auth': {
    requireAnyPermission: async (_req, requestedPermissions) => {
      assert.deepEqual(requestedPermissions, ['follow-up.calls.view', 'follow-up.view']);
      const { hasPermission } = load('src/lib/server-auth.ts');
      const principal = { isAdmin: false, permissions };
      return requestedPermissions.some((permission) => hasPermission(principal, permission))
        ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    },
  },
  '@/lib/schema-readiness': { withDatabaseSchema: (fn) => fn() },
  '@/lib/route-helpers': { routeErrorResponse: (error) => { throw error; } },
  '@/lib/call-note-management-server': { CallNoteMutationError },
};
const modules = new Map();
function load(relative) {
  const file = path.join(root, relative);
  if (modules.has(file)) return modules.get(file).exports;
  const entry = { exports: {} };
  modules.set(file, entry);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', code)((name) => {
    if (overrides[name]) return overrides[name];
    return name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name);
  }, entry, entry.exports);
  return entry.exports;
}
const { GET } = load('src/app/api/student-calls/notes/route.ts');
async function request(query = '') {
  reads = [];
  const response = await GET(new NextRequest(`https://teacherpro.test/api/student-calls/notes${query}`));
  return { response, body: await response.json() };
}

(async () => {
  const initial = JSON.stringify(rows);
  const all = await request();
  assert.equal(all.response.status, 200, 'Opening the dashboard queue needs no selected course or exam.');
  assert.equal(all.response.headers.get('Cache-Control'), 'no-store');
  assert.equal(all.body.totalCount, 6);
  assert.equal(all.body.exam, null);
  assert.deepEqual(reads, ['studentCall', 'studentCall'], 'Global queue uses two set-based reads, with no student/exam N+1.');
  const byId = Object.fromEntries(all.body.notes.map((item) => [item.id, item]));
  assert.equal(byId['a-exam-a'].contactStatus, 'لم يرد', 'Latest action for the exact exam wins.');
  assert.equal(byId['a-exam-b'].contactStatus, 'تم الاتصال');
  assert.equal(byId['a-exam-c'].contactStatus, '', 'Another exam action must not leak into a blank action.');
  assert.equal(byId['b-exam-b'].contactStatus, '', 'Contact action must not leak across students or exams.');
  assert.equal(byId['b-exam-b'].student.course.id, 'course-b', 'Dismissed students and every course stay visible.');
  assert.equal(byId['a-general'].scope, 'general');
  assert.equal(byId['a-general'].exam, null, 'Legacy general notes are not assigned an invented exam.');
  assert.equal(byId['a-general'].contactStatus, 'تم الاتصال');
  assert.equal(byId['a-general'].contactExam.id, 'exam-b', 'Actual contact exam is separate from general note scope.');
  assert.equal(byId['b-general'].contactStatus, 'الرقم خاطئ');
  assert.equal(byId['b-general'].exam, null);
  assert(!byId.resolved && !byId.empty && !byId['archived-note']);

  const courseOnly = await request('?courseId=course-a');
  assert.equal(courseOnly.response.status, 200);
  assert.equal(courseOnly.body.totalCount, 4);
  assert(courseOnly.body.notes.every((item) => item.student.courseId === 'course-a'));
  const examOnly = await request('?examId=exam-a');
  assert.equal(examOnly.body.totalCount, 3, 'Legacy exam-scoped reads continue to include general notes.');
  assert(examOnly.body.notes.every((item) => item.examId === 'exam-a' || item.examId === null));
  const both = await request('?courseId=course-a&examId=exam-a');
  assert.equal(both.body.totalCount, 2);
  assert.equal(both.body.exam.id, 'exam-a');
  assert.equal((await request('?courseId=course-b&examId=exam-a')).response.status, 400);
  assert.equal((await request('?examId=missing')).response.status, 404);

  for (const legacyPermission of ['follow-up.view', 'page.follow-up-calls.view']) {
    permissions = [legacyPermission];
    assert.equal((await request()).response.status, 200, 'Existing legacy viewing permissions remain accepted.');
  }
  permissions = [];
  assert.equal((await request()).response.status, 403);
  assert.deepEqual(reads, [], 'Unauthorized calls never query student data.');
  assert.equal(JSON.stringify(rows), initial, 'Loading and filtering never mutate note text, completion, or contact history.');
  console.log('Global call-note GET passed: all courses/exams by default, dismissed inclusion, archived/resolved exclusion, exact contact isolation, general-note preservation, optional filters, permissions and read-only behavior.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
