const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = process.cwd(), resolve = Module._resolveFilename, load = Module._load, mocks = new Map();
Module._resolveFilename = function(r,p,...args) { return resolve.call(this,r.startsWith('@/') ? path.join(root,'src',r.slice(2)) : r,p,...args); };
Module._load = function(r,p,...args) { return mocks.has(r) ? mocks.get(r) : load.call(this,r,p,...args); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);

(async () => {
  const db = new PGlite();
  for (const directory of fs.readdirSync('prisma/migrations').sort()) {
    const file = `prisma/migrations/${directory}/migration.sql`;
    if (fs.existsSync(file)) await db.exec(fs.readFileSync(file,'utf8'));
  }
  await db.exec(`INSERT INTO "Course" (id,name) VALUES ('c','course');
    INSERT INTO "AppUser" (id,username,name,role) VALUES ('admin','admin','test administrator','admin');
    INSERT INTO "Chapter" (id,name,opportunities) VALUES ('ch','chapter',3);
    INSERT INTO "CourseChapter" (id,"courseId","chapterId",active) VALUES ('cc','c','ch',true);
    INSERT INTO "Student" (id,name,gender,code,"courseId",status,opportunities,"baseOpportunities","dismissalReason","dismissalNotes","createdAt")
      SELECT 's'||i,'student '||i,'ذكر','T'||i,'c','مفصول',0,3,'فصل سابق','ملاحظات محفوظة','2026-01-01'::timestamp FROM generate_series(1,7) i;
    INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
      VALUES ('old','old','يومي','2026-02-01','["c"]',20,10,7,1),('pending','pending','يومي','2026-02-02','["c"]',20,10,7,1);
    INSERT INTO "Grade" (id,"studentId","examId",status,"updatedAt") VALUES ('old-g','s1','old','غائب',CURRENT_TIMESTAMP);
    INSERT INTO "GradeSmartNote" (id,"studentId","examId",category,score,"updatedAt")
      VALUES ('p1','s1','pending','DISMISSED_PENDING',12,CURRENT_TIMESTAMP),('p2','s1','old','DISMISSED_PENDING',15,CURRENT_TIMESTAMP);
    INSERT INTO "OpportunityLog" (id,"studentId",action,amount,reason) VALUES ('history','s1','فصل تلقائي',0,'سبب الفصل الأصلي');`);

  function predicate(where, values=[]) {
    const flat = where.studentId_examId || where;
    return { values, clause: Object.entries(flat).map(([key,value]) => { values.push(value);return `"${key}"=$${values.length}`; }).join(' AND ') || 'true' };
  }
  const rows = async (table, where={}) => { const p=predicate(where);return (await db.query(`SELECT * FROM "${table}" WHERE ${p.clause} ORDER BY id`,p.values)).rows; };
  const insert = async (table, data) => {
    const value = {id:randomUUID(),...data};
    if (['Grade','GradeSmartNote'].includes(table)) value.updatedAt ||= new Date();
    const keys=Object.keys(value);return (await db.query(`INSERT INTO "${table}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(value))).rows[0];
  };
  const update = async (table, where, data) => {
    const values=Object.values(data), p=predicate(where,values);
    return (await db.query(`UPDATE "${table}" SET ${Object.keys(data).map((k,i)=>`"${k}"=$${i+1}`).join(',')} WHERE ${p.clause} RETURNING *`,p.values)).rows;
  };
  const tx = {};
  for (const [model,table] of Object.entries({student:'Student',grade:'Grade',opportunityLog:'OpportunityLog',studentNote:'StudentNote',auditLog:'AuditLog',gradeSmartNote:'GradeSmartNote'})) {
    tx[model] = {
      findUnique: async ({where}) => (await rows(table,where))[0] || null,
      findMany: async ({where={}}={}) => rows(table,where),
      create: async ({data}) => insert(table,data),
      update: async ({where,data}) => (await update(table,where,data))[0],
      updateMany: async ({where,data}) => ({count:(await update(table,where,data)).length}),
      createMany: async ({data}) => { for (const row of data) await insert(table,row);return {count:data.length}; },
    };
  }
  tx.courseChapter = {findMany:async ({where}) => Promise.all((await rows('CourseChapter',where)).map(async link=>({...link,chapter:(await rows('Chapter',{id:link.chapterId}))[0]})))};
  tx.gradeSmartNote.findMany = async ({where}) => Promise.all((await rows('GradeSmartNote',where)).map(async note=>({...note,exam:(await rows('Exam',{id:note.examId}))[0]})));
  let failAudit = false, recalculations = 0;
  tx.auditLog.create = async ({data}) => { if (failAudit) throw new Error('injected audit failure');return insert('AuditLog',data); };
  const principal={id:'admin',name:'test administrator',isAdmin:true,permissions:[]};
  mocks.set('@/lib/db',{db:{}});
  const {NextResponse} = require('next/server');
  mocks.set('@/lib/server-auth',{
    requirePermissionPrincipal:async (_req,permission)=>principal.isAdmin || principal.permissions.includes(permission) ? principal : NextResponse.json({error:'forbidden'},{status:403}),
    hasPermission:(actor,permission)=>actor.isAdmin || actor.permissions.includes(permission),
  });
  mocks.set('@/lib/api-rate-limit',{API_RATE_LIMITS:{studentOpportunitySync:{}},checkApiRateLimit:async()=>null});
  mocks.set('@/lib/schema-readiness',{withDatabaseSchema:async fn=>fn()});
  mocks.set('@/lib/audit-log-server',{writeRequestAuditLog:async()=>{}});
  mocks.set('@/lib/student-opportunity-snapshot-server',{attachStudentOpportunitySnapshots:async students=>students});
  mocks.set('@/lib/academic-recalculate-server',{recalculateStudentsAcademicState:async()=>{recalculations++;return {students:[]};}});
  mocks.set('@/lib/serializable-transaction',{withSerializableTransaction:async fn=>{
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try { const result=await fn(tx);await db.exec('COMMIT');return result; }
    catch(error) { await db.exec('ROLLBACK');throw error; }
  }});
  const opportunityAction=require('../src/app/api/opportunities/student-action/route.ts').POST;
  const statusAction=require('../src/app/api/students/status-action/route.ts').POST;
  const {buildStudentMutationToken}=require('../src/lib/student-mutation-token.ts');
  const {recalculateAcademicState}=require('../src/lib/academic-engine.ts');
  const {hasTwoOpportunityPledge}=require('../src/lib/student-report-presentation.ts');
  const {DEFAULT_MANUAL_RESTORATION_REASON}=require('../src/lib/manual-restoration.ts');
  const call=async (route,body)=>{const r=await route({json:async()=>body});return {status:r.status,body:await r.json()};};
  const snapshot=async()=>{const tables={};for(const table of ['Student','Grade','GradeSmartNote','OpportunityLog','StudentNote','AuditLog'])tables[table]=await rows(table);return tables;};
  const manual=(studentId,amount,extra={})=>({action:'reactivate',reactivationMode:'manual',studentId,amount,reason:'تصحيح فصل بالخطأ',expectedStatus:'مفصول',...extra});

  const before=await snapshot();
  for (const amount of [0,-1,1.5,'',null,{},4]) {
    assert.equal((await call(statusAction,manual('s1',amount))).status,400);
  }
  assert.equal((await call(statusAction,manual('s1',1,{reason:''}))).status,400);
  assert.equal((await call(statusAction,manual('s1',1,{expectedMutationToken:'stale'}))).status,409);
  assert.deepEqual(await snapshot(),before,'invalid amount/reason/snapshot must not write anything');
  principal.isAdmin=false;principal.permissions=['opportunities.manage'];
  assert.equal((await call(opportunityAction,{studentId:'s1',actionType:'add',amount:1})).status,403);
  assert.deepEqual(await snapshot(),before,'restoring requires student edit permission in addition to opportunity management');
  principal.isAdmin=true;
  await update('CourseChapter',{id:'cc'},{active:false});
  assert.equal((await call(statusAction,manual('s1',1))).status,409);
  await update('CourseChapter',{id:'cc'},{active:true});
  failAudit=true;
  const oldConsole=console.error;console.error=()=>{};
  try { assert.equal((await call(statusAction,manual('s1',1))).status,500); } finally {console.error=oldConsole;}
  failAudit=false;
  assert.deepEqual(await snapshot(),before,'audit failure must roll back status, balance, pending migration and logs together');

  const added=await call(opportunityAction,{studentId:'s1',actionType:'add',amount:1,expectedStatus:'مفصول'});
  assert.equal(added.status,200);assert.equal(added.body.reactivated,true);
  assert.equal(added.body.student.status,'نشط');assert.equal(added.body.student.opportunities,1);
  assert.equal(added.body.opportunityLog.reason,DEFAULT_MANUAL_RESTORATION_REASON);
  assert.equal(recalculations,0,'recovery must never replay old penalties before or during the grant');
  assert.deepEqual(await rows('Grade',{id:'old-g'}),before.Grade,'official absence must remain exactly unchanged');
  const migrated=(await rows('Grade',{studentId:'s1',examId:'pending'}))[0];
  assert.equal(migrated.score,12);assert.equal(migrated.academicEffectExcluded,true);
  assert.equal((await rows('GradeSmartNote',{id:'p2'}))[0].status,'CONFLICT','existing official grade wins over pending score');
  const logs1=await rows('OpportunityLog',{studentId:'s1'});
  assert.deepEqual(logs1.find(l=>l.id==='history'),before.OpportunityLog[0]);
  assert.equal(hasTwoOpportunityPledge(logs1),false,'manual restoration must not be presented as a pledge');
  assert.match((await rows('StudentNote',{studentId:'s1'}))[0].text,/فصل سابق.*ملاحظات محفوظة/);
  const afterFirst=await snapshot();
  assert.equal((await call(opportunityAction,{studentId:'s1',actionType:'add',amount:1,expectedStatus:'مفصول'})).status,409);
  assert.equal((await call(statusAction,manual('s1',2))).status,409);
  assert.deepEqual(await snapshot(),afterFirst,'repeated recovery requests must not add another opportunity or record');

  const token=buildStudentMutationToken((await rows('Student',{id:'s3'}))[0]);
  const restored3=await call(statusAction,manual('s3',3,{expectedMutationToken:token}));
  assert.equal(restored3.status,200);assert.equal(restored3.body.student.opportunities,3);
  const pledged=await call(statusAction,{action:'reactivate',studentId:'s2',expectedStatus:'مفصول'});
  assert.equal(pledged.status,200);assert.equal(pledged.body.student.opportunities,2);
  assert.equal(hasTwoOpportunityPledge(await rows('OpportunityLog',{studentId:'s2'})),true);
  const restore2=await call(statusAction,manual('s4',2));assert.equal(restore2.status,200);
  assert.equal(hasTwoOpportunityPledge(await rows('OpportunityLog',{studentId:'s4'})),false);

  await update('Student',{id:'s5'},{status:'مؤرشف'});
  assert.equal((await call(opportunityAction,{studentId:'s5',actionType:'add',amount:1})).status,409);
  assert.equal((await call(statusAction,manual('s5',1,{expectedStatus:'مؤرشف'}))).status,409);
  assert.equal((await call(opportunityAction,{studentId:'s6',actionType:'deduct',amount:1,reason:'test'})).status,409);
  const unchanged=(await rows('Student')).filter(s=>['s6','s7'].includes(s.id));
  assert.deepEqual(unchanged,before.Student.filter(s=>['s6','s7'].includes(s.id)),'other students must remain untouched');

  // Replay the actual persisted grants through the real academic engine.
  const toIso=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date ? value.toISOString() : value]));
  const state={students:(await rows('Student')).map(toIso),grades:(await rows('Grade')).map(toIso),exams:(await rows('Exam')).map(e=>({...toIso(e),courseIds:JSON.parse(e.courseIds)})),chapters:await rows('Chapter'),courseChapters:await rows('CourseChapter'),opportunityLogs:(await rows('OpportunityLog')).map(toIso),studentLeaves:[],studentNotes:(await rows('StudentNote')).map(toIso)};
  const targetIds=new Set(['s1','s2','s3','s4']);
  const replay=input=>recalculateAcademicState(input,targetIds).students;
  // Even moving an already-settled absence to the recovery day must not
  // charge it again; a date-only recovery boundary would fail this case.
  state.exams.find(e=>e.id==='old').date=state.opportunityLogs.find(l=>l.studentId==='s1' && l.action==='رصيد إعادة التفعيل').date;
  for(let i=0;i<3;i++) state.students=replay(state);
  assert.deepEqual(state.students.filter(s=>targetIds.has(s.id)).map(s=>[s.id,s.status,s.opportunities]),[['s1','نشط',1],['s2','نشط',2],['s3','نشط',3],['s4','نشط',2]]);
  const RealDate=Date, recoveryTime=Date.now();
  try {
    for(const [index,id] of ['future1','future2'].entries()) {
      const examTime=recoveryTime+(index+1)*86400000;
      const date=new RealDate(examTime).toISOString();
      global.Date=class extends RealDate {
        constructor(...args) { if(args.length) super(...args);else super(examTime+60000); }
        static now() { return examTime+60000; }
      };
      state.exams.push({id,name:id,type:'يومي',date,fullMark:20,passMark:10,discountMark:7,opportunitiesPenalty:1,noDiscount:false,active:true,courseIds:['c']});
      state.grades.push({id:'g'+id,studentId:'s1',examId:id,status:'غائب',score:null,createdAt:date,updatedAt:date});
      state.students=replay(state);
      const student=state.students.find(s=>s.id==='s1');
      assert.equal(student.opportunities,0);assert.equal(student.status,index===0 ? 'نشط' : 'مفصول');
    }
  } finally { global.Date=RealDate; }
  const legacy=structuredClone(state);legacy.grades=[];
  legacy.opportunityLogs=legacy.opportunityLogs.filter(l=>l.studentId!=='s3');
  legacy.opportunityLogs.push({id:'legacy',studentId:'s3',action:'رصيد إعادة التفعيل',amount:1,reason:'تعهد قديم',ledgerVersion:null,date:new Date().toISOString(),chapterId:'ch'});
  assert.equal(replay(legacy).find(s=>s.id==='s3').opportunities,2,'legacy pledge interpretation remains unchanged');
  await db.close();
  console.log('PASS: both real recovery APIs, strict validation, atomic rollback, no duplicate grants, preserved grade history, pending-grade conflicts, 1/2/3-chance replay, future dismissal law, and unchanged pledges');
})().catch(error=>{console.error(error);process.exitCode=1;});
