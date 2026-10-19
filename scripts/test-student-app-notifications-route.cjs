// Admin «إرسال إشعار»: permission gate, validation, dry-run counts, the real
// send writes a log row, clears dead tokens, and refuses when no sender is set.
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

const students = [
  { id: 's1', courseId: 'c1', status: 'نشط' },
  { id: 's2', courseId: 'c1', status: 'نشط' },
  { id: 's3', courseId: 'c1', status: 'مفصول' },
  { id: 's4', courseId: 'c2', status: 'نشط' },
  { id: 's5', courseId: 'c2', status: 'مؤرشف' },
];
const devices = [
  { id: 'd1', studentId: 's1', platform: 'ios', pushToken: 'ios-1', revokedAt: null },
  { id: 'd1b', studentId: 's1', platform: 'android', pushToken: 'fcm-1', revokedAt: null },
  { id: 'd2', studentId: 's2', platform: 'ios', pushToken: null, revokedAt: null },
  { id: 'd3', studentId: 's3', platform: 'ios', pushToken: 'ios-3', revokedAt: null },
  { id: 'd4', studentId: 's4', platform: 'ios', pushToken: 'ios-4', revokedAt: null },
  { id: 'd4r', studentId: 's4', platform: 'ios', pushToken: 'ios-4r', revokedAt: new Date() },
  { id: 'd5', studentId: 's5', platform: 'ios', pushToken: 'ios-5', revokedAt: null },
];
const studentMatches = (s, where) => (!where.status || !where.status.notIn.includes(s.status)) && (!where.courseId || where.courseId.in.includes(s.courseId));
const logs = [];
const audits = [];
let permitted = true;
let principalName = 'مدير';
mocks.set('@/lib/server-auth', {
  requirePermission: async (_req, permission) => { assert.equal(permission, 'notifications.send'); return permitted ? null : NextResponse.json({ error: 'ليست لديك صلاحية' }, { status: 403 }); },
  requirePermissionPrincipal: async (_req, permission) => { assert.equal(permission, 'notifications.send'); return permitted ? { id: 'u1', username: 'admin', name: principalName } : NextResponse.json({ error: 'ليست لديك صلاحية' }, { status: 403 }); },
});
mocks.set('@/lib/audit-log-server', { writeRequestAuditLog: async (_req, module, action, details) => { audits.push({ module, action, details }); } });
mocks.set('@/lib/db', { db: {
  course: { findUnique: async ({ where }) => ({ c1: { id: 'c1', name: 'أحياء سادس' }, c2: { id: 'c2', name: 'كيمياء' } })[where.id] ?? null },
  courseChapter: { findFirst: async ({ where }) => (where.courseId === 'c1' && where.chapterId === 'ch1') ? { chapter: { id: 'ch1', name: 'الفصل الأول' } } : null },
  student: { count: async ({ where }) => students.filter(s => studentMatches(s, where)).length },
  studentDevice: {
    findMany: async ({ where }) => devices.filter(d => d.revokedAt === null && d.pushToken !== null && studentMatches(students.find(s => s.id === d.studentId), where.student)).map(({ id, platform, pushToken, studentId }) => ({ id, platform, pushToken, studentId })),
    updateMany: async ({ where, data }) => { devices.filter(d => where.id.in.includes(d.id)).forEach(d => Object.assign(d, data)); return {}; },
  },
  studentPushLog: {
    create: async ({ data }) => { if (data.examId && logs.some(l => l.examId === data.examId)) { const e = new Error('dup'); e.code = 'P2002'; throw e; } const row = { id: `log-${logs.length + 1}`, sent: 0, failed: 0, createdAt: new Date(), ...data }; logs.push(row); return row; },
    update: async ({ where, data }) => { Object.assign(logs.find(l => l.id === where.id), data); return {}; },
    findUnique: async ({ where }) => logs.find(l => l.id === where.id) ?? null,
    findMany: async ({ take }) => [...logs].reverse().slice(0, take),
  },
} });

const pushServer = require(path.join(root, 'src/lib/student-app/push-server.ts'));
let senders = { apns: null, fcm: null, configured: false, missing: ['x'] };
mocks.set('@/lib/student-app/push-server', { ...pushServer, pushSendersFromEnv: () => senders });
const fakeSender = (dead = []) => ({ sent: [], send: async function (tokens) { this.sent.push(...tokens); return tokens.map(token => ({ token, ok: !dead.includes(token), unregistered: dead.includes(token) })); } });

const post = (data) => new NextRequest('http://local/api/notifications', { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } });
const json = async (res) => ({ status: res.status, body: await res.json() });

