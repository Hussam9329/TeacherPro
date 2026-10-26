// «الطالب مؤرشف»: the database itself must accept a grade held for an archived
// student, still refuse unknown categories, and the deploy guard must allow only
// the CHECK widening its reviewed policy names.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');

const MIGRATION = '20261027120000_archived_pending_smart_note';
const sha = (sql) => createHash('sha256').update(sql).digest('hex');

(async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  for (const directory of fs.readdirSync('prisma/migrations').sort()) {
    const file = `prisma/migrations/${directory}/migration.sql`;
    if (fs.existsSync(file)) await db.exec(fs.readFileSync(file, 'utf8'));
  }
  await db.exec(`INSERT INTO "Course" (id,name) VALUES ('c','course');
    INSERT INTO "Student" (id,name,gender,code,"courseId",status,opportunities,"baseOpportunities","createdAt")
      VALUES ('s','archived student','ذكر','A1','c','مؤرشف',3,3,'2026-01-01'::timestamp);
    INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
      VALUES ('e','exam','يومي','2026-10-24','["c"]',50,25,17,1);`);

  await db.query(`INSERT INTO "GradeSmartNote" (id,"studentId","examId",category,status,score,"updatedAt")
    VALUES ('n','s','e','ARCHIVED_PENDING','PENDING',40,CURRENT_TIMESTAMP)`);
  assert.equal((await db.query(`SELECT category FROM "GradeSmartNote" WHERE id='n'`)).rows[0].category, 'ARCHIVED_PENDING');
  await assert.rejects(
    db.query(`INSERT INTO "GradeSmartNote" (id,"studentId","examId",category,score,"updatedAt") VALUES ('x','s','e','UNKNOWN',1,CURRENT_TIMESTAMP)`),
    /GradeSmartNote_category_check/,
    'an unknown category is still refused',
  );

  const { validatePendingMigration } = await import('./check-deployment-contract.mjs');
  const policies = JSON.parse(fs.readFileSync('prisma/deployment-migration-policy.json', 'utf8'));
  const sql = fs.readFileSync(`prisma/migrations/${MIGRATION}/migration.sql`, 'utf8');
  assert.deepEqual(policies[MIGRATION].widensCheck, ['GradeSmartNote_category_check']);
  validatePendingMigration(MIGRATION, sql, policies[MIGRATION], true);

  const policyFor = (text, extra = {}) => ({ kind: 'expand', checksum: sha(text), ...extra });
  const widen = (name) => ({ widensCheck: [name] });
  // Without the named widening, the same migration is still refused.
  assert.throws(() => validatePendingMigration('bare', sql, policyFor(sql), true), /Destructive/);
  // A DROP that is not given back under the same name is refused.
  const dropOnly = 'ALTER TABLE "GradeSmartNote" DROP CONSTRAINT "GradeSmartNote_category_check";';
  assert.throws(() => validatePendingMigration('drop', dropOnly, policyFor(dropOnly, widen('GradeSmartNote_category_check')), true), /does not do/);
  const swapped = 'ALTER TABLE "Grade" DROP CONSTRAINT "Other_check", ADD CONSTRAINT "GradeSmartNote_category_check" CHECK (true);';
  assert.throws(() => validatePendingMigration('swap', swapped, policyFor(swapped, widen('GradeSmartNote_category_check')), true), /does not do/);
  // Anything else destructive next to an allowed widening is still refused.
  const extra = `${sql}\nALTER TABLE "Student" DROP COLUMN "name";`;
  assert.throws(() => validatePendingMigration('extra', extra, policyFor(extra, widen('GradeSmartNote_category_check')), true), /Destructive/);
  // Only an expand migration can name a widening, by a plain constraint name.
  assert.throws(() => validatePendingMigration('kind', sql, { kind: 'audited-data-reconciliation', checksum: sha(sql), ...widen('GradeSmartNote_category_check') }, true), /Invalid CHECK widening/);
  assert.throws(() => validatePendingMigration('name', sql, policyFor(sql, widen('x" , DROP TABLE "y')), true), /Invalid CHECK widening/);

  console.log('PASS: archived students\' held grades are accepted by the database, unknown categories still refused, and the deploy guard allows only the named CHECK widening');
})().catch((error) => { console.error(error); process.exit(1); });
