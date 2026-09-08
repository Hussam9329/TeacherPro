const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = process.cwd();
const resolve = Module._resolveFilename;
Module._resolveFilename = function(r,p,...args) { return resolve.call(this,r.startsWith('@/') ? path.join(root,'src',r.slice(2)) : r,p,...args); };
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const mocks = new Map();
const load = Module._load;
Module._load = function(r,p,...args) { return mocks.has(r) ? mocks.get(r) : load.call(this,r,p,...args); };
const source = p => require(path.join(root,'src',p));
const pass = label => console.log('PASS:',label);
function state() {return {students:[{id:'s',courseId:'c',status:'نشط',dismissalReason:'',opportunities:3,baseOpportunities:3,createdAt:'2026-01-01',accountingGraceDays:0}],exams:[],grades:[],courseChapters:[{id:'cc',courseId:'c',chapterId:'ch',active:true,archived:false}],chapters:[{id:'ch',name:'فصل',opportunities:3}],opportunityLogs:[],studentLeaves:[],studentNotes:[]};}
function exam(id,date) {return {id,name:id,type:'يومي',date,fullMark:100,passMark:50,discountMark:20,opportunitiesPenalty:1,dismissalGrade:10,noDiscount:false,active:true,courseIds:['c']};}
function grade(id,date) {return {id:'g'+id,studentId:'s',examId:id,status:'درجة',score:10,createdAt:date,updatedAt:date};}
function command(action,amount,date,extra={}) {return {id:'l'+date,studentId:'s',examId:'',action,amount,appliedAmount:amount,date,reason:'manual',chapterId:'ch',ledgerVersion:2,...extra};}
(async () => {
 const engine = source('lib/academic-engine.ts');
 const balance = s => engine.recalculateAcademicState(s,new Set(['s'])).students[0].opportunities;
 let s=state();s.exams=[exam('e','2026-02-03')];s.grades=[grade('e','2026-02-03')];s.opportunityLogs=[command('إضافة',0,'2026-02-02',{requestedAmount:1})];assert.equal(balance(s),2);
 s=state();s.exams=[exam('e','2026-02-01'),exam('later','2026-02-04')];s.grades=[grade('e','2026-02-01'),grade('later','2026-02-04')];s.opportunityLogs=[command('إضافة',1,'2026-02-02')];assert.equal(balance(s),2);
 s.opportunityLogs=[command('إعادة تعيين',3,'2026-02-02',{balanceAfter:3,settledGradeIds:'["ge"]'})];assert.equal(balance(s),2);
 s.grades=s.grades.slice(0,1);assert.equal(balance(s),3);
 s=state();s.opportunityLogs=[command('إعادة تعيين',0,'2026-02-02',{balanceAfter:0,settledGradeIds:'[]'})];assert.equal(balance(s),0);
 s.opportunityLogs[0].ledgerVersion=null;assert.equal(balance(s),0);
 s=state();s.exams=[exam('e','2026-02-02'),exam('later','2026-02-03')];s.grades=[grade('e','2026-02-02'),grade('later','2026-02-03')];
 s.opportunityLogs=[command('رصيد إعادة التفعيل',2,'2026-02-02T12:00:00Z',{reason:'تم تعهد الطالب: إرجاعه إلى الحالة النشطة برصيد فرصتين بسبب التعهد',settledGradeIds:'["ge"]'})];
 assert.equal(balance(s),1);
 s.grades=[];assert.equal(balance(s),2); // Grant never disappears when old source grades are absent.
 s=state();s.opportunityLogs=[command('إعادة تعيين',1,'2026-02-02',{balanceAfter:1,settledGradeIds:'[]'}),{...command('إعادة تعيين',3,'2026-03-01'),ledgerVersion:null,reason:'تسوية تاريخية: بداية فصل جديد'}];assert.equal(balance(s),3);
 s=state();s.opportunityLogs=[command('إعادة تعيين',1,'2026-02-02',{balanceAfter:1,chapterId:'old-chapter',settledGradeIds:'[]'})];assert.equal(balance(s),3);
 pass('capped additions, chronology, reset settlement, reactivation, zero and chapter transitions');

 mocks.set('@/lib/db',{db:{loginRateBucket:{deleteMany:async()=>({count:0})},appUser:{findUnique:async ({where})=>({id:where.id,username:'employee',name:'employee',permissions:'[]',active:true,role:'staff',roleId:null,roleRef:null,sessionVersion:0})}}});
 const serverEngine=source('lib/academic-recalculate-server.ts');
 const fixture=state();fixture.exams=[exam('e','2026-02-01')];fixture.grades=[grade('e','2026-02-01')];
 fixture.opportunityLogs=[command('إعادة تعيين',3,'2026-02-02',{balanceAfter:3,settledGradeIds:'["ge"]'})];
 const fakeTx={};
 for(const [model,key] of Object.entries({student:'students',grade:'grades',exam:'exams',chapter:'chapters',courseChapter:'courseChapters',opportunityLog:'opportunityLogs',studentLeave:'studentLeaves',studentNote:'studentNotes'})) {
   fakeTx[model]={findMany:async({select})=>fixture[key].map(row=>Object.fromEntries(Object.keys(select).map(k=>[k,k==='courseIds'?JSON.stringify(row[k]):row[k]])))};
 }
 assert.equal((await serverEngine.previewStudentsAcademicState(['s'],{tx:fakeTx})).students[0].opportunities,3);
 pass('server loader preserves the structured ledger and settlement fields');
 const auth=source('lib/server-auth.ts');
 const principal={id:'u',isAdmin:false,permissions:['follow-up.calls.manage']};
 assert.equal(auth.hasPermission(principal,'follow-up.leaves.manage'),false);assert.equal(auth.hasPermission(principal,'follow-up.calls.manage'),true);
 principal.permissions=['follow-up.manage'];assert.equal(auth.hasPermission(principal,'follow-up.leaves.manage'),true);
 principal.permissions=['accounts.users.add'];assert.equal(auth.hasPermission(principal,'accounts.manage'),false);assert.equal(auth.hasPermission(principal,'backup.view'),false);
 const token=await auth.createSessionToken('u');
 assert.equal(await auth.getAuthPrincipal({cookies:{get:()=>({value:token})},headers:new Headers({'x-teacherpro-owner-id':'other'})}),null);
 assert.equal((await auth.getAuthPrincipal({cookies:{get:()=>({value:token})},headers:new Headers({'x-teacherpro-owner-id':'u'})})).id,'u');
 pass('partial permissions and signed session owner binding');

 const storage=new Map();const events=new Map();
 global.window={localStorage:{get length(){return storage.size},key:i=>[...storage.keys()][i]??null,getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent:()=>{},setTimeout:()=>1,clearTimeout:()=>{}};
 global.document={visibilityState:'visible',addEventListener:()=>{}};
 Object.defineProperty(global,'navigator',{value:{onLine:true,locks:{request:async (_n,_o,fn)=>fn({})}},configurable:true});
 const sync={announceTeacherProSyncError:()=>{},announceTeacherProSyncPending:()=>{},announceTeacherProSyncSettled:()=>{},emitTeacherProDataChanged:()=>{},inferTeacherProScopesFromEndpoint:()=>[]};mocks.set('./teacherpro-sync',sync);
 const session=source('lib/outbox-session.ts');session.setOutboxOwner('a');
 const outbox=source('lib/mutation-outbox.ts');let resolveFetch;
 global.fetch=()=>new Promise(resolve=>{resolveFetch=resolve});
 outbox.queueOnly({endpoint:'/api/student-calls',method:'POST',payload:{id:'A'}});
 const pending=outbox.flushOutbox();outbox.queueOnly({endpoint:'/api/student-calls',method:'POST',payload:{id:'B'}});
 resolveFetch(new Response('{}',{status:200}));await pending;assert.equal(outbox.getPendingMutationCount(),1);
 session.setOutboxOwner('b');assert.equal(outbox.getPendingMutationCount(),0);assert.equal(await outbox.flushOutbox(),0);
 session.setOutboxOwner('a');assert.equal(outbox.getPendingMutationCount(),1);
 global.fetch=async()=>new Response('{}',{status:401});await outbox.flushOutbox();assert.equal(outbox.getPendingMutationCount(),1);
 session.setOutboxOwner(null);assert.equal(await outbox.flushOutbox(),0);session.setOutboxOwner('a');
 mocks.set('./api',{gradeApi:{}});const grades=source('lib/grade-entry-offline-outbox.ts');
 const stage=grades.stageGradeEntryOfflineSave || grades.queueGradeEntryOfflineSave;
 assert.equal(typeof stage,'function');
 const a=stage({studentId:'s',examId:'e',status:'درجة',score:10,notes:'',expectMissing:true});assert.ok(a);
 session.setOutboxOwner('b');const b=stage({studentId:'s',examId:'e',status:'درجة',score:20,notes:'',expectMissing:true});assert.ok(b);
 grades.confirmGradeEntryOfflineAttempt(a); // Cannot remove B using A's response.
 assert.ok([...storage.values()].some(value=>value.includes(b.revision)));
 pass('enqueue during flush, owner switching, expired sessions and cross-owner grade acknowledgements');
 delete global.window;delete global.document;

 mocks.set('@/lib/scheduled-exam-activation-server',{settleDueScheduledExamActivations:async()=>({scanned:0,activated:0,recalculatedStudents:0,examIds:[]})});
 process.env.CRON_SECRET='p1-local-test';delete process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION;
 const cron=source('app/api/internal/academic-maintenance/route.ts');
 const cronResult=await cron.GET({headers:new Headers({authorization:'Bearer p1-local-test'})});assert.equal(cronResult.status,200);assert.deepEqual((await cronResult.json()).graceSettlement.processedNoteIds,[]);
 pass('real maintenance route with legacy converter disabled');

 mocks.set('@/lib/server-auth',{requirePermission:async()=>null,getAuthPrincipal:async()=>({id:'admin',username:'admin'})});
 for(const route of ['logs/clear','logs/restore','opportunity-logs']) {
  const mod=source(`app/api/${route}/route.ts`);const res=await mod.POST({});assert.equal(res.status,410);assert.equal(res.headers.get('x-teacherpro-retryable'),'false');
  if(mod.DELETE)assert.equal((await mod.DELETE({})).status,410);
 }
 pass('retired ledger endpoints refuse writes without accessing database');

 let studentWrites=0,recalculations=0;
 mocks.set('@/lib/academic-recalculate-server',{recalculateStudentsAcademicState:async()=>{recalculations++}});
 const promotion=source('lib/pre-registration-grade-promotion-server.ts');
 const student={id:'s',courseId:'c',status:'نشط',createdAt:new Date('2026-03-10'),gracePeriodEndedAt:null};
 let notes=[{id:'n',studentId:'s',examId:'e',score:10,exam:{fullMark:100,date:new Date('2026-03-02'),courseIds:'["c"]'}}];let existing={id:'g',status:'غائب',score:null};
 const tx={gradeSmartNote:{findMany:async()=>notes,update:async()=>{},count:async()=>0},grade:{findUnique:async()=>existing,create:async()=>{},update:async()=>{}},studentLeave:{findMany:async()=>[]},student:{findUnique:async()=>({...student}),updateMany:async({where,data})=>{studentWrites++;if(student.createdAt>where.createdAt.gt)student.createdAt=data.createdAt;return{count:1}},update:async()=>{studentWrites++}}};
 assert.equal((await promotion.promotePendingPreRegistrationGrades(tx)).conflicts,1);assert.equal(studentWrites,0);assert.equal(recalculations,0);
 existing=null;notes=[notes[0],{...notes[0],id:'n2',examId:'e2',exam:{...notes[0].exam,date:new Date('2026-03-05')}}];
 assert.equal((await promotion.promotePendingPreRegistrationGrades(tx)).promoted,2);assert.equal(student.createdAt.toISOString(),'2026-03-02T00:00:00.000Z');
 pass('pre-registration conflict performs no student write and multiple notes never move registration forward');
})().catch(e=>{console.error(e);process.exitCode=1});
