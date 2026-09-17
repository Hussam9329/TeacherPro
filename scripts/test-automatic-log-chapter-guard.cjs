const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const migrationName = '20260917180000_guard_automatic_log_chapter';

(async () => {
  const db = new PGlite();
  try {
    for (const directory of fs.readdirSync('prisma/migrations').sort()) {
      const file = `prisma/migrations/${directory}/migration.sql`;
      if (fs.existsSync(file) && directory < migrationName) {
        await db.exec(fs.readFileSync(file, 'utf8'));
      }
    }
    await db.exec(`
      INSERT INTO "Course" (id,name) VALUES ('guard-course','course');
      INSERT INTO "Chapter" (id,name,opportunities)
        VALUES ('guard-old','old',3),('guard-current','current',3);
      INSERT INTO "CourseChapter" (id,"courseId","chapterId",active)
        VALUES ('guard-link','guard-course','guard-current',true);
      INSERT INTO "Student" (id,name,gender,code,"courseId",opportunities,"baseOpportunities")
        VALUES ('guard-student','student','ذكر','GUARD-1','guard-course',1,3);
      INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
        VALUES ('guard-new-exam','new','يومي','2026-09-17','["guard-course"]',20,10,7,'1'),
               ('guard-old-exam','old','يومي','2026-07-18','["guard-course"]',20,10,7,'1');
      UPDATE "ExamCourse" SET "chapterId"='guard-old' WHERE "examId"='guard-old-exam';
      INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,date,"chapterId")
        VALUES ('legacy-null','guard-student','guard-old-exam','خصم تلقائي',1,'تلقائي: تاريخي','2026-07-18',NULL),
               ('legacy-scoped','guard-student','guard-old-exam','خصم تلقائي',1,'تلقائي: تاريخي موثق','2026-07-18','guard-old');
    `);
    const beforeStudents = (await db.query('SELECT * FROM "Student" ORDER BY id')).rows;
    const beforeHistory = (await db.query('SELECT * FROM "OpportunityLog" ORDER BY id')).rows;
    await db.exec(fs.readFileSync(`prisma/migrations/${migrationName}/migration.sql`, 'utf8'));
    assert.deepEqual((await db.query('SELECT * FROM "Student" ORDER BY id')).rows, beforeStudents);
    assert.deepEqual((await db.query('SELECT * FROM "OpportunityLog" ORDER BY id')).rows, beforeHistory);

    const insert = (id, chapterId, examId = 'guard-new-exam', action = 'خصم تلقائي', reason = 'تلقائي: خصم') =>
      db.query(`INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,"chapterId")
        VALUES ($1,'guard-student',$2,$3,1,$4,$5)`, [id, examId, action, reason, chapterId]);
    const provenanceError = error => error.code === '23514' &&
      error.constraint === 'tp_automatic_opportunity_chapter_required';
    const scopeError = error => error.code === '23514' &&
      error.constraint === 'tp_active_chapter_opportunity_scope';

    for (const [id, chapter] of [['null', null], ['empty', ''], ['blank', '   ']]) {
      await assert.rejects(insert(`blocked-${id}`, chapter), provenanceError);
    }
    await assert.rejects(insert('blocked-dismissal', null, 'guard-new-exam', 'فصل تلقائي'), provenanceError);
    await assert.rejects(insert('blocked-prefix', null, 'guard-new-exam', 'خصم', 'تلقائي: كاتب قديم'), provenanceError);
    await assert.rejects(insert('blocked-old-as-current', 'guard-current', 'guard-old-exam'), scopeError);
    await insert('valid-current', 'guard-current');
    await insert('valid-history', 'guard-old', 'guard-old-exam');
    await insert('manual-unscoped', null, 'guard-new-exam', 'خصم', 'قرار إداري');
    await assert.rejects(db.exec(`UPDATE "OpportunityLog" SET "chapterId"=NULL WHERE id='valid-current'`), provenanceError);
    await assert.rejects(db.exec(`UPDATE "OpportunityLog" SET "chapterId"=NULL WHERE id='legacy-scoped'`), provenanceError);
    await assert.rejects(db.exec(`UPDATE "OpportunityLog" SET reason='تلقائي: خصم جديد' WHERE id='legacy-null'`), provenanceError);
    await assert.rejects(db.exec(`UPDATE "OpportunityLog" SET amount=2 WHERE id='legacy-null'`), provenanceError);
    await db.exec(`UPDATE "OpportunityLog" SET "chapterId"="chapterId",amount=amount,reason=reason WHERE id='legacy-null'`);
    assert.deepEqual((await db.query(`SELECT * FROM "OpportunityLog" WHERE id='legacy-null'`)).rows[0], beforeHistory.find(row => row.id === 'legacy-null'));
    await db.exec(`UPDATE "OpportunityLog" SET "chapterNameSnapshot"='عنوان تاريخي' WHERE id='legacy-null'`);
    assert.equal((await db.query(`SELECT "chapterId" FROM "OpportunityLog" WHERE id='legacy-null'`)).rows[0].chapterId, null);

    // A legacy writer used to change the Student before writing its unscoped
    // effects. The trigger failure must roll back that status/balance as well.
    await assert.rejects(db.transaction(async tx => {
      await tx.exec(`UPDATE "Student" SET status='مفصول',opportunities=0,"dismissalReason"='سبب قديم' WHERE id='guard-student'`);
      await tx.exec(`INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason)
        VALUES ('atomic-stale','guard-student','guard-old-exam','فصل تلقائي',0,'تلقائي: سبب قديم')`);
    }), provenanceError);
    assert.deepEqual((await db.query('SELECT * FROM "Student" ORDER BY id')).rows, beforeStudents);
    assert.equal((await db.query(`SELECT count(*)::int n FROM "OpportunityLog" WHERE id='atomic-stale'`)).rows[0].n, 0);

    // The existing explicit snapshot restore context is transaction-local;
    // restoring history must not leave ordinary requests able to bypass it.
    await db.transaction(async tx => {
      await tx.exec(`SELECT set_config('teacherpro.restore_snapshot','on',true)`);
      await tx.exec(`INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason)
        VALUES ('restored-history','guard-student','guard-old-exam','خصم تلقائي',1,'تلقائي: نسخة محفوظة')`);
    });
    assert.equal((await db.query(`SELECT "chapterId" FROM "OpportunityLog" WHERE id='restored-history'`)).rows[0].chapterId, null);
    await assert.rejects(insert('blocked-after-restore', null), provenanceError);
    assert.deepEqual((await db.query('SELECT * FROM "Student" ORDER BY id')).rows, beforeStudents);
    console.log('PASS: automatic logs require chapter provenance, reject stale/unscoped writes atomically, preserve scoped history and existing balances, and retain transaction-scoped snapshot restoration');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
