const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const { Prisma } = require('@prisma/client');
const resolve=Module._resolveFilename;
Module._resolveFilename=function(r,p,...args){return resolve.call(this,r.startsWith('@/')?path.join(process.cwd(),'src',r.slice(2)):r,p,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
(async()=>{
 const pg=new PGlite();let count=0;
 for(const dir of fs.readdirSync('prisma/migrations').sort()){
  const file=`prisma/migrations/${dir}/migration.sql`;if(!fs.existsSync(file))continue;
  try {await pg.exec(fs.readFileSync(file,'utf8'));count++;}catch(e){throw new Error(`${dir}: ${e.message}`)}
 }
 console.log(`PASS: ${count} migrations bootstrap a fresh PostgreSQL database`);
 await pg.exec(`INSERT INTO "Course" (id,name) VALUES ('c','course'),('c2','course 2');
 INSERT INTO "Exam" (id,name,type,"courseIds",date,"fullMark","passMark","discountMark","opportunitiesPenalty")
 VALUES ('e','exam','يومي','["c"]',(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Baghdad')::date,100,50,20,'1');`);
 assert.equal((await pg.query('SELECT count(*)::int AS n FROM "ExamCourse"')).rows[0].n,1);
 await assert.rejects(pg.exec(`INSERT INTO "ExamCourse" (id,"examId","courseId") VALUES ('wrong','e','c2')`),/projection mismatch/);
 await assert.rejects(pg.exec(`DELETE FROM "ExamCourse" WHERE "examId"='e'`),/projection mismatch/);
 await pg.exec(`UPDATE "Exam" SET "courseIds"='["c","c2"]' WHERE id='e'`);
 assert.equal((await pg.query('SELECT count(*)::int AS n FROM "ExamCourse"')).rows[0].n,2);
 console.log('PASS: exam scope writes synchronize links and direct divergence rolls back');
 const fixtures=[['inside',2,false,false],['boundary',3,false,false],['excluded',1,true,false],['restore',1,false,true],['before',1,false,false]];
 for(const [id,days,excluded,restoring] of fixtures){
  await pg.query(`INSERT INTO "Student" (id,name,gender,code,"courseId","createdAt") VALUES ($1,$1,'ذكر',$1,'c',((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Baghdad')::date - $2::int + TIME '12:00') - INTERVAL '3 hours')`,[id,days]);
  if(id==='inside')await pg.exec(`INSERT INTO "GradeSmartNote" (id,category,"studentId","examId",reason,"updatedAt") VALUES ('n','GRACE_SCORED','inside','e','human reason',CURRENT_TIMESTAMP)`);
  if(id==='before')await pg.exec(`INSERT INTO "Exam" (id,name,type,"courseIds",date,"fullMark","passMark","discountMark","opportunitiesPenalty") VALUES ('old','old','يومي','["c"]',(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Baghdad')::date-10,100,50,20,'1')`);
  await pg.transaction(async tx=>{
   if(restoring)await tx.exec(`SELECT set_config('teacherpro.restore_snapshot','on',true)`);
   await tx.query(`INSERT INTO "Grade" (id,"studentId","examId",status,score,"academicEffectExcluded","academicEffectExclusionSource","updatedAt") VALUES ($1,$1,$2,'درجة',0,$3,CASE WHEN $3 THEN 'P1_TEST' ELSE NULL END,CURRENT_TIMESTAMP)`,[id,id==='before'?'old':'e',excluded]);
  });
  const student=(await pg.query('SELECT "gracePeriodEndedAt" FROM "Student" WHERE id=$1',[id])).rows[0];
  assert.equal(Boolean(student.gracePeriodEndedAt),id==='inside',id);
 }
 assert.equal((await pg.query(`SELECT status FROM "GradeSmartNote" WHERE id='n'`)).rows[0].status,'REJECTED');
 assert.equal((await pg.query(`SELECT "academicEffectExcluded" FROM "Grade" WHERE id='excluded'`)).rows[0].academicEffectExcluded,true);
 console.log('PASS: Baghdad grace exclusive end, zero, pre-registration, category matching and snapshot restore');

 // A SQL-backed Prisma-shaped adapter exercises the actual backup HTTP handlers
 // against PostgreSQL constraints and triggers; it is not a Prisma engine test.
 const modelMap=Object.fromEntries(Prisma.dmmf.datamodel.models.map(m=>[m.name[0].toLowerCase()+m.name.slice(1),m]));
 const bind=v=>v instanceof Date?v.toISOString():v!==null&&typeof v==='object'?JSON.stringify(v):v;
 const sql=(parts,values)=>typeof parts==='object'&&!Array.isArray(parts)&&parts.sql ? {text:parts.sql,values:parts.values||[]} : {text:parts.map((p,i)=>p+(i<values.length?`$${i+1}`:'')).join(''),values:values.map(bind)};
 let failModel=null;const isolation=[];
 function adapter(client){
  const db={};
  for(const [key,model] of Object.entries(modelMap)){
   const table=`"${model.dbName||model.name}"`;
   const columns=new Set(model.fields.filter(f=>f.kind!=='object').map(f=>f.name));
   const selectRows=async(args={})=>{
    const query=await client.query(`SELECT * FROM ${table}`);let rows=query.rows;
    if(args.where?.id) rows=rows.filter(r=>r.id===args.where.id);
    if(args.select)rows=rows.map(r=>Object.fromEntries(Object.keys(args.select).filter(k=>args.select[k]).map(k=>[k,r[k]])));
    return rows;
   };
   db[key]={findMany:selectRows,findUnique:async a=>(await selectRows(a))[0]||null,count:async()=>Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),
    upsert:async a=>{
     if(failModel===key)throw new Error('injected restore failure');
     const exists=(await selectRows({where:a.where}))[0];const row={...(exists?a.update:a.create)};
     for(const k of Object.keys(row))assert.ok(columns.has(k),`unknown ${key}.${k}`);
     const keys=Object.keys(row),vals=keys.map(k=>bind(row[k]));
     const names=keys.map(k=>`"${k}"`).join(',');const placeholders=keys.map((_,i)=>`$${i+1}`).join(',');
     const updates=keys.filter(k=>k!=='id'||a.where.examId_courseId).map(k=>`"${k}"=EXCLUDED."${k}"`).join(',');
     await client.query(`INSERT INTO ${table} (${names}) VALUES (${placeholders}) ON CONFLICT ${a.where.examId_courseId ? '("examId","courseId")' : '(id)'} DO UPDATE SET ${updates}`,vals);return row;
    },
    updateMany:async a=>{const keys=Object.keys(a.data);const result=await client.query(`UPDATE ${table} SET ${keys.map((k,i)=>`"${k}"=$${i+1}`).join(',')} WHERE id=$${keys.length+1}`, [...keys.map(k=>bind(a.data[k])),a.where.id]);return{count:result.affectedRows}},
   };
  }
  db.examCourse.deleteMany=async({where})=>{const ids=where.courseId?.notIn||[];await client.query(`DELETE FROM "ExamCourse" WHERE "examId"=$1 AND NOT ("courseId"=ANY($2::text[]))`,[where.examId,ids]);};
  db.examCourse.createMany=async({data})=>{for(const row of data)await client.query(`INSERT INTO "ExamCourse" (id,"examId","courseId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[row.id,row.examId,row.courseId]);};
  db.$executeRaw=async(parts,...values)=>{const q=sql(parts,values);return client.query(q.text,q.values)};
  db.$transaction=async(fn,opts)=>{isolation.push(opts.isolationLevel);return pg.transaction(tx=>fn(adapter(tx)))};
  return db;
 }
 const db=adapter(pg);
 await pg.exec(`INSERT INTO "Role" (id,name,permissions) VALUES ('r','admin','[]');
 INSERT INTO "AppUser" (id,username,name,role,"roleId",permissions,active,"passwordHash") VALUES ('admin','admin','Admin','admin','r','[]',true,'test-only-credential');
 INSERT INTO "GradeEntryMissingNote" (id,"examId",text,"updatedAt") VALUES ('legacy','e','retained history',CURRENT_TIMESTAMP);
 INSERT INTO "OpportunityLog" (id,action,amount,"studentId","requestedAmount","appliedAmount","ledgerVersion") VALUES ('ledger','إضافة',0,'inside',1,0,2);`);
 const origLoad=Module._load;
 Module._load=function(r,p,...args){
  if(r==='@/lib/db')return{db};
  if(r==='@/lib/server-auth')return{requirePermission:async(_r,permission)=>{assert.ok(['backup.view','backup.restore'].includes(permission));return null},getAuthPrincipal:async()=>({id:'admin',username:'admin'})};
  if(r==='@/lib/schema-readiness')return{assertDatabaseSchemaReady:async()=>{}};
  if(r==='@/lib/api-rate-limit')return{API_RATE_LIMITS:{backup:{}},checkApiRateLimit:async()=>null};
  if(r==='@/lib/audit-log-server')return{writeSystemAuditLog:async()=>{}};
  return origLoad.call(this,r,p,...args);
 };
 const backup=require(path.join(process.cwd(),'src/app/api/backup/route.ts'));
 await pg.exec(`UPDATE "Student" SET code='BIO-90000' WHERE id='inside'; SELECT setval('"Student_code_seq"',1,true);`);
 await pg.exec(`UPDATE "ExamCourse" SET id='legacy-link-id' WHERE "examId"='e' AND "courseId"='c'`);
 const exported=await backup.GET({});assert.equal(exported.status,200);const snapshot=await exported.json();
 assert.equal(isolation.at(-1),'RepeatableRead');assert.equal(snapshot.tableCount,22);assert.equal(snapshot.gradeEntryMissingNotes.length,1);
 assert.equal(snapshot.opportunityLogs[0].requestedAmount,1);assert.equal(snapshot.users[0].passwordHash,undefined);
 let res=await backup.POST({json:async()=>({version:8,confirm:'RESTORE',mode:'replace',backup:{version:8,courses:snapshot.courses}})});assert.equal(res.status,400);
 process.env.TEACHERPRO_ALLOW_RESTORE_REPLACE='1';
 const restore=()=>backup.POST({json:async()=>({version:8,confirm:'RESTORE',mode:'replace',backup:snapshot})});
 failModel='grade';const prior=(await pg.query('SELECT count(*)::int AS n FROM "Grade"')).rows[0].n;
 res=await restore();assert.notEqual(res.status,200);assert.equal((await pg.query('SELECT count(*)::int AS n FROM "Grade"')).rows[0].n,prior);
 failModel=null;res=await restore();if(res.status!==200)console.error(await res.clone().text());assert.equal(res.status,200);
 assert.equal((await pg.query(`SELECT "passwordHash",active FROM "AppUser" WHERE id='admin'`)).rows[0].passwordHash,'test-only-credential');
 assert.equal((await pg.query(`SELECT "gracePeriodEndedAt" FROM "Student" WHERE id='restore'`)).rows[0].gracePeriodEndedAt,null);
 assert.equal((await pg.query(`SELECT text FROM "GradeEntryMissingNote" WHERE id='legacy'`)).rows[0].text,'retained history');
 assert.equal(Number((await pg.query(`SELECT nextval('"Student_code_seq"') AS n`)).rows[0].n),90001);
 assert.equal((await pg.query(`SELECT id FROM "ExamCourse" WHERE "examId"='e' AND "courseId"='c'`)).rows[0].id,'legacy-link-id');
 await pg.exec(`CREATE TABLE "ExternalDependency" (id TEXT PRIMARY KEY, "courseId" TEXT REFERENCES "Course"(id)); INSERT INTO "ExternalDependency" VALUES ('outside','c');`);
 res=await restore();assert.notEqual(res.status,200);
 assert.equal((await pg.query(`SELECT count(*)::int AS n FROM "ExternalDependency"`)).rows[0].n,1);
 console.log('PASS: restored codes advance the sequence and omitted FK dependencies block replacement');
 console.log('PASS: real backup handlers use a complete snapshot, reject partial replace, roll back failures and preserve login/history');
 await pg.close();
})().catch(e=>{console.error(e);process.exitCode=1});
