// POST /api/student-app/push-token: bearer device auth, stores the native push
// token on this device only, moves a token that another device row still holds,
// and clears it on null.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = process.cwd();
const resolve = Module._resolveFilename;
Module._resolveFilename = function(r,p,...args) { return resolve.call(this,r.startsWith('@/') ? path.join(root,'src',r.slice(2)) : r,p,...args); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const mocks = new Map();
const load = Module._load;
Module._load = function(r,p,...args) { return mocks.has(r) ? mocks.get(r) : load.call(this,r,p,...args); };
const { NextRequest } = require('next/server');
const { hashDeviceToken } = require(path.join(root, 'src/lib/student-app/auth.ts'));
const pass = label => console.log('PASS:', label);

const student = { id: 's1', name: 'طالب', status: 'نشط' };
const rows = [
  { id: 'd1', studentId: 's1', tokenHash: hashDeviceToken('tok-1'), deviceName: 'iPhone', platform: 'ios', createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null, pushToken: null },
  { id: 'd-old', studentId: 's1', tokenHash: hashDeviceToken('tok-old'), deviceName: 'iPhone', platform: 'ios', createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null, pushToken: 'apns-abc' },
  { id: 'd-revoked', studentId: 's1', tokenHash: hashDeviceToken('tok-rev'), deviceName: 'x', platform: 'ios', createdAt: new Date(), lastSeenAt: new Date(), revokedAt: new Date(), pushToken: null },
];
mocks.set('@/lib/db', { db: { studentDevice: {
  findUnique: async ({ where }) => { const r = rows.find(x => x.tokenHash === where.tokenHash); return r ? { ...r, student } : null; },
  update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return r; },
  updateMany: async ({ where, data }) => {
    const hit = rows.filter(r => (where.pushToken === undefined || r.pushToken === where.pushToken) && (where.id?.not === undefined || r.id !== where.id.not));
    hit.forEach(r => Object.assign(r, data));
    return { count: hit.length };
  },
} } });

const post = (token, data) => new NextRequest('http://local/api/student-app/push-token', { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });

(async () => {
  const route = require(path.join(root, 'src/app/api/student-app/push-token/route.ts'));

  let res = await route.POST(post('', { pushToken: 'apns-abc' }));
  assert.equal(res.status, 401);
  res = await route.POST(post('tok-rev', { pushToken: 'apns-abc' }));
  assert.equal(res.status, 401);
  pass('missing or revoked device token is SESSION_REVOKED');

  res = await route.POST(post('tok-1', {}));
  assert.equal(res.status, 400);
  res = await route.POST(post('tok-1', { pushToken: 'x'.repeat(5000) }));
  assert.equal(res.status, 400);
  pass('missing or oversized push token is a validation error');

  res = await route.POST(post('tok-1', { pushToken: 'apns-abc' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(rows.find(r => r.id === 'd1').pushToken, 'apns-abc');
  assert.equal(rows.find(r => r.id === 'd-old').pushToken, null, 'the same native token moved off the older device row');
  pass('stores the token on this device and takes it away from an older row');

  res = await route.POST(post('tok-1', { pushToken: 'apns-abc' }));
  assert.equal(res.status, 200);
  assert.equal(rows.find(r => r.id === 'd1').pushToken, 'apns-abc');
  pass('repeating the same token is a harmless no-op');

  res = await route.POST(post('tok-1', { pushToken: null }));
  assert.equal(res.status, 200);
  assert.equal(rows.find(r => r.id === 'd1').pushToken, null);
  pass('null clears the token (notifications turned off on the device)');
})().catch((error) => { console.error('FAIL:', error.message); process.exit(1); });
