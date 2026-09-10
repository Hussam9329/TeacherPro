const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  for (const directory of fs.readdirSync('prisma/migrations').sort()) {
    const file = `prisma/migrations/${directory}/migration.sql`;
    if (fs.existsSync(file) && directory !== '20260910140000_active_chapter_opportunity_guard') await db.exec(fs.readFileSync(file, 'utf8'));
  }
  await db.exec(`
    INSERT INTO "Course" (id,name) VALUES ('c_mqry9o7z_78jc7b','course');
    INSERT INTO "Chapter" (id,name,opportunities) VALUES ('ch_mqhfvbi1_6l36qw','old',3),('current','current',3);
    INSERT INTO "CourseChapter" (id,"courseId","chapterId",active) VALUES ('cc','c_mqry9o7z_78jc7b','current',true);
    INSERT INTO "Student" (id,name,gender,code,"courseId",opportunities) VALUES ('s','student','ذكر','TEST','c_mqry9o7z_78jc7b',1),('u','untouched','ذكر','KEEP','c_mqry9o7z_78jc7b',2);
    INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty") VALUES ('cmt1hg0sx0000l104pb1asisz','old exam','يومي','2026-08-19','["c_mqry9o7z_78jc7b"]',20,10,7,'1');
    UPDATE "ExamCourse" SET id='ec',"chapterId"=null,"chapterSource"='ambiguous-accounting-history' WHERE "examId"='cmt1hg0sx0000l104pb1asisz';
    INSERT INTO "Grade" (id,"studentId","examId",status,"updatedAt") VALUES ('g','s','cmt1hg0sx0000l104pb1asisz','غائب',CURRENT_TIMESTAMP);
    INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,"chapterId") VALUES ('bad','s','cmt1hg0sx0000l104pb1asisz','خصم تلقائي',1,'تلقائي: غياب','current'),('manual','s',null,'إعادة تعيين',3,'تسوية تاريخية: انتقال','current');
    CREATE TEMP TABLE chapter_scope_repair_plan(payload jsonb);
  `);
  await db.exec(fs.readFileSync('prisma/migrations/20260910140000_active_chapter_opportunity_guard/migration.sql', 'utf8'));
  await assert.rejects(db.exec(`INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,"chapterId") VALUES ('new-bad','s','cmt1hg0sx0000l104pb1asisz','خصم تلقائي',1,'تلقائي: غياب','current')`), /outside the active chapter/);
  await assert.rejects(db.exec(`UPDATE "OpportunityLog" SET reason='تلقائي: إعادة كتابة خطأ' WHERE id='bad'`), /outside the active chapter/);
  const expected = {};
  for (const table of ['Student','Grade','OpportunityLog','StudentLeave','StudentNote','Exam','ExamCourse','CourseChapter','Chapter']) {
    const where = table === 'Student' ? " WHERE id='s'" : ['Grade','OpportunityLog','StudentLeave','StudentNote'].includes(table) ? " WHERE \"studentId\"='s'" : '';
    expected[table] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) data FROM "${table}" t${where}`)).rows[0].data;
  }
  const before = expected.Student[0];
  const plan = {
    repairId: 'chapter_scope_20260910_v2', expected,
    assignment: { before: expected.ExamCourse[0], after: { ...expected.ExamCourse[0], chapterId: 'ch_mqhfvbi1_6l36qw', chapterSource: 'owner-confirmed-first-chapter-20260910' } },
    items: [{ studentId: 's', chapterId: 'current', before: { status: before.status, opportunities: 1, dismissalReason: before.dismissalReason }, after: { status: 'نشط', opportunities: 2, dismissalReason: null }, removeLogIds: ['bad'], insertLogs: [], suspectLogIds: ['bad'] }],
  };
  const contract = fs.readFileSync('scripts/contracts/repair-cross-chapter-opportunities.sql', 'utf8');
  const apply = async value => {
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await db.exec('DELETE FROM chapter_scope_repair_plan');
      await db.query('INSERT INTO chapter_scope_repair_plan VALUES ($1::jsonb)', [JSON.stringify(value)]);
      await db.exec(contract);
      await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  };
  const balance = async id => (await db.query('SELECT opportunities FROM "Student" WHERE id=$1', [id])).rows[0].opportunities;
  // Exercise dismissal correction with an exam whose name changed. The old
  // name must be proven by its audit record, never guessed from a reason.
  await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await db.exec(`INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty") VALUES ('current-exam','new-title','يومي','2026-09-05','["c_mqry9o7z_78jc7b"]',20,10,7,'1');
      UPDATE "ExamCourse" SET "chapterId"='current' WHERE "examId"='current-exam';
      UPDATE "Student" SET status='مفصول',opportunities=0,"dismissalReason"='مخالفة بعد انتهاء الفرص: old-title' WHERE id='s';
      INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,"chapterId") VALUES ('dismissal-evidence','s','current-exam','فصل تلقائي',0,'تلقائي: مخالفة بعد انتهاء الفرص: new-title','current');
      INSERT INTO "AuditLog" (id,module,action,details) VALUES ('rename-evidence','الامتحانات','إنشاء امتحان','{"examId":"current-exam","examName":"old-title"}');`);
    const restoredPlan=structuredClone(plan);
    for(const table of Object.keys(expected)) {
      const where=table==='Student'?" WHERE id='s'":['Grade','OpportunityLog','StudentLeave','StudentNote'].includes(table)?" WHERE \"studentId\"='s'":'';
      restoredPlan.expected[table]=(await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) data FROM "${table}" t${where}`)).rows[0].data;
    }
    Object.assign(restoredPlan.items[0],{
      before:{status:'مفصول',opportunities:0,dismissalReason:'مخالفة بعد انتهاء الفرص: old-title'},
      after:{status:'نشط',opportunities:0,dismissalReason:null},
      removeLogIds:['bad','dismissal-evidence'],restorationEvidenceLogId:'dismissal-evidence',
    });
    await db.query('INSERT INTO chapter_scope_repair_plan VALUES ($1::jsonb)',[JSON.stringify(restoredPlan)]);
    await db.exec('SAVEPOINT missing_evidence');
    await assert.rejects(db.exec(contract),/exact obsolete automatic dismissal evidence/);
    await db.exec('ROLLBACK TO SAVEPOINT missing_evidence');
    restoredPlan.items[0].renamedExamEvidenceId='rename-evidence';
    await db.query('UPDATE chapter_scope_repair_plan SET payload=$1::jsonb',[JSON.stringify(restoredPlan)]);
    await db.exec(contract);
    assert.equal((await db.query(`SELECT status FROM "Student" WHERE id='s'`)).rows[0].status,'نشط');
    assert.equal(await balance('s'),0,'correcting an erroneous dismissal is not a two-chance pledge');
  } finally { await db.exec('ROLLBACK'); }
  await db.exec(`UPDATE "Grade" SET notes='concurrent correction' WHERE id='g'`);
  await assert.rejects(apply(plan), /Stale repair snapshot: Grade/);
  assert.equal(await balance('s'), 1);
  await db.exec(`UPDATE "Grade" SET notes=null WHERE id='g'`);
  const reduced = structuredClone(plan); reduced.items[0].after.opportunities = 0;
  await assert.rejects(apply(reduced), /cannot reduce balances/);
  const manual = structuredClone(plan); manual.items[0].removeLogIds.push('manual');
  await assert.rejects(apply(manual), /manual, historical/);
  assert.equal((await db.query('SELECT "chapterId" FROM "ExamCourse" WHERE id=\'ec\'')).rows[0].chapterId, null, 'a failure rolls the assignment back too');
  await apply(plan);
  assert.equal(await balance('s'), 2);
  assert.equal(await balance('u'), 2, 'non-target balances never change');
  assert.equal((await db.query(`SELECT count(*)::int n FROM "OpportunityLog" WHERE id='bad'`)).rows[0].n, 0);
  assert.equal((await db.query(`SELECT amount FROM "OpportunityLog" WHERE id='manual'`)).rows[0].amount, 3);
  const audit = JSON.parse((await db.query(`SELECT details FROM "AuditLog" WHERE id='chapter_scope_20260910_v2_s'`)).rows[0].details);
  assert.equal(audit.removedLogs[0].id, 'bad', 'removed records remain recoverable in the audit');
  assert.equal(audit.before.opportunities, 1);
  await apply(plan);
  assert.equal(await balance('s'), 2, 'repeated application cannot grant another opportunity');
  assert.equal((await db.query(`SELECT count(*)::int n FROM "AuditLog" WHERE id LIKE 'chapter_scope_20260910_v2%'`)).rows[0].n, 2);
  await db.close();
  console.log('PASS: chapter repair is atomic, audited, idempotent, rejects changed sources, and preserves manual logs and unrelated balances');
})().catch(error => { console.error(error); process.exitCode = 1; });
