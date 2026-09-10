const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const { Prisma } = require('@prisma/client');

require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  filename,
);

const { persistAcademicStudentResults } = require('../src/lib/academic-student-writeback-server.ts');

(async () => {
  const pg = new PGlite();
  try {
    for (const directory of fs.readdirSync('prisma/migrations').sort()) {
      const filename = path.join('prisma/migrations', directory, 'migration.sql');
      if (fs.existsSync(filename)) await pg.exec(fs.readFileSync(filename, 'utf8'));
    }
    assert.ok(!Prisma.dmmf.datamodel.models.find(model => model.name === 'Student').fields.some(field => field.isUpdatedAt),
      'Student has no Prisma automatic update timestamp; revisit writeback if that schema contract changes');

    await pg.exec(`
      INSERT INTO "Course" (id, name) VALUES ('c', 'الدورة');
      INSERT INTO "Student" (id, name, "nameKey", gender, code, "courseId", status, opportunities,
        "baseOpportunities", "dismissalReason", "dismissalNotes", school, phone, "createdAt")
      SELECT 's' || i, 'طالب ' || i, 'key' || i, 'ذكر', 'BIO-' || i, 'c', 'نشط', 3,
        3, 'سبب سابق', 'ملاحظة يدوية محفوظة', 'مدرسة محفوظة', '07' || i, '2026-01-01'::timestamp
      FROM generate_series(1, 2102) i;
    `);
    const maliciousId = "student'; DROP TABLE \"Student\"; --";
    await pg.query('INSERT INTO "Student" (id,name,gender,code,"courseId",status,opportunities) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [maliciousId, 'اسم محفوظ', 'ذكر', 'SAFE-SQL', 'c', 'نشط', 3]);

    const snapshot = async () => (await pg.query('SELECT * FROM "Student" ORDER BY id')).rows;
    const before = await snapshot();
    const originalById = new Map(before.map(student => [student.id, student]));
    const statements = [];
    let failOnQuery = 0;
    const client = {
      $queryRaw: async statement => {
        statements.push(statement);
        if (failOnQuery && statements.length === failOnQuery) throw new Error('injected second-batch failure');
        return (await pg.query(statement.text, statement.values)).rows;
      },
    };
    const transact = async operation => {
      await pg.exec('BEGIN');
      try { const result = await operation(); await pg.exec('COMMIT'); return result; }
      catch (error) { await pg.exec('ROLLBACK'); throw error; }
    };
    const results = Array.from({ length: 2101 }, (_, index) => {
      const number = index + 1;
      return {
        id: 's' + number,
        status: number % 4 === 0 ? 'مفصول' : 'نشط',
        opportunities: number % 4 === 0 ? 0 : number % 3,
        dismissalReason: number % 4 === 0 ? 'سبب امتحان' : '',
        // Unrecognized fields must never reach SQL assignments.
        dismissalNotes: 'must not overwrite',
        baseOpportunities: 999,
        phone: 'must not overwrite',
      };
    });
    results.push({ id: maliciousId, status: 'نشط', opportunities: 0, dismissalReason: '' });
    assert.equal(await transact(() => persistAcademicStudentResults(client, results)), 2102);
    assert.equal(statements.length, Math.ceil(results.length / 500), '2102 students require only five database statements');
    for (const statement of statements) {
      assert.ok(statement.values.length <= 500 * 4, 'each statement is bounded to 500 student rows');
      assert.ok(!statement.text.includes(maliciousId), 'student IDs are parameters, never SQL text');
    }

    const expectedById = new Map(results.map(student => [student.id, student]));
    for (const student of await snapshot()) {
      const { status, opportunities, dismissalReason, ...otherFields } = student;
      const { status: oldStatus, opportunities: oldOpportunities, dismissalReason: oldReason, ...originalFields } = originalById.get(student.id);
      assert.deepEqual(otherFields, originalFields, 'manual fields, identity, enrollment, and timestamps remain unchanged');
      const expected = expectedById.get(student.id);
      assert.deepEqual([status, opportunities, dismissalReason], expected
        ? [expected.status, expected.opportunities, expected.dismissalReason || null]
        : [oldStatus, oldOpportunities, oldReason], 'only targeted academic results change');
    }

    statements.length = 0;
    assert.equal(await transact(() => persistAcademicStudentResults(client, results)), 0, 'unchanged rows are not updated');
    assert.equal(statements.length, 5);
    statements.length = 0;
    assert.equal(await persistAcademicStudentResults(client, []), 0);
    assert.equal(statements.length, 0, 'empty input does not query the database');

    const duplicateResult = { id: 's1', status: 'نشط', opportunities: 2.9, dismissalReason: '' };
    assert.equal(await transact(() => persistAcademicStudentResults(client, [
      { ...duplicateResult, opportunities: 1 }, duplicateResult,
    ])), 1, 'duplicate IDs keep the final result and fractional values retain existing truncation semantics');
    assert.equal((await pg.query('SELECT opportunities FROM "Student" WHERE id=$1', ['s1'])).rows[0].opportunities, 2);
    assert.equal(await transact(() => persistAcademicStudentResults(client, [{ ...duplicateResult, opportunities: -2 }])), 1);
    assert.equal((await pg.query('SELECT opportunities FROM "Student" WHERE id=$1', ['s1'])).rows[0].opportunities, 0);

    const beforeFailure = await snapshot();
    statements.length = 0;
    failOnQuery = 2;
    await assert.rejects(transact(() => persistAcademicStudentResults(client,
      results.map(student => ({ ...student, status: 'نشط', opportunities: 1, dismissalReason: 'would change' })),
    )), /injected second-batch failure/);
    assert.equal(statements.length, 2);
    assert.deepEqual(await snapshot(), beforeFailure, 'second-batch failure rolls back the first 500 writes');

    failOnQuery = 0;
    statements.length = 0;
    await assert.rejects(transact(() => persistAcademicStudentResults(client, [
      { id: 's1', status: 'نشط', opportunities: 2, dismissalReason: 'would change' },
      { id: 'missing', status: 'نشط', opportunities: 1, dismissalReason: '' },
    ])), /تغيرت قائمة الطلاب/);
    assert.deepEqual(await snapshot(), beforeFailure, 'a missing student fails rather than silently committing a partial result');
    console.log('PASS: 2102 student results use five bounded statements; unchanged rows, manual fields, null/zero values, SQL parameters and transaction rollback verified.');
  } finally {
    await pg.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
