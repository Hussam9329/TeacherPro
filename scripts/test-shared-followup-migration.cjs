const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migrationName = '20260921170000_shared_followup_checkboxes';
(async () => {
  const db = new PGlite();
  try {
    for (const directory of fs.readdirSync('prisma/migrations').sort()) {
      const file = `prisma/migrations/${directory}/migration.sql`;
      if (directory < migrationName && fs.existsSync(file)) await db.exec(fs.readFileSync(file, 'utf8'));
    }
    // The reconstructed historical bridge predates the current nullable examId
    // contract. Match the existing Prisma model before testing this expansion.
    await db.exec(`ALTER TABLE "StudentCall" ALTER COLUMN "examId" DROP NOT NULL`);
    await db.exec(`
      INSERT INTO "Course" (id,name) VALUES ('shared-course','course');
      INSERT INTO "Student" (id,name,gender,code,"courseId",status,opportunities,"baseOpportunities")
        VALUES ('shared-student','student','ذكر','SHARED-1','shared-course','مفصول',0,3),
               ('shared-other','other','أنثى','SHARED-2','shared-course','نشط',2,3);
      INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
        VALUES ('shared-exam','exam','يومي','2026-09-21','["shared-course"]',20,10,7,'1');
      INSERT INTO "StudentCall" (id,"studentId",category,notes)
        VALUES ('shared-general','shared-student','call-student-note','ملاحظة قديمة عامة');
      INSERT INTO "StudentCall" (id,"studentId","examId",category,status,completed,notes)
        VALUES ('shared-contact','shared-student','shared-exam','call-exam','تم الاتصال',true,'تواصل محفوظ');
      INSERT INTO "Grade" (id,"studentId","examId",status,score,"updatedAt")
        VALUES ('shared-grade','shared-student','shared-exam','درجة',12,now());
    `);
    const beforeStudents = (await db.query('SELECT to_jsonb(s) row FROM "Student" s ORDER BY id')).rows;
    const beforeCalls = (await db.query('SELECT to_jsonb(c) row FROM "StudentCall" c ORDER BY id')).rows;
    const beforeGrades = (await db.query('SELECT * FROM "Grade" ORDER BY id')).rows;
    await db.exec(fs.readFileSync(`prisma/migrations/${migrationName}/migration.sql`, 'utf8'));
    assert.deepEqual((await db.query(`SELECT to_jsonb(s)-'dismissedChecked' row FROM "Student" s ORDER BY id`)).rows, beforeStudents);
    assert.deepEqual((await db.query(`SELECT to_jsonb(c)-ARRAY['noteResolved','noteRevision'] row FROM "StudentCall" c ORDER BY id`)).rows, beforeCalls);
    assert.deepEqual((await db.query('SELECT * FROM "Grade" ORDER BY id')).rows, beforeGrades);
    assert((await db.query('SELECT "dismissedChecked" FROM "Student"')).rows.every(r => r.dismissedChecked === false));
    assert((await db.query('SELECT "noteResolved","noteRevision" FROM "StudentCall"')).rows.every(r => r.noteResolved === false && r.noteRevision === 0));
    // Backups use the complete Prisma scalar record; restored values must retain
    // both true and false instead of silently replacing them with defaults.
    await db.exec(`UPDATE "Student" SET "dismissedChecked"=true WHERE id='shared-student';
      UPDATE "StudentCall" SET "noteResolved"=true,"noteRevision"=4 WHERE id='shared-general';`);
    const studentBackup=(await db.query(`SELECT to_jsonb(s) row FROM "Student" s WHERE id='shared-student'`)).rows[0].row;
    const noteBackup=(await db.query(`SELECT to_jsonb(c) row FROM "StudentCall" c WHERE id='shared-general'`)).rows[0].row;
    assert.equal(studentBackup.dismissedChecked,true);assert.equal(noteBackup.noteResolved,true);assert.equal(noteBackup.notes,'ملاحظة قديمة عامة');assert.equal(noteBackup.examId,null);
    await db.exec(`UPDATE "Student" SET "dismissedChecked"=false WHERE id='shared-student';`);
    assert.equal((await db.query(`SELECT "dismissedChecked" FROM "Student" WHERE id='shared-student'`)).rows[0].dismissedChecked,false);
    assert.deepEqual((await db.query(`SELECT to_jsonb(s)-'dismissedChecked' row FROM "Student" s ORDER BY id`)).rows, beforeStudents);
    assert.deepEqual((await db.query('SELECT * FROM "Grade" ORDER BY id')).rows, beforeGrades);
    console.log('PASS: shared follow-up migration preserves every academic/legacy record, defaults unchecked, and retains both shared boolean values.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
