// The exam-window cron route: CRON_SECRET gate, no claim without push keys,
// and an audit line per notified exam.
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
const pass = label => console.log('PASS:', label);

process.env.CRON_SECRET = 'cron-secret';
const audits = [];
let calls = 0;
let senders = { apns: null, fcm: null, configured: false, missing: ['APNS'] };
mocks.set('@/lib/db', { db: {} });
mocks.set('@/lib/audit-log-server', { writeSystemAuditLog: async (module, action, details) => { audits.push({ module, action, details }); } });
mocks.set('@/lib/student-app/push-server', { pushSendersFromEnv: () => senders });
mocks.set('@/lib/student-app/push-exam-window', { pushDueExamWindows: async () => { calls += 1; return { scanned: 1, notified: [{ examId: 'e1', name: 'x', students: 2, devices: 2, sent: 2, failed: 0 }], skipped: [] }; } });

const get = (auth) => new NextRequest('http://local/api/internal/exam-window-push', { headers: auth ? { authorization: auth } : {} });

(async () => {
  const route = require(path.join(root, 'src/app/api/internal/exam-window-push/route.ts'));
  assert.equal((await route.GET(get(''))).status, 401);
  assert.equal((await route.GET(get('Bearer wrong'))).status, 401);
  assert.equal(calls, 0);
  pass('the cron needs the CRON_SECRET bearer');

  let res = await route.GET(get('Bearer cron-secret'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: false, reason: 'push-not-configured', missing: ['APNS'] });
  assert.equal(calls, 0, 'nothing is claimed without push keys');
  pass('without push keys the run answers ok:false and claims nothing');

  senders = { apns: {}, fcm: null, configured: true, missing: [] };
  res = await route.GET(get('Bearer cron-secret'));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.notified.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].module, 'إشعارات التطبيق');
  pass('a notified exam is reported and audited');
})().catch((error) => { console.error('FAIL:', error.stack || error.message); process.exit(1); });
