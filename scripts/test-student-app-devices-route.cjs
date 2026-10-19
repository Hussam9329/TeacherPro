// Admin list/revoke of student-app devices: permission gate, newest-first list, idempotent revoke.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = process.cwd();
const resolve = Module._resolveFilename;
Module._resolveFilename = function(r,p,...args) { return resolve.call(this,r.startsWith('@/') ? path.join(root,'src',r.slice(2)) : r,p,...args); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const mocks = new Map();
const load = Module._load;
Module._load = function(r,p,...args) { return mocks.has(r) ? mocks.get(r) : load.call(this,r,p,...args); };
const { NextRequest, NextResponse } = require('next/server');
const pass = label => console.log('PASS:', label);

const rows = [
  { id: 'd-old', studentId: 's1', deviceName: 'iPhone', platform: 'ios', createdAt: new Date('2026-10-01T00:00:00Z'), lastSeenAt: new Date('2026-10-02T00:00:00Z'), revokedAt: null },
  { id: 'd-new', studentId: 's1', deviceName: 'iPad', platform: 'ios', createdAt: new Date('2026-10-10T00:00:00Z'), lastSeenAt: new Date('2026-10-11T00:00:00Z'), revokedAt: null },
  { id: 'd-other', studentId: 's2', deviceName: 'x', platform: 'android', createdAt: new Date('2026-10-05T00:00:00Z'), lastSeenAt: new Date('2026-10-05T00:00:00Z'), revokedAt: null },
];
const updates = [];
let permitted = true;
mocks.set('@/lib/server-auth', { requirePermission: async (_req, permission) => {
  assert.equal(permission, 'students.edit');
  return permitted ? null : NextResponse.json({ error: 'ليست لديك صلاحية لتنفيذ هذه العملية.' }, { status: 403 });
} });
mocks.set('@/lib/db', { db: { studentDevice: {
  findMany: async ({ where, orderBy }) => {
    assert.deepEqual(orderBy, { createdAt: 'desc' });
    return rows.filter(r => r.studentId === where.studentId).sort((a, b) => b.createdAt - a.createdAt);
  },
  updateMany: async ({ where, data }) => {
    const hit = rows.filter(r => r.id === where.id && r.revokedAt === null);
    hit.forEach(r => { r.revokedAt = data.revokedAt; });
    updates.push(where.id);
    return { count: hit.length };
  },
} } });

(async () => {
  const route = require(path.join(root, 'src/app/api/students/devices/route.ts'));

  permitted = false;
  let res = await route.GET(new NextRequest('http://local/api/students/devices?studentId=s1'));
  assert.equal(res.status, 403);
  pass('listing without students.edit is refused');

  permitted = true;
  res = await route.GET(new NextRequest('http://local/api/students/devices?studentId=s1'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.devices.map(d => d.id), ['d-new', 'd-old']);
  assert.equal(body.devices[0].active, true);
  assert.ok(!('tokenHash' in body.devices[0]));
  pass('list is newest first, scoped to the student, without token hashes');

  res = await route.GET(new NextRequest('http://local/api/students/devices'));
  assert.equal(res.status, 400);
  pass('missing studentId is a validation error');

  const post = (data) => new NextRequest('http://local/api/students/devices', { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } });
  res = await route.POST(post({ deviceId: 'd-old' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).revoked, true);
  assert.ok(rows.find(r => r.id === 'd-old').revokedAt instanceof Date);
  res = await route.POST(post({ deviceId: 'd-old' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).revoked, false);
  pass('revoke sets revokedAt once and a repeat is a harmless no-op');

  const fold = fs.readFileSync(path.join(root, 'src/components/teacher-pro/student-devices-fold.tsx'), 'utf8');
  assert.ok(fold.includes('onToggle'), 'devices load when the fold is opened, not on every profile open');
  assert.ok(!/void reload\(\);\s*\}, \[reload\]\)/.test(fold), 'no fetch on mount');
  assert.ok(fold.includes('غير متاح لصلاحيتك'), 'a 403 reads as a permission notice, not an error');
  pass('devices fold loads lazily and explains a missing permission');

  res = await route.POST(post({}));
  assert.equal(res.status, 400);
  pass('revoke without deviceId is a validation error');
})().catch((error) => { console.error('FAIL:', error.message); process.exit(1); });
