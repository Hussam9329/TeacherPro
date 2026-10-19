// The sync version poll reads change markers kept by database triggers, not
// whole-table counts. This runs the real migration and the real route on
// PGlite: every watched table bumps only its own scope, a statement that
// touched no row is no change, and folding old markers never moves a counter.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = process.cwd(), resolve = Module._resolveFilename, load = Module._load, mocks = new Map();
Module._resolveFilename = function(r,p,...a) { return resolve.call(this,r.startsWith('@/') ? path.join(root,'src',r.slice(2)) : r,p,...a); };
Module._load = function(r,p,...a) { return mocks.has(r) ? mocks.get(r) : load.call(this,r,p,...a); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);

const WATCHED = {
  Course: 'courses', Chapter: 'chapters', CourseChapter: 'courseChapters', Student: 'students',
  Exam: 'exams', Grade: 'grades', OpportunityLog: 'opportunityLogs', StudentLeave: 'studentLeaves',
  StudentCall: 'studentCalls', StudentNote: 'studentNotes', AppUser: 'users', Role: 'roles',
  AuditLog: 'auditLogs', GradeSmartNote: 'gradeSmartNotes',
};

(async () => {
  // The production build refuses a migration whose policy checksum does not
  // match the committed (LF) file, or that names DROP/TRUNCATE/RENAME.
  const { validatePendingMigration } = await import('./check-deployment-contract.mjs');
  const migrationName = '20261019120000_sync_change_markers';
  const committedSql = fs.readFileSync(path.join(root, 'prisma/migrations', migrationName, 'migration.sql'), 'utf8').split('\r\n').join('\n');
  const policies = JSON.parse(fs.readFileSync(path.join(root, 'prisma/deployment-migration-policy.json'), 'utf8'));
  validatePendingMigration(migrationName, committedSql, policies[migrationName], true);

  const pg = new PGlite();
  await pg.exec(Object.keys(WATCHED).map(t => `CREATE TABLE "${t}"(id text PRIMARY KEY, v int, "updatedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP);`).join('\n'));
  await pg.exec(fs.readFileSync(path.join(root, 'prisma/migrations/20261019120000_sync_change_markers/migration.sql'), 'utf8'));

  const executed = [];
  mocks.set('@/lib/db', { db: {
    $queryRaw: async (sql) => (await pg.query(sql.text, sql.values)).rows,
    $executeRaw: async (sql) => { executed.push(sql.text); return (await pg.query(sql.text, sql.values)).affectedRows ?? 0; },
  } });
  mocks.set('@/lib/server-auth', { requireAuth: async () => null });
  mocks.set('@/lib/schema-readiness', { assertDatabaseSchemaReady: async () => {} });
  mocks.set('@/lib/route-helpers', { routeErrorResponse: (error) => { throw error; } });
  const { GET } = require('../src/app/api/sync/version/route.ts');
  const poll = async () => (await GET({})).json();

  const routeSource = fs.readFileSync(path.join(root, 'src/app/api/sync/version/route.ts'), 'utf8');
  assert.doesNotMatch(routeSource, /COUNT\(\*\)\s+FROM\s+"(?!SyncChange|old)/i, 'the route counts no watched table');

  const first = await poll();
  assert.equal(first.ok, true);
  assert.deepEqual(Object.keys(first.counts).sort(), Object.values(WATCHED).sort(), 'every scope the client maps is reported');
  assert.ok(Object.values(first.counts).every(n => n === 0), 'nothing changed yet');

  let previous = first;
  for (const [table, scope] of Object.entries(WATCHED)) {
    await pg.exec(`INSERT INTO "${table}" VALUES ('a', 1), ('b', 2)`);
    const next = await poll();
    assert.notEqual(next.version, previous.version, `${table} insert changes the version`);
    for (const key of Object.keys(next.counts)) {
      assert.equal(next.counts[key] !== previous.counts[key], key === scope, `${table} insert bumps only «${scope}» (checked ${key})`);
    }
    assert.ok(next.maxDates[scope], `${table} has a last-change time`);
    previous = next;
  }

  await pg.exec(`UPDATE "Grade" SET v = 3 WHERE id = 'missing'`);
  await pg.exec(`DELETE FROM "Student" WHERE id = 'missing'`);
  let next = await poll();
  assert.equal(next.version, previous.version, 'an update or delete that touched no row is no change');

  await pg.exec(`UPDATE "Grade" SET v = 1 WHERE id = 'a'`);
  await pg.exec(`UPDATE "GradeSmartNote" SET v = v, "updatedAt" = CURRENT_TIMESTAMP + interval '1 minute'`);
  await pg.exec(`INSERT INTO "GradeSmartNote" VALUES ('a', 1) ON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v, "updatedAt" = CURRENT_TIMESTAMP + interval '2 minutes'`);
  next = await poll();
  assert.equal(next.version, previous.version, 'rewriting the same values (only updatedAt moves) is no change');

  await pg.exec(`UPDATE "Grade" SET v = 3 WHERE id = 'a'`);
  next = await poll();
  assert.equal(next.counts.grades, previous.counts.grades + 1, 'an update bumps its scope');
  previous = next;

  await pg.exec(`DELETE FROM "AuditLog" WHERE id = 'a'`);
  next = await poll();
  assert.equal(next.counts.auditLogs, previous.counts.auditLogs + 1, 'a delete bumps its scope');
  previous = next;

  // A backup restore empties the tables, then inserts its rows again.
  await pg.exec(`BEGIN; TRUNCATE "OpportunityLog"; INSERT INTO "OpportunityLog" VALUES ('restored', 1); COMMIT;`);
  next = await poll();
  assert.equal(next.counts.opportunityLogs, previous.counts.opportunityLogs + 1, 'a backup restore bumps its scope through its inserts');
  previous = next;

  await pg.exec(`BEGIN; INSERT INTO "Exam" VALUES ('rolled-back', 1); ROLLBACK;`);
  next = await poll();
  assert.equal(next.version, previous.version, 'a rolled-back write leaves no marker');

  // Folding: markers older than ten minutes move into SyncVersion.folded and
  // the counters stay where they were.
  const live = Number((await pg.query(`SELECT COUNT(*) AS n FROM "SyncChange"`)).rows[0].n);
  assert.ok(live > 0);
  await pg.exec(`UPDATE "SyncChange" SET "at" = "at" - interval '1 hour'`);
  const backdated = await poll();
  assert.equal(executed.length, 1, 'only the first poll of the minute folded');
  assert.deepEqual(backdated.counts, previous.counts);
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  const beforeFold = await poll();
  assert.equal(executed.length, 2, 'a poll a minute later folds again');
  assert.equal(Number((await pg.query(`SELECT COUNT(*) AS n FROM "SyncChange"`)).rows[0].n), 0, 'old markers were folded away');
  assert.equal(beforeFold.version, backdated.version, 'folding moves no counter and no last-change time');

  await poll();
  assert.equal(executed.length, 2, 'polls inside the minute only read');

  await pg.exec(`INSERT INTO "Grade" VALUES ('c', 1)`);
  next = await poll();
  assert.equal(next.counts.grades, beforeFold.counts.grades + 1, 'after a fold, a new write still bumps on top of the folded total');

  console.log('✅ مؤشرات المزامنة: كل جدول يحدّث نطاقه فقط، بلا عدّ جداول كاملة، والطيّ لا يحرّك العدادات');
})().catch((error) => { console.error(error); process.exit(1); });
