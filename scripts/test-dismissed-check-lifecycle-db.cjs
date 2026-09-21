const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migrationName = '20260921190000_dismissed_check_lifecycle';

(async () => {
  const db = new PGlite();
  try {
    // Replay the real historical schema; the new trigger must coexist with the
    // opportunity, grade, and academic-history guards already in production.
    for (const directory of fs.readdirSync('prisma/migrations').sort()) {
      const file = `prisma/migrations/${directory}/migration.sql`;
      if (directory < migrationName && fs.existsSync(file)) await db.exec(fs.readFileSync(file, 'utf8'));
    }
    await db.exec(`ALTER TABLE "StudentCall" ALTER COLUMN "examId" DROP NOT NULL;
      INSERT INTO "Course" (id,name) VALUES ('lifecycle-course','course');
      INSERT INTO "Student" (id,name,gender,code,"courseId",status,opportunities,"baseOpportunities","dismissedChecked") VALUES
        ('dismissed-checked','Student A','ذكر','LIFE-1','lifecycle-course','مفصول',0,3,true),
        ('dismissed-open','Student B','أنثى','LIFE-2','lifecycle-course','مفصول',0,3,false),
        ('active-stale','Student C','ذكر','LIFE-3','lifecycle-course','نشط',2,3,true),
        ('archived-stale','Student D','أنثى','LIFE-4','lifecycle-course','مؤرشف',1,3,true);
      INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
        VALUES ('lifecycle-exam','exam','يومي','2026-09-21','["lifecycle-course"]',20,10,7,'1');
      INSERT INTO "Grade" (id,"studentId","examId",status,score,"updatedAt")
        VALUES ('lifecycle-grade','dismissed-checked','lifecycle-exam','درجة',12,now());
      INSERT INTO "StudentCall" (id,"studentId",category,notes,"noteResolved","noteRevision")
        VALUES ('lifecycle-call','dismissed-checked','call-student-note','Original call note',true,4);
      INSERT INTO "OpportunityLog" (id,"studentId",action,amount,reason)
        VALUES ('lifecycle-ledger','dismissed-checked','خصم يدوي',1,'Historic deduction');
      INSERT INTO "StudentNote" (id,"studentId",kind,text,"dismissalReason")
        VALUES ('lifecycle-history','dismissed-checked','فصل','Dismissal history','Historic reason');
      INSERT INTO "AuditLog" (id,module,action,details)
        VALUES ('lifecycle-audit','سجل الطلاب','تأشير الطالب المفصول','{"after":{"dismissedChecked":true}}');
    `);
    const snapshots = async () => {
      const rows = {};
      for (const table of ['Grade', 'StudentCall', 'OpportunityLog', 'StudentNote', 'AuditLog']) {
        rows[table] = (await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY id`)).rows;
      }
      return rows;
    };
    const beforeHistory = await snapshots();
    const beforeStudents = (await db.query(`SELECT to_jsonb(s)-'dismissedChecked' row FROM "Student" s ORDER BY id`)).rows;
    await db.exec(fs.readFileSync(`prisma/migrations/${migrationName}/migration.sql`, 'utf8'));
    const read = async (id = 'dismissed-checked') => (await db.query('SELECT * FROM "Student" WHERE id=$1', [id])).rows[0];
    assert.deepEqual((await db.query(`SELECT to_jsonb(s)-ARRAY['dismissedChecked','dismissedCheckEpoch'] row FROM "Student" s ORDER BY id`)).rows,
      beforeStudents, 'migration does not alter any academic or identifying student field');
    assert.deepEqual(await snapshots(), beforeHistory, 'migration preserves all notes, grades, ledger and audit history');
    assert.equal((await read()).dismissedChecked, true, 'current dismissal checks survive migration');
    for (const id of ['dismissed-open','active-stale','archived-stale']) assert.equal((await read(id)).dismissedChecked, false);
    for (const row of (await db.query('SELECT "dismissedCheckEpoch" FROM "Student"')).rows) assert.equal(row.dismissedCheckEpoch, 0);

    const sameStatus = (await db.query(`UPDATE "Student" SET status='مفصول',school='Updated school'
      WHERE id='dismissed-checked' RETURNING "dismissedChecked","dismissedCheckEpoch"`)).rows[0];
    assert.deepEqual(sameStatus, { dismissedChecked: true, dismissedCheckEpoch: 0 }, 'ordinary edits and same-status replay preserve the current check');
    const activated = (await db.query(`UPDATE "Student" SET status='نشط',"dismissedChecked"=true
      WHERE id='dismissed-checked' RETURNING "dismissedChecked","dismissedCheckEpoch"`)).rows[0];
    assert.deepEqual(activated, { dismissedChecked: false, dismissedCheckEpoch: 1 }, 'UPDATE RETURNING exposes the reset immediately even if the caller supplies true');
    await db.query(`UPDATE "Student" SET "dismissedChecked"=true,"dismissedCheckEpoch"=0 WHERE id='dismissed-checked'`);
    assert.equal((await read()).dismissedChecked, false, 'active students cannot retain a check through a direct write');
    assert.equal((await read()).dismissedCheckEpoch, 1, 'stale writes cannot roll the episode counter back');

    await db.query(`UPDATE "Student" SET status='مفصول',"dismissedChecked"=true WHERE id='dismissed-checked'`);
    assert.equal((await read()).dismissedChecked, false, 'a repeated dismissal starts unchecked even when a writer carries old true');
    assert.equal((await read()).dismissedCheckEpoch, 2);
    // Backups restore complete scalar rows via upsert. An old episode cannot
    // recreate its checked value or replace the newer episode counter.
    await db.exec(`INSERT INTO "Student" (id,name,gender,code,"courseId",status,"dismissedChecked","dismissedCheckEpoch")
      VALUES ('dismissed-checked','Student A','ذكر','LIFE-1','lifecycle-course','مفصول',true,0)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,"dismissedChecked"=EXCLUDED."dismissedChecked","dismissedCheckEpoch"=EXCLUDED."dismissedCheckEpoch"`);
    assert.equal((await read()).dismissedCheckEpoch, 2, 'backup upsert keeps the authoritative current epoch');
    assert.equal((await read()).dismissedChecked, false, 'stale backup from a prior dismissal cannot close the new episode');
    await db.query(`UPDATE "Student" SET "dismissedChecked"=true WHERE id='dismissed-checked'`);
    await db.query(`UPDATE "Student" SET "dismissedChecked"=false,"dismissedCheckEpoch"=0 WHERE id='dismissed-checked'`);
    assert.equal((await read()).dismissedChecked, true, 'a stale unchecked snapshot cannot overwrite a current checked choice');

    // The reconciliation path uses one raw SQL batch rather than Prisma hooks.
    // Exercise the database boundary with mixed student states in that batch.
    await db.exec(`UPDATE "Student" s SET status=v.status FROM
      (VALUES ('dismissed-checked','نشط'),('dismissed-open','نشط'),('active-stale','نشط')) AS v(id,status)
      WHERE s.id=v.id`);
    assert.equal((await read()).dismissedChecked, false);
    assert.equal((await read()).dismissedCheckEpoch, 3);
    assert.equal((await read('dismissed-open')).dismissedCheckEpoch, 1);
    assert.equal((await read('active-stale')).dismissedCheckEpoch, 0, 'unchanged status in a batch does not advance the episode');
    await db.query(`UPDATE "Student" SET status='مفصول' WHERE id='dismissed-checked'`);
    await db.query(`UPDATE "Student" SET "dismissedChecked"=true WHERE id='dismissed-checked'`);
    await db.query(`UPDATE "Student" SET status='مؤرشف' WHERE id='dismissed-checked'`);
    assert.equal((await read()).dismissedChecked, false, 'archive transitions clear the operational check too');
    await db.exec(`INSERT INTO "Student" (id,name,gender,code,"courseId",status,"dismissedChecked")
      VALUES ('new-active','Student E','ذكر','LIFE-5','lifecycle-course','نشط',true)`);
    assert.equal((await read('new-active')).dismissedChecked, false, 'inserting an active student cannot carry a checked flag');
    assert.deepEqual(await snapshots(), beforeHistory, 'lifecycle changes do not rewrite academic records or historic audit entries');
    assert.deepEqual((await db.query(`SELECT id,opportunities,"baseOpportunities" FROM "Student" WHERE id<>'new-active' ORDER BY id`)).rows,
      beforeStudents.map(({row}) => ({id: row.id, opportunities: row.opportunities, baseOpportunities: row.baseOpportunities})),
      'every original student balance remains untouched');
    console.log('PASS: full migration replay, selective stale-flag cleanup, returning/batch/upsert/insert lifecycle guard, epoch monotonicity, and untouched grades/balances/history');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
