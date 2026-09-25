// Database contract of the rebuilt grace system: GracePeriod rows are the only
// grace storage, overlapping active periods are impossible, and grades never
// touch grace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
process.env.TZ = 'UTC';
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const pg = new PGlite();
  for (const dir of fs.readdirSync('prisma/migrations').sort()) {
    const file = `prisma/migrations/${dir}/migration.sql`;
    if (!fs.existsSync(file)) continue;
    try { await pg.exec(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${dir}: ${error.message}`); }
  }
  console.log('PASS: migrations bootstrap the GracePeriod table');

  await pg.exec(`INSERT INTO "Course" (id,name) VALUES ('c','course');
    INSERT INTO "Student" (id,name,gender,code,"courseId","createdAt") VALUES ('s','s','ذكر','S1','c','2026-03-01T09:00:00Z'),('t','t','ذكر','T1','c','2026-03-01T09:00:00Z');`);
  const insert = (id, student, start, end, extra = '') =>
    pg.exec(`INSERT INTO "GracePeriod" (id,"studentId","startDate","endDate","updatedAt"${extra ? ',"cancelledAt"' : ''})
      VALUES ('${id}','${student}','${start}','${end}',CURRENT_TIMESTAMP${extra ? `,${extra}` : ''})`);

  await insert('p1', 's', '2026-03-10', '2026-03-12');
  await assert.rejects(insert('p2', 's', '2026-03-12', '2026-03-15'), /GRACE_PERIOD_OVERLAP/);
  await assert.rejects(insert('p3', 's', '2026-03-05', '2026-03-20'), /GRACE_PERIOD_OVERLAP/);
  await assert.rejects(insert('p4', 's', '2026-03-11', '2026-03-11'), /GRACE_PERIOD_OVERLAP/);
  console.log('PASS: overlapping active periods are rejected (inclusive days)');

  await insert('p5', 's', '2026-03-13', '2026-03-14');
  await insert('p6', 't', '2026-03-10', '2026-03-12');
  console.log('PASS: touching periods and other students are allowed');

  await insert('p7', 's', '2026-03-11', '2026-03-16', 'CURRENT_TIMESTAMP');
  await assert.rejects(pg.exec(`UPDATE "GracePeriod" SET "cancelledAt"=NULL WHERE id='p7'`), /GRACE_PERIOD_OVERLAP/);
  await pg.exec(`UPDATE "GracePeriod" SET "cancelledAt"=CURRENT_TIMESTAMP WHERE id='p1'`);
  await pg.exec(`UPDATE "GracePeriod" SET "startDate"='2026-03-09' WHERE id='p5'`);
  console.log('PASS: cancelled periods are kept as history and free their days');

  await assert.rejects(insert('bad', 's', '2026-04-10', '2026-04-09'), /check/i);
  await assert.rejects(
    pg.exec(`INSERT INTO "GracePeriod" (id,"studentId","startDate","endDate",source,"updatedAt") VALUES ('src','s','2026-05-01','2026-05-01','auto',CURRENT_TIMESTAMP)`),
    /check/i,
  );
  console.log('PASS: end before start and unknown sources are rejected');

  await pg.exec(`INSERT INTO "Exam" (id,name,type,"courseIds",date,"fullMark","passMark","discountMark","opportunitiesPenalty")
    VALUES ('e','exam','يومي','["c"]','2026-03-13',100,50,20,'1')`);
  await pg.exec(`INSERT INTO "Grade" (id,"studentId","examId",status,score,"updatedAt") VALUES ('g','s','e','درجة',87,CURRENT_TIMESTAMP)`);
  const periods = (await pg.query(`SELECT id,"startDate"::text AS start,"endDate"::text AS "end","cancelledAt" FROM "GracePeriod" WHERE "studentId"='s' AND "cancelledAt" IS NULL`)).rows;
  assert.deepEqual(periods.map((row) => [row.id, row.start, row.end]), [['p5', '2026-03-09', '2026-03-14']]);
  assert.equal((await pg.query(`SELECT "gracePeriodEndedAt" FROM "Student" WHERE id='s'`)).rows[0].gracePeriodEndedAt, null);
  assert.equal((await pg.query(`SELECT score FROM "Grade" WHERE id='g'`)).rows[0].score, 87);
  console.log('PASS: a numeric grade inside a period changes neither the period nor the grade');

  await pg.exec(`DELETE FROM "Grade" WHERE "studentId"='s'; DELETE FROM "Student" WHERE id='s'`);
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM "GracePeriod" WHERE "studentId"='s'`)).rows[0].n, 0);
  console.log('PASS: periods follow their student');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
