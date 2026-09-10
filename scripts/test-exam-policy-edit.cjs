// Actual exam PUT, academic engine and SQL persistence, backed by every migration.
// Prisma-shaped adapter executes real PostgreSQL statements; timings are not production benchmarks.
// PGlite's timestamp parser uses the process timezone; Prisma DateTimes are UTC.
process.env.TZ='UTC';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {randomUUID}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite'),{Prisma}=require('@prisma/client'),ts=require('typescript');
const root=process.cwd(),resolve=Module._resolveFilename,load=Module._load,mocks=new Map();
Module._resolveFilename=function(r,p,...a){return resolve.call(this,r.startsWith('@/')?path.join(root,'src',r.slice(2)):r,p,...a)};
Module._load=function(r,p,...a){return mocks.has(r)?mocks.get(r):load.call(this,r,p,...a)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);

(async()=>{
 const pg=new PGlite();
 for(const dir of fs.readdirSync('prisma/migrations').sort()){
  const f=`prisma/migrations/${dir}/migration.sql`;if(fs.existsSync(f))await pg.exec(fs.readFileSync(f,'utf8'));
 }
 const models=new Map(Prisma.dmmf.datamodel.models.map(m=>[m.name[0].toLowerCase()+m.name.slice(1),m]));
 let failWrite=null,deny=false;const statements=[],audits=[];
 const bind=v=>v instanceof Date?v.toISOString():v;
 const query=async(text,values=[])=>{statements.push(text);return pg.query(text,values.map(bind));};
 const all=async model=>(await query(`SELECT * FROM "${models.get(model).name}" ORDER BY id`)).rows;
 const scalar=(value,test)=>{
  if(test===null||typeof test!=='object'||test instanceof Date)return test instanceof Date?+value===+test:value===test;
  return Object.entries(test).every(([op,arg])=>{
   if(op==='mode')return true;
   if(op==='in')return arg.includes(value);if(op==='notIn')return !arg.includes(value);
   if(op==='not')return !scalar(value,arg);if(op==='equals')return scalar(value,arg);
   if(op==='gte')return value>=arg;if(op==='lte')return value<=arg;if(op==='gt')return value>arg;if(op==='lt')return value<arg;
   if(op==='contains'||op==='startsWith')return value!=null&&(op==='contains'?String(value).toLowerCase().includes(String(arg).toLowerCase()):String(value).startsWith(arg));
   throw Error('Unsupported predicate '+op);
  });
 };
 const matches=async(model,row,where={})=>{
  for(const [key,test]of Object.entries(where)){
   if(key==='AND'||key==='OR'||key==='NOT'){
    const results=await Promise.all((Array.isArray(test)?test:[test]).map(w=>matches(model,row,w)));
    if(!(key==='AND'?results.every(Boolean):key==='OR'?results.some(Boolean):results.every(x=>!x)))return false;
   }else if(key==='studentId_examId'||key==='leaveId_studentId_examId') {if(!await matches(model,row,test))return false;}
   else if(key==='student'||key==='exam'){
    const related=(await all(key)).find(r=>r.id===row[key+'Id']);
    if(!related||!await matches(key,related,test.is||test))return false;
   }else if(!scalar(row[key],test))return false;
  }
  return true;
 };
 const project=async(model,row,args,relations=new Map())=>{
  if(!row)return null;const out=args.select?{}:{...row};
  for(const [key,spec]of Object.entries(args.select||args.include||{})){
   if(!spec)continue;
   if(typeof spec==='object'||(args.include&&['student','exam'].includes(key))){
    const relation=key==='examCourses'?'examCourse':key;
    if(!relations.has(relation))relations.set(relation,all(relation));
    const related=(await relations.get(relation)).filter(r=>key==='examCourses'?r.examId===row.id:r.id===row[key+'Id']);
    out[key]=key==='examCourses'?await Promise.all(related.map(r=>project(relation,r,spec,relations))):await project(relation,related[0],spec===true?{}:spec,relations);
   }else out[key]=row[key];
  }
  return out;
 };
 const find=async(model,args={})=>{
  const values=[],parts=[];
  for(const [key,test] of Object.entries(args.where||{})){
   if(!models.get(model).fields.some(f=>f.name===key&&f.kind!=='object'))continue;
   if(test===null)parts.push('"'+key+'" IS NULL');
   else if(typeof test!=='object'||test instanceof Date){values.push(test);parts.push('"'+key+'"=$'+values.length);}
   else if(test.in){values.push(test.in);parts.push('"'+key+'"=ANY($'+values.length+'::text[])');}
  }
  const candidates=(await query('SELECT * FROM "'+models.get(model).name+'"'+(parts.length?' WHERE '+parts.join(' AND '):'')+' ORDER BY id',values)).rows;
  let rows=[];for(const r of candidates)if(await matches(model,r,args.where))rows.push(r);
  const order=args.orderBy?Array.isArray(args.orderBy)?args.orderBy:[args.orderBy]:[];
  rows.sort((a,b)=>{for(const obj of order)for(const [k,dir]of Object.entries(obj)){if(a[k]!==b[k]){const c=a[k]<b[k]?-1:a[k]>b[k]?1:0;if(c)return dir==='desc'?-c:c;}}return 0;});
  rows=rows.slice(args.skip||0,args.take==null?undefined:(args.skip||0)+args.take);
  if(args.distinct){const seen=new Set();rows=rows.filter(r=>{const k=JSON.stringify(args.distinct.map(f=>r[f]));if(seen.has(k))return false;seen.add(k);return true;});}
  const relations=new Map();return Promise.all(rows.map(r=>project(model,r,args,relations)));
 };
 const client={};
 for(const [key,model]of models){
  const table=`"${model.name}"`,hasUpdated=model.fields.some(f=>f.name==='updatedAt');
  const insert=async(data,skip=false)=>{
   if(failWrite===key)throw Error('injected write failure');
   if(!data.length)return [];
   const rows=data.map(d=>({id:randomUUID(),...(hasUpdated?{updatedAt:new Date()}:{}),...d}));
   const keys=[...new Set(rows.flatMap(Object.keys))],values=[];
   const tuples=rows.map(row=>'('+keys.map(k=>{values.push(row[k]??null);return '$'+values.length;}).join(',')+')');
   return (await query(`INSERT INTO ${table} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES ${tuples.join(',')} ${skip?'ON CONFLICT DO NOTHING':''} RETURNING *`,values)).rows;
  };
  const update=async args=>{
   if(failWrite===key)throw Error('injected write failure');
   const ids=(await find(key,{where:args.where})).map(r=>r.id);if(!ids.length)return [];
   const data={...(hasUpdated?{updatedAt:new Date()}:{}),...args.data},values=Object.values(data);values.push(ids);
   return (await query(`UPDATE ${table} SET ${Object.keys(data).map((k,i)=>'"'+k+'"=$'+(i+1)).join(',')} WHERE id=ANY($${values.length}::text[]) RETURNING *`,values)).rows;
  };
  client[key]={findMany:a=>find(key,a),findFirst:async a=>(await find(key,{...a,take:1}))[0]||null,findUnique:async a=>(await find(key,{...a,take:1}))[0]||null,
   count:async a=>(await find(key,a)).length,
   create:async a=>project(key,(await insert([a.data]))[0],a),createMany:async a=>({count:(await insert(a.data,a.skipDuplicates)).length}),
   update:async a=>project(key,(await update(a))[0],a),updateMany:async a=>({count:(await update(a)).length}),
   deleteMany:async a=>{if(failWrite===key)throw Error('injected write failure');const ids=(await find(key,a)).map(r=>r.id);return {count:(await query(`DELETE FROM ${table} WHERE id=ANY($1::text[]) RETURNING id`,[ids])).rows.length};},
   delete:async a=>{const row=(await find(key,a))[0];await client[key].deleteMany(a);return row;},
   upsert:async a=>{const row=(await find(key,{where:a.where}))[0];return row?project(key,(await update({where:{id:row.id},data:a.update}))[0],a):project(key,(await insert([a.create]))[0],a);},
  };
 }
 const raw=(parts,values)=>parts.text?{text:parts.text,values:parts.values}:{text:parts.map((p,i)=>p+(i<values.length?'$'+(i+1):'')).join(''),values};
 client.$queryRaw=async(parts,...values)=>{const q=raw(parts,values);return (await query(q.text,q.values)).rows;};
 client.$executeRaw=async(parts,...values)=>{const q=raw(parts,values);return (await query(q.text,q.values)).affectedRows;};
 mocks.set('@/lib/db',{db:client});
 mocks.set('@/lib/server-auth',{requirePermission:async()=>deny?new Response('{}',{status:403}):null});
 mocks.set('@/lib/schema-readiness',{assertDatabaseSchemaReady:async()=>{}});
 mocks.set('@/lib/audit-log-server',{writeRequestAuditLog:async(...args)=>audits.push(args)});
 mocks.set('@/lib/serializable-transaction',{withSerializableTransaction:async fn=>{await pg.exec('BEGIN');try{const result=await fn(client);await pg.exec('COMMIT');return result;}catch(e){await pg.exec('ROLLBACK');throw e;}}});
 const markerCalls=[];
 const markers=require('../src/lib/protected-grade-markers-server.ts');
 const repairs=require('../src/lib/grace-period-repair-server.ts');
 mocks.set('@/lib/protected-grade-markers-server',Object.fromEntries(Object.entries(markers).map(([key,fn])=>[key,async(...args)=>{markerCalls.push(key);return fn(...args);}])));
 mocks.set('@/lib/grace-period-repair-server',{...repairs,repairProtectedAbsencesForStudents:async(...args)=>{markerCalls.push('repairProtectedAbsencesForStudents');return repairs.repairProtectedAbsencesForStudents(...args);}});
 const route=require('../src/app/api/exams/route.ts');
 const {previewStudentsAcademicState}=require('../src/lib/academic-recalculate-server.ts');
 const {buildMutationPreviewToken}=require('../src/lib/mutation-preview-token.ts');
 await pg.exec(`INSERT INTO "Course"(id,name) VALUES('c','الصيفية الأولى'),('isolated','دورة أخرى');
 INSERT INTO "Chapter"(id,name,opportunities) VALUES('ch','الفصل الثاني',3),('old-ch','الفصل الأول',3);
 INSERT INTO "CourseChapter"(id,"courseId","chapterId",active) VALUES('cc','c','ch',true),('ic','isolated','ch',true);
 INSERT INTO "Student"(id,name,"nameKey",gender,code,"courseId","mainSite","createdAt","baseOpportunities",opportunities,"accountingGraceDays",school)
 SELECT 's'||i,'طالب اختبار '||i,'test-'||i,'ذكر','T-'||i,'c','بغداد','2026-06-01',3,1,0,'يبقى محفوظاً' FROM generate_series(1,1000)i;
 INSERT INTO "Student"(id,name,"nameKey",gender,code,"courseId","mainSite","createdAt","baseOpportunities",opportunities)
 VALUES('untouched','آخر','other','ذكر','OTHER','isolated','بغداد','2026-06-01',3,2),('scope','تغيير تاريخ','scope','ذكر','SCOPE','isolated','بغداد','2026-09-07',3,3),('archive','أرشيف','archive','ذكر','ARCHIVE','c','بغداد','2026-06-01',3,3);
 UPDATE "Student" SET status='مفصول',opportunities=0,"dismissalReason"='قرار إداري',"dismissalNotes"='لا تستعده من تعديل امتحان' WHERE id='s2';
 UPDATE "Student" SET status='مؤرشف' WHERE id='archive';
 UPDATE "Student" SET opportunities=2 WHERE id IN('s3','s4');
 INSERT INTO "Exam"(id,name,type,date,"courseIds","mainSite","fullMark","passMark","discountMark","opportunitiesPenalty")
 VALUES('e9','الفصل الثاني - الامتحان التاسع (ص1)','يومي','2026-09-08 23:00','["c"]','بغداد',20,10,7,'1'),
 ('e8','الفصل الثاني - الامتحان الثامن','يومي','2026-09-05 23:00','["c"]','بغداد',20,10,7,'1'),
 ('historic','امتحان الفصل السابق','يومي','2026-07-17 23:00','["c"]','بغداد',20,10,7,'1'),
 ('scope-exam','امتحان تغيير التاريخ','يومي','2026-09-05 23:00','["isolated"]','بغداد',20,10,7,'1');
 UPDATE "ExamCourse" SET "chapterId"='old-ch' WHERE "examId"='historic';
 INSERT INTO "Grade"(id,"studentId","examId",status,notes,"createdAt","updatedAt")
 SELECT s.id||'_'||e,s.id,e,'غائب','سجل أصلي','2026-09-09 01:00','2026-09-09 01:30' FROM "Student" s CROSS JOIN unnest(ARRAY['e8','e9'])e WHERE s."courseId"='c';
 UPDATE "Grade" SET status='مجاز',notes='إجازة محفوظة' WHERE id='s3_e9';
 UPDATE "Grade" SET status='درجة',score=15,notes='درجة حقيقية' WHERE id='s4_e9';
 INSERT INTO "Grade"(id,"studentId","examId",status,notes,"updatedAt") VALUES('scope-grade','scope','scope-exam','قبل تسجيل الطالب','علامة قديمة',CURRENT_TIMESTAMP);
 INSERT INTO "StudentLeave"(id,"studentId","examId","leaveType",reason,date,"dateFrom","dateTo",notes,"createdAt")
 VALUES('leave-e9','s3','e9','exam','مرضية','2026-09-08 23:00','2026-09-08 23:00','2026-09-08 23:00','محفوظة','2026-09-09 02:00');
 INSERT INTO "StudentLeaveGradeBackup"(id,"leaveId","studentId","examId",status,score,notes,"gradeCreatedAt","gradeUpdatedAt")
 VALUES('backup-e9','leave-e9','s3','e9','درجة',0,'صفر محفوظ','2026-09-09 00:00','2026-09-09 01:00');
 INSERT INTO "OpportunityLog"(id,"studentId","examId",action,amount,reason,date,"chapterId","chapterNameSnapshot")
 SELECT s.id||'_'||e||'_deduction',s.id,e,'خصم تلقائي',1,'تلقائي: غياب في امتحان يومي: '||x.name,x.date,'ch','الفصل الثاني'
 FROM "Student"s CROSS JOIN unnest(ARRAY['e8','e9'])e JOIN "Exam"x ON x.id=e
 WHERE s."courseId"='c' AND s.status<>'مؤرشف' AND NOT(s.id IN('s3','s4') AND e='e9');
 INSERT INTO "OpportunityLog"(id,"studentId","examId",action,amount,reason,date,"chapterId","balanceBefore","balanceAfter","requestedAmount","appliedAmount","ledgerVersion","settledGradeIds","chapterNameSnapshot")
 VALUES('keep-history','s1','historic','خصم تلقائي',1,'تلقائي: من الفصل السابق','2026-07-17 23:00','old-ch',3,2,1,1,2,'["old-grade"]','الفصل الأول');`);
 const row=async(model,id)=>client[model].findUnique({where:{id}});
 const snapshot=async()=>{
  const out={};for(const name of ['Exam','ExamCourse','Student','Grade','StudentLeave','StudentLeaveGradeBackup','OpportunityLog'])out[name]=(await pg.query(`SELECT * FROM "${name}" ORDER BY id`)).rows;
  return out;
 };
 const put=async patch=>{const response=await route.PUT({url:'https://example.test/api/exams',json:async()=>patch});return {status:response.status,data:await response.json()};};
 await pg.exec(`INSERT INTO "OpportunityLog"(id,"studentId","examId",action,amount,reason,date,"chapterId","balanceBefore","balanceAfter","ledgerVersion") VALUES('keep-unassigned-history','s1','historic','خصم تلقائي',1,'تلقائي: سجل قديم بلا فصل','2026-07-17 23:00',NULL,3,2,2);`);
 // Seed an unchanged current automatic log using the real engine's canonical
 // identity, then retain historical ledger metadata that replay cannot rebuild.
 const canonical=(await previewStudentsAcademicState(['s1'],{tx:client})).automaticOpportunityLogs.find(l=>l.examId==='e8');
 assert.ok(canonical);
 await client.opportunityLog.deleteMany({where:{id:'s1_e8_deduction'}});
 await client.opportunityLog.create({data:{...canonical,date:new Date(canonical.date),requestedAmount:1,appliedAmount:1,balanceBefore:3,balanceAfter:2,ledgerVersion:2,settledGradeIds:'["s1_e8"]'}});
 const before=await snapshot(),original=await row('exam','e9');
 const fullPayload={id:'e9',name:original.name,type:original.type,courseIds:['c'],mainSite:'بغداد',date:'2026-09-09',fullMark:20,passMark:10,discountMark:0,opportunitiesPenalty:0,dismissalGrade:null,noDiscount:true,active:true,scheduledActivateAt:null,
  expectedMutationToken:buildMutationPreviewToken('exam-edit:e9',original)};
 const writesStart=statements.length;
 const changed=await put(fullPayload);
 assert.equal(changed.status,200,JSON.stringify(changed.data));
 assert.equal(changed.data.exam.noDiscount,true);
 assert.equal(changed.data.exam.discountMark,0);assert.equal(changed.data.exam.opportunitiesPenalty,'0');assert.equal(changed.data.exam.dismissalGrade,null);
 assert.equal(new Date(changed.data.exam.date).toISOString(),original.date.toISOString(),'UI resubmission of unchanged Baghdad day must retain the existing timestamp');
 assert.deepEqual(markerCalls,[],'policy edit must not rebuild protected markers or repair unrelated grades');
 const after=await snapshot();
 for(const table of ['Grade','StudentLeave','StudentLeaveGradeBackup','ExamCourse'])assert.deepEqual(after[table],before[table],table+' unchanged by policy edit');
 assert.deepEqual(after.OpportunityLog.find(l=>l.id==='keep-history'),before.OpportunityLog.find(l=>l.id==='keep-history'),'historical automatic log keeps ID and ledger metadata');
 for(const id of ['keep-unassigned-history',canonical.id])assert.deepEqual(after.OpportunityLog.find(l=>l.id===id),before.OpportunityLog.find(l=>l.id===id),'preserved history/current metadata '+id);
 for(const id of ['keep-history','keep-unassigned-history',canonical.id]){
  const stored=before.OpportunityLog.find(l=>l.id===id),returned=changed.data.academicRecalculation.opportunityLogs.find(l=>l.id===id);
  assert.ok(returned,'preserved log included in response '+id);
  for(const field of ['requestedAmount','appliedAmount','balanceBefore','balanceAfter','ledgerVersion','settledGradeIds'])assert.deepEqual(returned[field],stored[field],'response retains persisted '+field+' for '+id);
 }
 assert.equal(after.OpportunityLog.filter(l=>l.examId==='e9'&&l.chapterId==='ch'&&l.action==='خصم تلقائي').length,0,'chosen exam stops deducting');
 assert.equal(after.OpportunityLog.filter(l=>l.examId==='e8'&&l.action==='خصم تلقائي').length,1000,'other active exam still deducts');
 assert.equal((await row('student','s1')).opportunities,2);
 assert.equal((await row('student','s2')).status,'مفصول');assert.equal((await row('student','s2')).opportunities,0);assert.equal((await row('student','s2')).dismissalReason,'قرار إداري');
 for(const id of ['untouched','scope','archive'])assert.deepEqual(after.Student.find(s=>s.id===id),before.Student.find(s=>s.id===id),'unrelated/archive student unchanged');
 for(const student of after.Student){const stored=before.Student.find(s=>s.id===student.id);for(const key of Object.keys(stored))if(!['status','opportunities','dismissalReason'].includes(key))assert.deepEqual(student[key],stored[key],student.id+' '+key+' unchanged');}
 const studentWrites=statements.slice(writesStart).filter(sql=>/UPDATE\s+"Student"\s/i.test(sql));
 assert.equal(studentWrites.length,Math.ceil(changed.data.academicRecalculation.studentIds.length/500),'count CTE and scalar Student updates: one statement per 500 targets');
 assert.ok(studentWrites.every(sql=>/WITH\s+input/i.test(sql)),'no individual student writes in policy recalculation');
 assert.ok(changed.data.academicRecalculation.studentIds.length>=1000);
 // Minimal noDiscount request remains supported and repeated save is idempotent.
 const idempotentBefore=await snapshot();
 const minimal=await put({id:'e9',noDiscount:true});assert.equal(minimal.status,200);assert.equal(minimal.data.academicRecalculation,null);
 assert.deepEqual(await snapshot(),idempotentBefore);
 // Stale optimistic concurrency token rejects before all writes.
 const stale=await put({...fullPayload,noDiscount:false,discountMark:7,opportunitiesPenalty:1});
 assert.equal(stale.status,409);assert.equal(stale.data.requiresFreshExam,true);assert.deepEqual(await snapshot(),idempotentBefore);
 // Fail after student persistence begins: the exam, balances and logs roll back together.
 failWrite='opportunityLog';
 const failed=await put({id:'e9',noDiscount:false,discountMark:7,opportunitiesPenalty:1});
 failWrite=null;assert.equal(failed.status,500);assert.deepEqual(await snapshot(),idempotentBefore,'transaction rollback restores exam and every related table');
 // Re-enable the policy, then exercise a genuinely changing minimal request.
 assert.equal((await put({id:'e9',noDiscount:false,discountMark:7,opportunitiesPenalty:1})).status,200);
 const minimalChanged=await put({id:'e9',noDiscount:true});assert.equal(minimalChanged.status,200);assert.equal((await row('student','s1')).opportunities,2);
 assert.deepEqual((await snapshot()).Grade,before.Grade);
 // A true exam-day edit must still reconcile registration protection.
 markerCalls.length=0;
 const moved=await put({id:'scope-exam',date:'2026-09-08'});assert.equal(moved.status,200,JSON.stringify(moved.data));
 assert.ok(markerCalls.includes('reconcileProtectedGradeMarkersForExamEdit'));
 assert.ok(markerCalls.includes('ensureProtectedGradeMarkers'));
 const scopeGrade=await client.grade.findFirst({where:{studentId:'scope',examId:'scope-exam'}});assert.equal(scopeGrade.status,'ضمن فترة السماح','moving exam after registration replaces old marker with the correct grace marker');
 assert.equal(await client.grade.count({where:{studentId:'scope',examId:'scope-exam'}}),1,'stale protected marker replaced once');
 const deniedBefore=await snapshot();deny=true;assert.equal((await put({id:'e9',noDiscount:false})).status,403);deny=false;assert.deepEqual(await snapshot(),deniedBefore);
 assert.ok(audits.some(a=>a[3]?.examId==='e9'&&a[3]?.recalculatedStudents>=1000));
 await pg.close();
 console.log('PASS: actual exams PUT + migrations, 1,000-student no-discount update, unchanged Baghdad day and grade/leave/backups/history preserved, bounded student SQL writes, manual dismissal retained, idempotence, stale edit, authorization, rollback and real date-scope reconciliation');
})().catch(e=>{console.error(e);process.exitCode=1});
