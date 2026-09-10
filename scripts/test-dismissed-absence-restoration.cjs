const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 for(const directory of fs.readdirSync('prisma/migrations').sort()){
  const file=`prisma/migrations/${directory}/migration.sql`;
  if(fs.existsSync(file))await db.exec(fs.readFileSync(file,'utf8'));
 }
 await db.exec(`INSERT INTO "Course" (id,name) VALUES ('restore-course','course');
  INSERT INTO "Student" (id,name,gender,code,"courseId",status,opportunities,"createdAt")
   SELECT 'student-'||i,'test','ذكر','TEST-'||i,'restore-course','مفصول',0,'2026-01-01'::timestamp FROM generate_series(1,23) i;
  INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
   VALUES ('cmtppnemd0000jj04boni2ewu','eighth','تراكمي','2026-09-05','["restore-course"]',50,25,15,'1');
  INSERT INTO "Grade" (id,"studentId","examId",status,notes,"createdAt","updatedAt")
   SELECT 'original-'||i,'student-'||i,'cmtppnemd0000jj04boni2ewu','غائب','original absence','2026-09-07'::timestamp,'2026-09-07'::timestamp FROM generate_series(1,23) i;
  INSERT INTO "OpportunityLog" (id,"studentId",action,amount) VALUES ('keep-ledger','student-1','إعادة تعيين',0);
  CREATE TEMP TABLE absence_restore_source(payload jsonb);`);
 const original=(await db.query('SELECT jsonb_agg(to_jsonb(g) ORDER BY id) data FROM "Grade" g')).rows[0].data;
 await db.exec(`DELETE FROM "Grade";
  INSERT INTO "Grade" (id,"studentId","examId",status,score,"updatedAt") VALUES ('new-grade','student-1','cmtppnemd0000jj04boni2ewu','درجة',40,CURRENT_TIMESTAMP);`);
 await db.query('INSERT INTO absence_restore_source VALUES ($1::jsonb)',[JSON.stringify(original)]);
 const snapshot=async table=>(await db.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) data FROM "${table}" t`)).rows[0].data;
 const students=await snapshot('Student'),logs=await snapshot('OpportunityLog'),existing=await snapshot('Grade');
 const contract=fs.readFileSync('scripts/contracts/restore-dismissed-exam-eight-absences.sql','utf8');
 const apply=async()=>{await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');try{await db.exec(contract);await db.exec('COMMIT');}catch(e){await db.exec('ROLLBACK');throw e;}};
 await db.exec(`UPDATE "Student" SET status='نشط' WHERE id='student-2'`);
 await assert.rejects(apply(),/student status changed/);
 assert.deepEqual(await snapshot('Grade'),existing,'status conflicts must roll back the entire restoration');
 await db.exec(`UPDATE "Student" SET status='مفصول' WHERE id='student-2'`);
 await apply();
 const restored=await snapshot('Grade');
 assert.equal(restored.length,23);
 assert.deepEqual(restored.filter(g=>g.id==='new-grade'),existing,'a newer numeric grade must never be overwritten');
 assert.deepEqual(restored.filter(g=>g.id!=='new-grade'),original.filter(g=>g.studentId!=='student-1'));
 assert.deepEqual(await snapshot('Student'),students,'all student fields including balances and status stay identical');
 assert.deepEqual(await snapshot('OpportunityLog'),logs);
 const audit=JSON.parse((await db.query('SELECT details FROM "AuditLog" WHERE id=\'restore_dismissed_exam8_20260910_v1\'')).rows[0].details);
 assert.equal(audit.restoredCount,22);assert.equal(audit.preservedExistingCount,1);
 await apply();assert.deepEqual(await snapshot('Grade'),restored,'repeating restoration must not duplicate any row');
 await db.close();
 console.log('PASS: absence restoration preserves newer grades, original timestamps, all balances/statuses and opportunity logs; conflicts roll back and repeats are harmless');
})().catch(e=>{console.error(e);process.exitCode=1});
