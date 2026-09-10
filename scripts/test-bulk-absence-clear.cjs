const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = process.cwd(), resolve = Module._resolveFilename, load = Module._load, mocks = new Map();
Module._resolveFilename = function(r,p,...a) { return resolve.call(this,r.startsWith('@/') ? path.join(root,'src',r.slice(2)) : r,p,...a); };
Module._load = function(r,p,...a) { return mocks.has(r) ? mocks.get(r) : load.call(this,r,p,...a); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);

(async () => {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE "Student"(id text PRIMARY KEY,status text,opportunities int);
    CREATE TABLE "Grade"(id text PRIMARY KEY,"studentId" text,"examId" text,status text,score int,"academicEffectExcluded" boolean);
    INSERT INTO "Student" VALUES ('active','نشط',2),('dismissed','مفصول',0),('archived','مؤرشف',1),('protected','نشط',2);
    INSERT INTO "Grade" VALUES ('remove','active','exam','غائب',NULL,false),('keep-dismissed','dismissed','exam','غائب',NULL,false),('keep-archived','archived','exam','غائب',NULL,false),('keep-protected','protected','exam','غائب',NULL,true),('keep-other-exam','active','other','غائب',NULL,false),('keep-score','active','exam','درجة',10,false);`);
  const recalculations = [], audits = [];
  let mismatch = false;
  // Translate the real route's Prisma predicate to SQL; omitted guards really
  // do expose the protected fixture rows, so this test catches the regression.
  function queryWhere(where) {
    const parts = [], values = [];
    for (const key of ['examId','status','academicEffectExcluded']) if (where[key] !== undefined) {
      values.push(where[key]); parts.push(`g."${key}"=$${values.length}`);
    }
    if (where.student?.is?.status !== undefined) { values.push(where.student.is.status); parts.push(`s.status=$${values.length}`); }
    if (where.id?.in) { values.push(where.id.in); parts.push(`g.id=ANY($${values.length}::text[])`); }
    return { clause: parts.join(' AND ') || 'true', values };
  }
  const client = { grade: {
    findMany: async ({where}) => { const q=queryWhere(where);return (await pg.query(`SELECT g.id,g."studentId" FROM "Grade" g JOIN "Student" s ON s.id=g."studentId" WHERE ${q.clause}`,q.values)).rows; },
    deleteMany: async ({where}) => { const q=queryWhere(where);if(mismatch)return {count:0};const r=await pg.query(`DELETE FROM "Grade" WHERE id IN (SELECT g.id FROM "Grade" g JOIN "Student" s ON s.id=g."studentId" WHERE ${q.clause}) RETURNING id`,q.values);return {count:r.rows.length}; },
  } };
  mocks.set('@/lib/db',{db:{}});
  mocks.set('@/lib/server-auth',{requirePermission:async()=>null});
  mocks.set('@/lib/audit-log-server',{writeRequestAuditLog:async(...args)=>audits.push(args)});
  mocks.set('@/lib/academic-recalculate-server',{recalculateStudentsAcademicState:async ids=>{recalculations.push(ids);return {students:[]};}});
  mocks.set('@/lib/serializable-transaction',{withSerializableTransaction:async fn=>{await pg.exec('BEGIN');try{const result=await fn(client);await pg.exec('COMMIT');return result;}catch(e){await pg.exec('ROLLBACK');throw e;}}});
  const {DELETE} = require('../src/app/api/grades/route.ts');
  const {canBulkClearAbsence,retainUnremovedAbsences} = require('../src/lib/bulk-absence-clear.ts');
  const rows=(await pg.query('SELECT * FROM "Grade" ORDER BY id')).rows;
  const studentRows=(await pg.query('SELECT * FROM "Student" ORDER BY id')).rows;
  const statuses=new Map(studentRows.map(s=>[s.id,s.status]));
  assert.deepEqual(rows.filter(g=>g.examId==='exam'&&canBulkClearAbsence(g,statuses.get(g.studentId))).map(g=>g.id),['remove']);
  mismatch=true;
  assert.equal((await DELETE({url:'https://example.test/api/grades?examId=exam&status=غائب'})).status,409);
  assert.equal(recalculations.length,0,'an incomplete deletion must not recalculate or report success');
  mismatch=false;
  const response = await DELETE({url:'https://example.test/api/grades?examId=exam&status=غائب'});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.deleted,1);
  assert.deepEqual(result.deletedGradeIds,['remove']);
  assert.deepEqual(recalculations,[['active']]);
  const remaining=(await pg.query('SELECT * FROM "Grade" ORDER BY id')).rows;
  assert.deepEqual(retainUnremovedAbsences(rows,'exam',result),remaining,'the sheet must keep the same protected records as the database');
  assert.deepEqual(retainUnremovedAbsences(rows,'exam',{}),rows);
  assert.deepEqual(retainUnremovedAbsences(rows,'exam',{deletedGradeIds:[],studentIds:['dismissed']}),rows);
  assert.ok(retainUnremovedAbsences(rows,'exam',{studentIds:['active']}).some(g=>g.id==='keep-other-exam'));
  assert.deepEqual((await pg.query('SELECT * FROM "Student" ORDER BY id')).rows,studentRows);
  const repeated=await (await DELETE({url:'https://example.test/api/grades?examId=exam&status=غائب'})).json();
  assert.equal(repeated.deleted,0);
  assert.deepEqual(repeated.deletedGradeIds,[]);
  assert.equal(recalculations.length,1,'a repeated click must not recalculate dismissed students');
  assert.equal(audits.length,2);
  await pg.close();
  console.log('PASS: the real bulk DELETE protects dismissed/archived/protected records, scopes recalculation, and reconciles the sheet using actual deleted IDs');
})().catch(e=>{console.error(e);process.exitCode=1});