(async () => {
  const route = require(path.join(root, 'src/app/api/notifications/route.ts'));

  permitted = false;
  assert.equal((await route.GET(new NextRequest('http://local/api/notifications'))).status, 403);
  assert.equal((await route.POST(post({ target: 'all', title: 'a', body: 'b' }))).status, 403);
  permitted = true;
  pass('both the log and the send need notifications.send');

  for (const [data, fragment] of [
    [{ title: 'a', body: 'b' }, 'الجهة'],
    [{ target: 'all', body: 'b' }, 'عنوان'],
    [{ target: 'all', title: 'a' }, 'نص'],
    [{ target: 'all', title: 'x'.repeat(81), body: 'b' }, '80'],
    [{ target: 'course', title: 'a', body: 'b' }, 'الدورة'],
    [{ target: 'course', courseId: 'nope', title: 'a', body: 'b' }, 'غير موجودة'],
    [{ target: 'course-chapter', courseId: 'c1', title: 'a', body: 'b' }, 'الفصل'],
    [{ target: 'course-chapter', courseId: 'c1', chapterId: 'other', title: 'a', body: 'b' }, 'غير مرتبط'],
  ]) {
    const r = await json(await route.POST(post(data)));
    assert.equal(r.status, 400, JSON.stringify(data));
    assert.ok(r.body.error.includes(fragment), `${r.body.error} should mention ${fragment}`);
  }
  pass('target, title, body, course and chapter are validated with Arabic messages');

  let r = await json(await route.POST(post({ target: 'all', title: 'a', body: 'b', dryRun: true })));
  assert.deepEqual(r.body, { ok: true, dryRun: true, students: 3, reachable: 2, devices: 3 });
  r = await json(await route.POST(post({ target: 'course', courseId: 'c2', title: 'a', body: 'b', dryRun: true })));
  assert.deepEqual(r.body, { ok: true, dryRun: true, students: 1, reachable: 1, devices: 1 });
  assert.equal(logs.length, 0);
  pass('dry run counts active students, reachable students and devices without sending or logging');

  r = await json(await route.POST(post({ target: 'all', title: 'a', body: 'b' })));
  assert.equal(r.status, 503);
  assert.ok(r.body.error.includes('غير مهيأة'));
  assert.equal(logs.length, 0);
  pass('with devices to reach and no sender configured the send is refused, nothing logged');

  const apns = fakeSender(['ios-4']);
  const fcm = fakeSender();
  senders = { apns, fcm, configured: true, missing: [] };
  r = await json(await route.POST(post({ target: 'course-chapter', courseId: 'c1', chapterId: 'ch1', title: '  محاضرة  اليوم ', body: 'الساعة 6 مساءً\r\nبالقاعة' })));
  assert.equal(r.status, 200);
  assert.deepEqual(apns.sent, ['ios-1']);
  assert.deepEqual(fcm.sent, ['fcm-1']);
  assert.equal(r.body.sent, 2);
  assert.equal(r.body.failed, 0);
  assert.equal(r.body.log.title, 'محاضرة اليوم');
  assert.equal(r.body.log.body, 'الساعة 6 مساءً\nبالقاعة');
  assert.equal(r.body.log.courseName, 'أحياء سادس');
  assert.equal(r.body.log.chapterName, 'الفصل الأول');
  assert.equal(r.body.log.userName, 'مدير');
  assert.equal(r.body.log.recipients, 1);
  assert.equal(r.body.log.devices, 2);
  assert.equal(audits[0].module, 'إشعارات التطبيق');
  pass('course + chapter sends to the course students only, logs names, counts and the sender');

  r = await json(await route.POST(post({ target: 'all', title: 'a', body: 'b' })));
  assert.equal(r.body.sent, 2);
  assert.equal(r.body.failed, 1);
  assert.equal(devices.find(d => d.id === 'd4').pushToken, null, 'a token APNs declared dead is cleared');
  assert.equal(devices.find(d => d.id === 'd1').pushToken, 'ios-1');
  pass('a dead token is cleared after the send and counted as failed');

  senders = { apns: null, fcm: null, configured: false, missing: ['x'] };
  r = await json(await route.POST(post({ target: 'course', courseId: 'c2', title: 'a', body: 'b' })));
  assert.equal(r.status, 200);
  assert.equal(r.body.devices, 0);
  pass('a target with no devices still records a log row when nothing is configured');

  r = await json(await route.GET(new NextRequest('http://local/api/notifications?limit=2')));
  assert.equal(r.body.logs.length, 2);
  assert.equal(r.body.logs[0].target, 'course');
  assert.ok(!('tokens' in r.body.logs[0]));
  pass('the log lists newest first within the limit');
})().catch((error) => { console.error('FAIL:', error.stack || error.message); process.exit(1); });

// Targets: active courses with their non-archived chapters, same permission.
(async () => {
  mocks.get('@/lib/db').db.course.findMany = async ({ where, select }) => {
    assert.equal(where.active, true);
    assert.equal(select.chapters.where.archived, false);
    return [{ id: 'c1', name: 'أحياء سادس', chapters: [{ active: false, chapter: { id: 'ch0', name: 'فصل قديم' } }, { active: true, chapter: { id: 'ch1', name: 'الفصل الأول' } }] }];
  };
  const targets = require(path.join(root, 'src/app/api/notifications/targets/route.ts'));
  permitted = false;
  assert.equal((await targets.GET(new NextRequest('http://local/api/notifications/targets'))).status, 403);
  permitted = true;
  const body = await (await targets.GET(new NextRequest('http://local/api/notifications/targets'))).json();
  assert.deepEqual(body.courses, [{ id: 'c1', name: 'أحياء سادس', chapters: [{ id: 'ch1', name: 'الفصل الأول', active: true }, { id: 'ch0', name: 'فصل قديم', active: false }] }]);
  pass('targets lists active courses with linked chapters, the active chapter first');
})().catch((error) => { console.error('FAIL:', error.stack || error.message); process.exit(1); });
