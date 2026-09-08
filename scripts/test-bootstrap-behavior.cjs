const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename, load = Module._load, mocks = new Map();
Module._resolveFilename = function (request, parent, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, ...args);
};
Module._load = function (request, parent, ...args) {
  return mocks.has(request) ? mocks.get(request) : load.call(this, request, parent, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);

let principal = null, authChecks = 0, readinessChecks = 0;
const calls = [];
const fixtures = {
  course: [{ id: 'c', name: 'Course' }],
  chapter: [{ id: 'ch', courseLinks: [{ courseId: 'c' }] }],
  exam: [{ id: 'e', date: new Date('2026-09-08'), examCourses: [{ courseId: 'c', chapterId: 'ch' }] }],
  appUser: [{ id: 'u', username: 'user', name: 'User', role: 'staff', roleId: 'r', permissions: '[]', active: true,
    createdAt: new Date('2026-01-01'), roleRef: { id: 'r' }, logs: [], passwordHash: 'MUST_NOT_LEAK', sessionVersion: 9 }],
  role: [{ id: 'r', users: [{ id: 'u', name: 'User' }] }],
};
const models = Object.fromEntries(Object.keys(fixtures).map((model) => [model, {
  findMany: async (args) => {
    calls.push({ model, args });
    return fixtures[model].map((row) => args.select
      ? Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key]]))
      : { ...row });
  },
}]));
const db = new Proxy(models, { get(target, key) {
  assert.ok(key in target, `Unexpected DB model/method ${String(key)}: bootstrap must not load or mutate heavy data`);
  return target[key];
} });
mocks.set('@/lib/db', { db });
// Exercise real permission aliases; only replace the session lookup.
const auth = require('../src/lib/server-auth.ts');
mocks.set('@/lib/server-auth', {
  ...auth,
  getAuthPrincipal: async () => { authChecks++; return principal; },
});
mocks.set('@/lib/schema-readiness', { assertDatabaseSchemaReady: async () => { readinessChecks++; } });
const { GET } = require('../src/app/api/bootstrap/route.ts');
const { buildMutationPreviewToken } = require('../src/lib/mutation-preview-token.ts');
const request = {};
const reset = (permissions, admin = false) => {
  calls.length = 0; authChecks = 0; readinessChecks = 0;
  principal = permissions === null ? null : { id: 'u', isAdmin: admin, permissions };
};

(async () => {
  reset(null);
  assert.equal((await GET(request)).status, 401);
  assert.equal(authChecks, 1);
  assert.equal(calls.length, 0);

  reset(['students.view']);
  assert.deepEqual(await (await GET(request)).json(), {});
  assert.equal(calls.length, 0);
  assert.equal(readinessChecks, 0);

  reset(['page.courses.view']);
  assert.deepEqual(await (await GET(request)).json(), { courses: fixtures.course });
  assert.deepEqual(calls.map((call) => call.model), ['course']);
  assert.equal(authChecks, 1);

  reset(['exams.view']);
  let response = await GET(request), payload = await response.json();
  assert.deepEqual(Object.keys(payload), ['exams']);
  assert.equal(readinessChecks, 1);
  assert.equal(payload.exams[0].mutationToken, buildMutationPreviewToken('exam-edit:e', fixtures.exam[0]));
  assert.deepEqual(calls[0].args.include, { examCourses: true });

  reset(['accounts.users.view']);
  payload = await (await GET(request)).json();
  assert.deepEqual(Object.keys(payload).sort(), ['roles', 'users']);
  assert.equal(JSON.stringify(payload).includes('MUST_NOT_LEAK'), false);
  assert.equal('passwordHash' in payload.users[0], false);
  assert.equal('sessionVersion' in payload.users[0], false);
  assert.equal('logs' in payload.users[0], false);
  assert.equal('logs' in calls.find((call) => call.model === 'appUser').args.select, false);
  assert.deepEqual(calls.find((call) => call.model === 'role').args.include, { users: { select: { id: true, name: true } } });

  reset([], true);
  response = await GET(request); payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(authChecks, 1);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Object.keys(payload).sort(), ['chapters', 'courses', 'exams', 'roles', 'users']);
  assert.deepEqual(calls.map((call) => call.model).sort(), Object.keys(fixtures).sort());
  assert.deepEqual(payload.chapters[0].courseLinks, fixtures.chapter[0].courseLinks);
  assert.equal('archive' in calls.find((call) => call.model === 'chapter').args.include.courseLinks.select, false);
  assert.equal('passwordHash' in payload.users[0], false);
  console.log('PASS: bootstrap authenticates once, preserves GET permissions/projections/tokens, omits credentials, and never reads or changes students/grades');
})().catch((error) => { console.error(error); process.exitCode = 1; });
