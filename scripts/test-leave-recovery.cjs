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
   }else if(key==='studentId_examId') {if(!await matches(model,row,test))return false;}
   else if(key==='student'||key==='exam'){
    const related=(await all(key)).find(r=>r.id===row[key+'Id']);
    if(!related||!await matches(key,related,test.is||test))return false;
   }else if(!scalar(row[key],test))return false;
  }
  return true;
 };
 const project=async(model,row,args)=>{
  if(!row)return null;const out=args.select?{}:{...row};
  for(const [key,spec]of Object.entries(args.select||args.include||{})){
   if(!spec)continue;
   if(typeof spec==='object'||(args.include&&['student','exam'].includes(key))){
    const relation=key==='examCourses'?'examCourse':key;
    const related=(await all(relation)).filter(r=>key==='examCourses'?r.examId===row.id:r.id===row[key+'Id']);
    out[key]=key==='examCourses'?await Promise.all(related.map(r=>project(relation,r,spec))):await project(relation,related[0],spec===true?{}:spec);
   }else out[key]=row[key];
  }
  return out;
 };
 const find=async(model,args={})=>{
  let rows=[];for(const r of await all(model))if(await matches(model,r,args.where))rows.push(r);
  const order=args.orderBy?Array.isArray(args.orderBy)?args.orderBy:[args.orderBy]:[];
  rows.sort((a,b)=>{for(const obj of order)for(const [k,dir]of Object.entries(obj)){if(a[k]!==b[k]){const c=a[k]<b[k]?-1:a[k]>b[k]?1:0;if(c)return dir==='desc'?-c:c;}}return 0;});
  rows=rows.slice(args.skip||0,args.take==null?undefined:(args.skip||0)+args.take);
  return Promise.all(rows.map(r=>project(model,r,args)));
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
  };
 }
 const raw=(parts,values)=>parts.text?{text:parts.text,values:parts.values}:{text:parts.map((p,i)=>p+(i<values.length?'$'+(i+1):'')).join(''),values};
 client.$queryRaw=async(parts,...values)=>{const q=raw(parts,values);return (await query(q.text,q.values)).rows;};
 client.$executeRaw=async(parts,...values)=>{const q=raw(parts,values);return (await query(q.text,q.values)).affectedRows;};
 mocks.set('@/lib/db',{db:client});
 mocks.set('@/lib/server-auth',{requirePermission:async()=>deny?new Response('{}',{status:403}):null});
 mocks.set('@/lib/schema-readiness',{withDatabaseSchema:async fn=>fn()});
 mocks.set('@/lib/audit-log-server',{writeRequestAuditLog:async(...args)=>audits.push(args)});
 mocks.set('@/lib/serializable-transaction',{withSerializableTransaction:async fn=>{await pg.exec('BEGIN');try{const result=await fn(client);await pg.exec('COMMIT');return result;}catch(e){await pg.exec('ROLLBACK');throw e;}}});
 const route=require('../src/app/api/student-leaves/route.ts');
 const {recalculateStudentsAcademicState}=require('../src/lib/academic-recalculate-server.ts');
 await pg.exec(`INSERT INTO "Course"(id,name) VALUES('c','الصيفية'),('other','أخرى');
 INSERT INTO "Chapter"(id,name,opportunities) VALUES('ch','الحالي',3),('old-ch','السابق',3);
 INSERT INTO "CourseChapter"(id,"courseId","chapterId",active) VALUES('cc','c','ch',true),('oc','other','ch',true);
 INSERT INTO "Student"(id,name,"nameKey",gender,code,"courseId","createdAt","baseOpportunities",opportunities,"accountingGraceDays")
 SELECT s,s,s,'ذكر',s,'c','2026-01-01',3,3,0 FROM unnest(ARRAY['rescue','manual','final','period','zero','rollback','archive','untouched']) s;
 INSERT INTO "Exam"(id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
 SELECT 'e'||i,'امتحان '||i,'يومي','2026-02-01'::timestamp+i*INTERVAL '1 day','["c"]',20,10,7,'1' FROM generate_series(1,4)i;
 INSERT INTO "Exam"(id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
 VALUES('historic','سابق','يومي','2026-01-15','["c"]',20,10,7,'1'),('final-exam','نهائي','فاينل','2026-02-10','["c"]',20,10,7,'1'),('foreign','دورة أخرى','يومي','2026-02-10','["other"]',20,10,7,'1');
 UPDATE "ExamCourse" SET "chapterId"='old-ch' WHERE "examId"='historic';
 INSERT INTO "Grade"(id,"studentId","examId",status,notes,"updatedAt")
 SELECT s||'_e'||i,s,'e'||i,'غائب','الأصل محفوظ',CURRENT_TIMESTAMP FROM unnest(ARRAY['rescue','manual','final','period','rollback','untouched'])s CROSS JOIN generate_series(1,4)i;
 INSERT INTO "Grade"(id,"studentId","examId",status,"updatedAt") VALUES('g-final','final','final-exam','غائب',CURRENT_TIMESTAMP);
 INSERT INTO "Grade"(id,"studentId","examId",status,score,notes,"academicEffectExcluded","academicEffectExclusionSource","updatedAt") VALUES('zero-id','zero','e1','درجة',0,'zero original',true,'original exclusion',CURRENT_TIMESTAMP);
 UPDATE "Student" SET status='مؤرشف' WHERE id='archive';`);
 for(const id of ['rescue','manual','final','period','rollback','untouched'])await recalculateStudentsAcademicState([id],{tx:client});
 await pg.exec(`UPDATE "Student" SET "dismissalReason"='قرار إداري' WHERE id='manual';
 INSERT INTO "OpportunityLog"(id,"studentId","examId",action,amount,reason,date,"chapterId","balanceAfter") VALUES('keep-history','rescue','historic','خصم تلقائي',1,'تلقائي: سابق','2026-01-15','old-ch',2);`);
 const savedStudent=async id=>(await client.student.findUnique({where:{id}}));
 const post=async(body,method='POST')=>{
  const response=await route[method]({url:'https://example.test/api/student-leaves',json:async()=>body});
  const payload=await response.json();return {status:response.status,data:payload};
 };
 const leave=(studentId,examId='e1')=>({studentId,examId,leaveType:'exam',reason:'حالة مرضية',date:'2026-02-02'});
 const del=async id=>{const r=await route.DELETE({url:'https://example.test/api/student-leaves?id='+id});return {status:r.status,data:await r.json()};};
 const originalHistory=await client.opportunityLog.findUnique({where:{id:'keep-history'}});
 const unchanged=await savedStudent('untouched');
 const rescue=await post(leave('rescue'));assert.equal(rescue.status,201,JSON.stringify(rescue.data));
 assert.equal(rescue.data.studentLeave.student.status,'نشط');assert.equal(rescue.data.studentLeave.student.opportunities,0);
 assert.equal((await savedStudent('rescue')).status,'نشط');
 assert.equal((await client.grade.findUnique({where:{id:'rescue_e1'}})).status,'مجاز');
 assert.deepEqual(await client.opportunityLog.findUnique({where:{id:'keep-history'}}),originalHistory);
 assert.ok(!(await client.opportunityLog.findMany({where:{studentId:'rescue'}})).some(l=>l.action==='رصيد إعادة التفعيل'));
 const repeated=await post(leave('rescue'));assert.ok([201,400,409].includes(repeated.status));
 assert.equal(await client.studentLeave.count({where:{studentId:'rescue'}}),1);assert.equal((await savedStudent('rescue')).opportunities,0);
 const currentLeave=await client.studentLeave.findFirst({where:{studentId:'rescue'}});
 assert.equal((await del(currentLeave.id)).status,200);
 assert.equal((await savedStudent('rescue')).status,'مفصول');
 assert.equal((await client.grade.findUnique({where:{id:'rescue_e1'}})).status,'غائب','grade identity survives cancellation');
 assert.deepEqual(await client.opportunityLog.findUnique({where:{id:'keep-history'}}),originalHistory);
 assert.equal((await post(leave('manual'))).status,201);assert.equal((await savedStudent('manual')).dismissalReason,'قرار إداري');
 assert.equal((await post(leave('final'))).status,201);assert.equal((await savedStudent('final')).status,'مفصول','another dismissal still applies');
 const period=await post({studentId:'period',leaveType:'period',reason:'سفر',dateFrom:'2026-02-02',dateTo:'2026-02-03'});
 assert.equal(period.status,201);assert.equal(period.data.backedUpGrades,2);assert.equal((await savedStudent('period')).opportunities,1);assert.equal((await savedStudent('period')).status,'نشط');
 const edit=await post({id:period.data.studentLeave.id,notes:'ملاحظة جديدة'},'PUT');assert.equal(edit.status,200);assert.equal(edit.data.academicRecalculation,null);
 const overlap=await post({studentId:'period',leaveType:'period',reason:'overlap',dateFrom:'2026-02-03',dateTo:'2026-02-04'});assert.equal(overlap.status,400);
 const zeroBefore=await client.grade.findUnique({where:{id:'zero-id'}});const zero=await post(leave('zero'));assert.equal(zero.status,201);
 assert.equal((await del(zero.data.studentLeave.id)).status,200);const zeroAfter=await client.grade.findUnique({where:{id:'zero-id'}});
 for(const key of ['id','score','notes','academicEffectExcluded','academicEffectExclusionSource','createdAt'])assert.deepEqual(zeroAfter[key],zeroBefore[key]);
 // Exam and period leaves may cover the same grade. Either cancellation
 // order must keep it excused until the final leave is cancelled.
 for(const periodFirst of [false,true])for(const cancelFirstCreated of [false,true]){
  const examPayload=leave('zero');
  const periodPayload={studentId:'zero',leaveType:'period',reason:'سفر',dateFrom:'2026-02-02',dateTo:'2026-02-03'};
  const first=await post(periodFirst?periodPayload:examPayload);
  const second=await post(periodFirst?examPayload:periodPayload);
  assert.equal(first.status,201);assert.equal(second.status,201);
  const ids=[first.data.studentLeave.id,second.data.studentLeave.id];if(!cancelFirstCreated)ids.reverse();
  assert.equal((await del(ids[0])).status,200);
  assert.equal((await client.grade.findUnique({where:{id:'zero-id'}})).status,'مجاز');
  assert.equal((await del(ids[1])).status,200);
  const original=await client.grade.findUnique({where:{id:'zero-id'}});
  for(const key of ['id','score','notes','academicEffectExcluded','academicEffectExclusionSource','createdAt'])assert.deepEqual(original[key],zeroBefore[key]);
  assert.equal(await client.grade.count({where:{studentId:'zero',examId:'e2'}}),0,'leave-only marker removed after final cancellation');
 }
 assert.equal((await post(leave('archive'))).status,400);
 assert.equal((await post(leave('rollback','foreign'))).status,400);
 const rollbackSnapshot=JSON.stringify([await savedStudent('rollback'),await client.grade.findMany({where:{studentId:'rollback'}})]);
 failWrite='opportunityLog';assert.equal((await post(leave('rollback'))).status,500);failWrite=null;
 assert.equal(await client.studentLeave.count({where:{studentId:'rollback'}}),0);
 assert.equal(JSON.stringify([await savedStudent('rollback'),await client.grade.findMany({where:{studentId:'rollback'}})]),rollbackSnapshot,'failure rolls back grades/status/leave together');
 deny=true;assert.equal((await post(leave('rollback'))).status,403);deny=false;
 const page=await (await route.GET({url:'https://example.test/api/student-leaves?pageSize=1&stats=1'})).json();
 assert.equal(page.studentLeaves.length,1);assert.equal(page.totalCount,3);assert.equal(page.stats.total,3);assert.equal(page.stats.period,1);
 const search=await (await route.GET({url:'https://example.test/api/student-leaves?studentId=manual&pageSize=500'})).json();assert.equal(search.totalCount,1);assert.equal(search.studentLeaves[0].studentId,'manual');
 const filtered=await (await route.GET({url:'https://example.test/api/student-leaves?leaveType=period&q=سفر&date=2026-02-03'})).json();assert.equal(filtered.totalCount,1);
 assert.deepEqual(await savedStudent('untouched'),unchanged);
 assert.ok(audits.some(a=>a[3].studentResults?.some(s=>s.studentId==='rescue'&&s.status==='نشط')));
 await pg.close();
 console.log('PASS: real leave API + real academic service, historical dismissal rescue, valid/manual dismissals preserved, zero/grace metadata and grade identities retained, period overlap, scoped pagination/search/stats, authorization and atomic rollback');
})().catch(e=>{console.error(e);process.exitCode=1});
