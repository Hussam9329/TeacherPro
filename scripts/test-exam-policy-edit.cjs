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
   if(typeof spec==='object'||(args.include&&['student','exam','examCourses'].includes(key))){
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
  const out={};for(const name of ['Exam','ExamCourse','Student','Grade','StudentLeave','StudentLeaveGradeBackup','OpportunityLog','StudentNote'])out[name]=(await pg.query(`SELECT * FROM "${name}" ORDER BY id`)).rows;
  return out;
 };
 const put=async patch=>{const response=await route.PUT({url:'https://example.test/api/exams',json:async()=>patch});return {status:response.status,data:await response.json()};};
 await pg.exec(`INSERT INTO "OpportunityLog"(id,"studentId","examId",action,amount,reason,date,"chapterId","balanceBefore","balanceAfter","ledgerVersion") VALUES('keep-unassigned-history','s1','historic','خصم تلقائي',1,'تلقائي: سجل قديم بلا فصل','2026-07-17 23:00',NULL,3,2,2);`);
 // Seed current automatic IDs with the actual engine so settled historical
 // evidence can be distinguished from deductions the changed policy removes.
 const baselineReplay=await previewStudentsAcademicState(Array.from({length:1000},(_,i)=>'s'+(i+1)),{tx:client});
 await client.opportunityLog.deleteMany({where:{chapterId:'ch'}});
 await client.opportunityLog.createMany({data:baselineReplay.automaticOpportunityLogs.map(l=>({...l,date:new Date(l.date)}))});
 const canonical=baselineReplay.automaticOpportunityLogs.find(l=>l.studentId==='s1'&&l.examId==='e8');
 const settledCurrent=baselineReplay.automaticOpportunityLogs.find(l=>l.studentId==='s5'&&l.examId==='e8');
 assert.ok(canonical);assert.ok(settledCurrent);
 for(const log of [canonical,settledCurrent])await client.opportunityLog.update({where:{id:log.id},data:{requestedAmount:1,appliedAmount:1,balanceBefore:3,balanceAfter:2,ledgerVersion:2,settledGradeIds:JSON.stringify([log.studentId+'_e8'])}});
 await client.opportunityLog.create({data:{id:'s5-reset',studentId:'s5',examId:null,action:'إعادة تعيين',amount:3,reason:'تسوية محفوظة',date:new Date('2026-09-07T12:00:00Z'),chapterId:'ch',chapterNameSnapshot:'الفصل الثاني',ledgerVersion:2,balanceBefore:2,balanceAfter:3,requestedAmount:3,appliedAmount:3,settledGradeIds:'["s5_e8"]'}});
 await client.student.update({where:{id:'s5'},data:{opportunities:2}});
 const settledPreview=await previewStudentsAcademicState(['s5'],{tx:client});
 assert.equal(settledPreview.students[0].opportunities,2,'settled student has no pre-existing balance drift');
 assert.ok(!settledPreview.automaticOpportunityLogs.some(l=>l.id===settledCurrent.id),'ordinary before-edit replay already omits the settled current-chapter evidence');
 // A live event with a legacy ID is replayed once under the canonical ID;
 // it must not be mistaken for settled history and preserved as a duplicate.
 const legacyEvent=baselineReplay.automaticOpportunityLogs.find(l=>l.studentId==='s6'&&l.examId==='e8');
 assert.ok(legacyEvent);
 await client.opportunityLog.update({where:{id:legacyEvent.id},data:{id:'legacy-s6-e8'}});
 const before=await snapshot(),original=await row('exam','e9');
 // Consume the real listing token exactly as the UI does. Both listing
 // variants include examCourses; PUT reads the scalar Exam for its guard.
 const listingResponse=await route.GET({url:'https://example.test/api/exams'});
 assert.equal(listingResponse.status,200);
 const listed=(await listingResponse.json()).exams.find(e=>e.id==='e9');
 assert.ok(listed&&listed.examCourses.length>0,'GET returns actual exam-course relations');
 const pagedResponse=await route.GET({url:'https://example.test/api/exams?page=1&pageSize=500'});
 assert.equal(pagedResponse.status,200);
 const paged=(await pagedResponse.json()).exams.find(e=>e.id==='e9');
 assert.ok(paged&&paged.examCourses.length>0);
 assert.equal(paged.mutationToken,listed.mutationToken,'paginated and full GET use the same edit token');
 const fullPayload={id:'e9',name:original.name,type:original.type,courseIds:['c'],mainSite:'بغداد',date:'2026-09-09',fullMark:20,passMark:10,discountMark:0,opportunitiesPenalty:0,dismissalGrade:null,noDiscount:true,active:true,scheduledActivateAt:null,
  expectedMutationToken:listed.mutationToken};
 const writesStart=statements.length;
 const changed=await put(fullPayload);
 assert.equal(changed.status,200,JSON.stringify(changed.data));
 assert.equal(changed.data.exam.noDiscount,true);
 const savedListing=(await (await route.GET({url:'https://example.test/api/exams?page=1&pageSize=500'})).json()).exams.find(e=>e.id==='e9');
 assert.equal(savedListing.mutationToken,changed.data.exam.mutationToken,'PUT response token matches relation-bearing GET after save');
 assert.equal(changed.data.exam.discountMark,0);assert.equal(changed.data.exam.opportunitiesPenalty,'0');assert.equal(changed.data.exam.dismissalGrade,null);
 assert.equal(new Date(changed.data.exam.date).toISOString(),original.date.toISOString(),'UI resubmission of unchanged Baghdad day must retain the existing timestamp');
 assert.deepEqual(markerCalls,[],'policy edit must not rebuild protected markers or repair unrelated grades');
 const after=await snapshot();
 for(const table of ['Grade','StudentLeave','StudentLeaveGradeBackup','ExamCourse'])assert.deepEqual(after[table],before[table],table+' unchanged by policy edit');
 assert.deepEqual(after.OpportunityLog.find(l=>l.id==='keep-history'),before.OpportunityLog.find(l=>l.id==='keep-history'),'historical automatic log keeps ID and ledger metadata');
 for(const id of ['keep-unassigned-history',canonical.id,settledCurrent.id])assert.deepEqual(after.OpportunityLog.find(l=>l.id===id),before.OpportunityLog.find(l=>l.id===id),'preserved history/current metadata '+id);
 for(const id of ['keep-history','keep-unassigned-history',canonical.id,settledCurrent.id]){
  const stored=before.OpportunityLog.find(l=>l.id===id),returned=changed.data.academicRecalculation.opportunityLogs.find(l=>l.id===id);
  assert.ok(returned,'preserved log included in response '+id);
  for(const field of ['requestedAmount','appliedAmount','balanceBefore','balanceAfter','ledgerVersion','settledGradeIds'])assert.deepEqual(returned[field],stored[field],'response retains persisted '+field+' for '+id);
 }
 assert.equal(after.OpportunityLog.filter(l=>l.examId==='e9'&&l.chapterId==='ch'&&l.action==='خصم تلقائي').length,0,'chosen exam stops deducting');
 assert.equal(after.OpportunityLog.filter(l=>l.examId==='e8'&&l.action==='خصم تلقائي').length,1000,'other active exam still deducts');
 assert.ok(!after.OpportunityLog.some(l=>l.id==='legacy-s6-e8'),'legacy ID for a still-live event is not preserved as duplicate history');
 assert.equal(after.OpportunityLog.filter(l=>l.studentId==='s6'&&l.examId==='e8'&&l.action==='خصم تلقائي').length,1,'legacy event is replaced exactly once');
 assert.ok(after.OpportunityLog.some(l=>l.id===legacyEvent.id),'live event uses the canonical replay ID');
 assert.ok(!changed.data.academicRecalculation.opportunityLogs.some(l=>l.id==='legacy-s6-e8'),'response also excludes duplicate legacy ID');
 assert.equal((await row('student','s1')).opportunities,2);
 assert.equal((await row('student','s5')).opportunities,3,'settled history stays historical while the later edited exam restores one chance');
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
 // Removing an earlier deduction may also remove a later automatic dismissal.
 // The historical safeguard must not preserve effects the old replay produced
 // and the changed replay legitimately removes.
 await pg.exec(`INSERT INTO "Student"(id,name,"nameKey",gender,code,"courseId","mainSite","createdAt","baseOpportunities",opportunities) VALUES('cascade','تسلسل','cascade','ذكر','CASCADE','isolated','بغداد','2026-06-01',3,3);
 INSERT INTO "Exam"(id,name,type,date,"courseIds","mainSite","fullMark","passMark","discountMark","opportunitiesPenalty") SELECT 'cascade-'||i,'اختبار تسلسل '||i,'يومي','2026-06-05'::timestamp+i*INTERVAL '1 day','["isolated"]','بغداد',20,10,7,'1' FROM generate_series(1,4)i;
 INSERT INTO "Grade"(id,"studentId","examId",status,"updatedAt") SELECT 'cascade-g'||i,'cascade','cascade-'||i,'غائب','2026-06-10' FROM generate_series(1,4)i;`);
 const cascadeBefore=await previewStudentsAcademicState(['cascade'],{tx:client});
 const oldDismissal=cascadeBefore.automaticOpportunityLogs.find(l=>l.action==='فصل تلقائي');
 assert.ok(oldDismissal);assert.equal(oldDismissal.examId,'cascade-4');
 const dismissed=cascadeBefore.students[0];
 await client.student.update({where:{id:'cascade'},data:{status:dismissed.status,opportunities:dismissed.opportunities,dismissalReason:dismissed.dismissalReason}});
 await client.opportunityLog.createMany({data:cascadeBefore.automaticOpportunityLogs.map(l=>({...l,date:new Date(l.date)}))});
 const cascadeChanged=await put({id:'cascade-1',noDiscount:true});assert.equal(cascadeChanged.status,200,JSON.stringify(cascadeChanged.data));
 assert.equal(await row('opportunityLog',oldDismissal.id),null,'later dismissal caused by removed earlier penalty is removed');
 assert.ok(!cascadeChanged.data.academicRecalculation.opportunityLogs.some(l=>l.id===oldDismissal.id),'response removes obsolete later dismissal too');
 assert.equal((await row('student','cascade')).status,'نشط','removing an earlier penalty restores a student when its proved later automatic dismissal disappears');
 assert.equal((await row('student','cascade')).opportunities,0);
 assert.equal((await row('student','cascade')).dismissalReason,null);
 // A final exam can consume the remaining balance and dismiss immediately.
 // Removing its policy must recover that actual balance (including zero),
 // while a later independent cause or manual decision still prevents recovery.
 await pg.exec(`INSERT INTO "Student"(id,name,"nameKey",gender,code,"courseId","mainSite","createdAt","baseOpportunities",opportunities)
 SELECT id,id,id,'ذكر',id,'isolated','بغداد','2026-06-01',3,3 FROM unnest(ARRAY['direct-zero','direct-one','manual-override','later-cause'])id;
 INSERT INTO "Exam"(id,name,type,date,"courseIds","mainSite","fullMark","passMark","discountMark","opportunitiesPenalty")
 SELECT 'direct-'||i,'خصم سابق '||i,'يومي','2026-06-03'::timestamp+i*INTERVAL '1 day','["isolated"]','بغداد',20,10,7,'1' FROM generate_series(1,3)i;
 INSERT INTO "Exam"(id,name,type,date,"courseIds","mainSite","fullMark","passMark","discountMark","opportunitiesPenalty","dismissalGrade")
 VALUES('direct-final','فاينل يستعاد أثره','فاينل','2026-06-08','["isolated"]','بغداد',20,10,0,'0',4),('later-final','فاينل آخر مستقل','فاينل','2026-06-09','["isolated"]','بغداد',20,10,0,'0',4);
 INSERT INTO "Grade"(id,"studentId","examId",status,"updatedAt")
 SELECT s||'-g'||i,s,'direct-'||i,'غائب','2026-06-10' FROM unnest(ARRAY['direct-zero','direct-one','manual-override','later-cause'])s CROSS JOIN generate_series(1,2)i;
 INSERT INTO "Grade"(id,"studentId","examId",status,"updatedAt")
 SELECT s||'-final',s,'direct-final','غائب','2026-06-10' FROM unnest(ARRAY['direct-zero','direct-one','manual-override','later-cause'])s;
 INSERT INTO "Grade"(id,"studentId","examId",status,"updatedAt") VALUES('direct-zero-g3','direct-zero','direct-3','غائب','2026-06-10'),('later-cause-final2','later-cause','later-final','غائب','2026-06-10');`);
 const directIds=['direct-zero','direct-one','manual-override','later-cause'];
 const directReplay=await previewStudentsAcademicState(directIds,{tx:client});
 for(const student of directReplay.students){
  assert.equal(student.status,'مفصول');
  await client.student.update({where:{id:student.id},data:{status:student.status,opportunities:student.opportunities,dismissalReason:student.dismissalReason}});
 }
 await client.opportunityLog.createMany({data:directReplay.automaticOpportunityLogs.map(l=>({...l,date:new Date(l.date)}))});
 // Same saved reason and valid automatic evidence are insufficient when an
 // explicit, later manual decision superseded that original automatic cause.
 await client.studentNote.create({data:{id:'manual-override-note',studentId:'manual-override',kind:'إجراء',text:'فصل الطالب يدوياً بقرار الإدارة',date:new Date('2026-06-11')}});
 const directBefore=await snapshot(),manualBefore=await row('student','manual-override'),laterBefore=await row('student','later-cause');
 failWrite='opportunityLog';
 const recoveryFailed=await put({id:'direct-final',noDiscount:true});
 failWrite=null;
 assert.equal(recoveryFailed.status,500);
 assert.deepEqual(await snapshot(),directBefore,'a failure after recovery persistence rolls back exam, reactivation, balances and logs together');
 const directChanged=await put({id:'direct-final',noDiscount:true});
 assert.equal(directChanged.status,200,JSON.stringify(directChanged.data));
 for(const [id,balance]of [['direct-zero',0],['direct-one',1]]){
  const student=await row('student',id);
  assert.equal(student.status,'نشط',id+' recovers from the edited exam’s proved automatic cause');
  assert.equal(student.opportunities,balance,id+' receives its actual recomputed balance, without a pledge or arbitrary grant');
  assert.equal(student.dismissalReason,null);
  const returned=directChanged.data.academicRecalculation.students.find(s=>s.id===id);
  assert.equal(returned.status,'نشط');assert.equal(returned.opportunities,balance,'response matches persisted recovery');
 }
 assert.deepEqual(await row('student','manual-override'),manualBefore,'a later manual decision is retained even with a matching automatic reason');
 assert.deepEqual(await row('student','later-cause'),laterBefore,'a later independent exam still dismisses the student');
 const directAfter=await snapshot();
 for(const table of ['Grade','StudentLeave','StudentLeaveGradeBackup'])assert.deepEqual(directAfter[table],directBefore[table],table+' unchanged by automatic exam recovery');
 for(const note of directBefore.StudentNote)assert.deepEqual(directAfter.StudentNote.find(n=>n.id===note.id),note,'existing action notes stay intact');
 const recoveryNotes=directAfter.StudentNote.filter(n=>!directBefore.StudentNote.some(old=>old.id===n.id));
 assert.deepEqual(recoveryNotes.map(n=>n.studentId).sort(),['direct-one','direct-zero'],'exactly the restored students receive a new explanation');
 for(const note of recoveryNotes){assert.equal(note.kind,'إجراء');assert.ok(note.text.includes('استعادة الطالب بعد تعديل الامتحان'));assert.ok(note.text.includes('فاينل يستعاد أثره'));}
 assert.equal(directAfter.OpportunityLog.filter(l=>directIds.includes(l.studentId)&&l.examId==='direct-final'&&l.action==='فصل تلقائي').length,0);
 assert.ok(directAfter.OpportunityLog.some(l=>l.studentId==='later-cause'&&l.examId==='later-final'&&l.action==='فصل تلقائي'),'valid unrelated dismissal remains recorded');
 assert.ok(!directAfter.OpportunityLog.some(l=>['direct-zero','direct-one'].includes(l.studentId)&&!['خصم تلقائي','فصل تلقائي'].includes(l.action)),'recovery adds no pledge, reset or manual opportunity grant');
 const recoveredBefore=await snapshot();
 assert.equal((await put({id:'direct-final',noDiscount:true})).status,200);
 assert.deepEqual(await snapshot(),recoveredBefore,'repeated no-discount save does not grant again');
 // Renaming must follow current, proved automatic references, but must not
 // rewrite a manual decision that happens to use the old exam name/reason.
 await pg.exec(`INSERT INTO "Student"(id,name,"nameKey",gender,code,"courseId","mainSite","createdAt","baseOpportunities",opportunities)
 SELECT id,id,id,'ذكر',id,'isolated','بغداد','2026-06-01',3,3 FROM unnest(ARRAY['rename-auto','rename-manual','rename-manual-log'])id;
 INSERT INTO "Exam"(id,name,type,date,"courseIds","mainSite","fullMark","passMark","discountMark","opportunitiesPenalty","dismissalGrade") VALUES('rename-final','اسم الفاينل القديم','فاينل','2026-06-08','["isolated"]','بغداد',20,10,0,'0',4);
 INSERT INTO "Grade"(id,"studentId","examId",status,"updatedAt") SELECT id||'-g',id,'rename-final','غائب','2026-06-10' FROM unnest(ARRAY['rename-auto','rename-manual','rename-manual-log'])id;`);
 const renameReplay=await previewStudentsAcademicState(['rename-auto','rename-manual','rename-manual-log'],{tx:client});
 for(const student of renameReplay.students)await client.student.update({where:{id:student.id},data:{status:student.status,opportunities:student.opportunities,dismissalReason:student.dismissalReason}});
 await client.opportunityLog.createMany({data:renameReplay.automaticOpportunityLogs.map(l=>({...l,date:new Date(l.date)}))});
 // The previous UTC date is nevertheless the same Baghdad calendar day as
 // the cause: conservative manual precedence must not depend on the time.
 await client.studentNote.create({data:{id:'rename-manual-note',studentId:'rename-manual',kind:'إجراء',text:'فصل الطالب يدوياً: اسم الفاينل القديم',date:new Date('2026-06-07T22:00:00Z')}});
 await client.opportunityLog.create({data:{id:'rename-manual-decision',studentId:'rename-manual-log',action:'فصل',amount:0,reason:'فصل الطالب يدوياً: اسم الفاينل القديم',date:new Date('2026-06-07T22:00:00Z'),chapterId:'ch'}});
 const renameBefore=await snapshot(),oldAutomatic=await row('student','rename-auto'),oldManual=await row('student','rename-manual'),oldManualLog=await row('student','rename-manual-log');
 assert.equal(oldAutomatic.dismissalReason,oldManual.dismissalReason,'manual reason deliberately matches automatic evidence exactly');
 const renamed=await put({id:'rename-final',name:'اسم الفاينل الجديد'});
 assert.equal(renamed.status,200,JSON.stringify(renamed.data));
 assert.equal(renamed.data.academicRecalculation,null,'rename does not recalculate balances');
 assert.deepEqual(await row('student','rename-auto'),{...oldAutomatic,dismissalReason:oldAutomatic.dismissalReason.replaceAll('اسم الفاينل القديم','اسم الفاينل الجديد')},'only the proved automatic current reason follows the rename');
 assert.deepEqual(await row('student','rename-manual'),oldManual,'manual dismissal with identical wording is not rewritten');
 assert.deepEqual(await row('student','rename-manual-log'),oldManualLog,'a manual log on the same Baghdad day also protects its identically worded dismissal');
 const renameAfter=await snapshot();
 for(const table of ['Grade','StudentLeave','StudentLeaveGradeBackup','StudentNote'])assert.deepEqual(renameAfter[table],renameBefore[table],table+' unchanged by rename');
 for(const student of renameAfter.Student)if(!['rename-auto'].includes(student.id))assert.deepEqual(student,renameBefore.Student.find(s=>s.id===student.id),'unrelated student is unchanged by rename '+student.id);
 assert.ok(renameAfter.OpportunityLog.filter(l=>l.examId==='rename-final').every(l=>!l.reason.includes('اسم الفاينل القديم')&&l.reason.includes('اسم الفاينل الجديد')),'exam-linked automatic reasons show the new name');
 // A genuine scope change also retains settled evidence from other exams
 // in the SAME chapter. Its before snapshot must precede marker replacement.
 await pg.exec(`INSERT INTO "Course"(id,name) VALUES('history-course','دورة اختبار التسويات');
 INSERT INTO "CourseChapter"(id,"courseId","chapterId",active) VALUES('history-cc','history-course','ch',true);
 INSERT INTO "Student"(id,name,"nameKey",gender,code,"courseId","mainSite","createdAt","baseOpportunities",opportunities,"accountingGraceDays") VALUES('history-student','تاريخ محفوظ','history-student','ذكر','HISTORY','history-course','بغداد','2026-06-01',3,0,0);
 INSERT INTO "Exam"(id,name,type,date,"courseIds","mainSite","fullMark","passMark","discountMark","opportunitiesPenalty") VALUES
 ('history-settled','امتحان تمت تسويته','يومي','2026-06-05','["history-course"]','بغداد',20,10,7,'1'),
 ('history-moving','امتحان ننقل تاريخه','يومي','2026-06-08','["history-course"]','بغداد',20,10,7,'1'),
 ('history-other','امتحان آخر حي','يومي','2026-06-09','["history-course"]','بغداد',20,10,7,'1');
 INSERT INTO "Grade"(id,"studentId","examId",status,"updatedAt") SELECT id||'-g','history-student',id,'غائب','2026-06-10' FROM unnest(ARRAY['history-settled','history-moving','history-other'])id;`);
 const historyReplay=await previewStudentsAcademicState(['history-student'],{tx:client});
 assert.equal(historyReplay.students[0].opportunities,0);
 await client.opportunityLog.createMany({data:historyReplay.automaticOpportunityLogs.map(l=>({...l,date:new Date(l.date)}))});
 const historySettled=historyReplay.automaticOpportunityLogs.find(l=>l.examId==='history-settled');
 assert.ok(historySettled);
 await client.opportunityLog.update({where:{id:historySettled.id},data:{requestedAmount:1,appliedAmount:1,balanceBefore:3,balanceAfter:2,ledgerVersion:2,settledGradeIds:'["history-settled-g"]'}});
 await client.opportunityLog.create({data:{id:'history-reset',studentId:'history-student',action:'إعادة تعيين',amount:3,reason:'تسوية محفوظة',date:new Date('2026-06-07T12:00:00Z'),chapterId:'ch',chapterNameSnapshot:'الفصل الثاني',ledgerVersion:2,balanceBefore:2,balanceAfter:3,requestedAmount:3,appliedAmount:3,settledGradeIds:'["history-settled-g"]'}});
 await client.student.update({where:{id:'history-student'},data:{opportunities:1}});
 const scopeHistoryPreview=await previewStudentsAcademicState(['history-student'],{tx:client});
 assert.equal(scopeHistoryPreview.students[0].opportunities,1,'scope fixture has no pre-existing balance drift');
 assert.ok(!scopeHistoryPreview.automaticOpportunityLogs.some(l=>l.id===historySettled.id),'settled evidence was already absent from the old replay');
 // Period-leave dependents are currently part of exam recalculation even if
 // their own course is different. Their settled evidence needs the same guard.
 await client.studentLeave.create({data:{id:'cross-course-period',studentId:'s5',leaveType:'period',reason:'إجازة فترة بدورة أخرى',date:new Date('2026-06-08'),dateFrom:new Date('2026-06-08'),dateTo:new Date('2026-06-08')}});
 const scopeHistoryBefore=await snapshot();
 assert.ok(scopeHistoryBefore.OpportunityLog.some(l=>l.id===settledCurrent.id),'cross-course dependent starts with its settled evidence intact');
 const historyMoved=await put({id:'history-moving',date:'2026-05-30'});
 assert.equal(historyMoved.status,200,JSON.stringify(historyMoved.data));
 assert.equal((await row('student','history-student')).opportunities,2,'moving before registration removes only this exam’s actual penalty');
 const scopeHistoryAfter=await snapshot();
 assert.deepEqual(scopeHistoryAfter.Student.find(s=>s.id==='s5'),scopeHistoryBefore.Student.find(s=>s.id==='s5'),'cross-course period-leave student balance is unchanged');
 assert.deepEqual(scopeHistoryAfter.OpportunityLog.find(l=>l.id===settledCurrent.id),scopeHistoryBefore.OpportunityLog.find(l=>l.id===settledCurrent.id),'cross-course period-leave dependent retains settled history');
 for(const stored of scopeHistoryBefore.OpportunityLog.filter(l=>l.studentId==='history-student'&&l.examId!=='history-moving')){
  assert.deepEqual(scopeHistoryAfter.OpportunityLog.find(l=>l.id===stored.id),stored,'scope edit preserves other live/settled history '+stored.id);
  const returned=historyMoved.data.academicRecalculation.opportunityLogs.find(l=>l.id===stored.id);
  assert.ok(returned,'scope edit response includes settled history '+stored.id);
  for(const field of ['requestedAmount','appliedAmount','balanceBefore','balanceAfter','ledgerVersion','settledGradeIds'])assert.deepEqual(returned[field],stored[field],'scope response preserves ledger field '+field);
 }
 assert.ok(!scopeHistoryAfter.OpportunityLog.some(l=>l.studentId==='history-student'&&l.examId==='history-moving'&&l.action==='خصم تلقائي'),'removed exam effect is not misclassified as preserved history');
 assert.equal((await client.grade.findFirst({where:{studentId:'history-student',examId:'history-moving'}})).status,'قبل تسجيل الطالب','new grade scope is reconciled');
 const deniedBefore=await snapshot();deny=true;assert.equal((await put({id:'e9',noDiscount:false})).status,403);deny=false;assert.deepEqual(await snapshot(),deniedBefore);
 assert.ok(audits.some(a=>a[3]?.examId==='e9'&&a[3]?.recalculatedStudents>=1000));
 await pg.close();
 console.log('PASS: actual exams PUT + migrations, 1,000-student no-discount update, unchanged Baghdad day and grade/leave/backups/history and settled current-chapter evidence preserved, obsolete automatic dismissal recovered at actual 0/1 balance, manual/later causes retained, proof-gated reason rename, bounded student SQL writes, idempotence, stale edit, authorization, recovery rollback and real date-scope reconciliation');
})().catch(e=>{console.error(e);process.exitCode=1});
