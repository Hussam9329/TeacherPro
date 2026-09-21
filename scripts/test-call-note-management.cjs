const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');

const loaded = new Map();
function load(relative) {
  const file = path.resolve(relative);
  if (loaded.has(file)) return loaded.get(file).exports;
  const entry = { exports: {} };
  loaded.set(file, entry);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', js)((name) => name.startsWith('@/')
    ? load(`src/${name.slice(2)}.ts`) : require(name), entry, entry.exports);
  return entry.exports;
}
const { upsertExamCallNote, editCallNote, setCallNoteResolved, readExpectedNoteRevision } = load('src/lib/call-note-management-server.ts');
const CATEGORY = 'call-student-note';
const actor = { id: 'staff-1', name: 'موظف المتابعة' };
let sequence = 0;

// Exercise the actual server mutation helpers against PostgreSQL transactions.
// This adapter implements only the Prisma operations those helpers may perform:
// no student, grade, balance, or contact-action mutation is available to them.
function adapter(sql) {
  const one = async (query, params = []) => (await sql.query(query, params)).rows[0] || null;
  return {
    $queryRaw: async (strings, ...params) => {
      const query = strings.reduce((text, part, index) => text + part + (index < params.length ? `$${index + 1}` : ''), '');
      assert.match(query, /SELECT "id", "courseId" FROM "Student" .* FOR UPDATE/s);
      return (await sql.query(query, params)).rows;
    },
    examCourse: { findFirst: ({ where }) => one('SELECT id FROM "ExamCourse" WHERE "examId"=$1 AND "courseId"=$2', [where.examId, where.courseId]) },
    studentCall: {
      findUnique: ({ where }) => one('SELECT * FROM "StudentCall" WHERE id=$1', [where.id]),
      findFirst: ({ where }) => one('SELECT * FROM "StudentCall" WHERE "studentId"=$1 AND "examId" IS NOT DISTINCT FROM $2 AND category=$3 ORDER BY "createdAt" DESC,id DESC LIMIT 1', [where.studentId, where.examId, where.category]),
      create: ({ data }) => one('INSERT INTO "StudentCall" (id,"studentId","examId",category,notes,"noteResolved","noteRevision") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [`note-${++sequence}`, data.studentId, data.examId, data.category, data.notes, data.noteResolved, data.noteRevision]),
      update: ({ where, data }) => {
        const values = [where.id];
        const sets = Object.entries(data).map(([key, value]) => {
          assert(['notes', 'noteResolved', 'noteRevision'].includes(key));
          values.push(key === 'noteRevision' ? value.increment : value);
          return `"${key}" = ${key === 'noteRevision' ? `"${key}" + ` : ''}$${values.length}`;
        });
        return one(`UPDATE "StudentCall" SET ${sets.join(',')} WHERE id=$1 RETURNING *`, values);
      },
      delete: ({ where }) => one('DELETE FROM "StudentCall" WHERE id=$1 RETURNING *', [where.id]),
    },
    auditLog: { create: ({ data }) => one('INSERT INTO "AuditLog" (module,action,details,"userId","userName") VALUES ($1,$2,$3,$4,$5) RETURNING *', [data.module, data.action, data.details, data.userId, data.userName]) },
  };
}

(async () => {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "Student" (id text PRIMARY KEY,status text,opportunities integer,"courseId" text);
    CREATE TABLE "Exam" (id text PRIMARY KEY);
    CREATE TABLE "ExamCourse" (id text PRIMARY KEY,"examId" text,"courseId" text);
    CREATE TABLE "Grade" (id text PRIMARY KEY,"studentId" text,score integer);
    CREATE TABLE "StudentCall" (
      id text PRIMARY KEY,"studentId" text NOT NULL REFERENCES "Student"(id),
      "examId" text REFERENCES "Exam"(id),category text NOT NULL DEFAULT '',
      target text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',status text NOT NULL DEFAULT '',
      completed boolean NOT NULL DEFAULT false,"completedAt" timestamp,
      notes text NOT NULL DEFAULT '',"createdAt" timestamp NOT NULL DEFAULT now(),
      "noteResolved" boolean NOT NULL DEFAULT false,"noteRevision" integer NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX ON "StudentCall" ("studentId",coalesce("examId",''),category);
    CREATE TABLE "AuditLog" (id serial PRIMARY KEY,module text,action text,details text,"userId" text,"userName" text);
    INSERT INTO "Student" VALUES ('student','مفصول',0,'course'),('untouched','نشط',2,'course');
    INSERT INTO "Exam" VALUES ('exam-a'),('exam-b'),('exam-other');
    INSERT INTO "ExamCourse" VALUES ('ec-a','exam-a','course'),('ec-b','exam-b','course'),('ec-other','exam-other','other-course');
    INSERT INTO "Grade" VALUES ('grade','student',7);
    INSERT INTO "StudentCall" (id,"studentId","examId",category,notes,status,completed)
      VALUES ('general','student',NULL,'${CATEGORY}','ملاحظة عامة محفوظة','',false),
             ('contact','student','exam-a','legacy-grade-key','تاريخ المكالمة','لم يرد',false);
  `);
  const snapshot = async (table) => (await pg.query(`SELECT row_to_json(t) AS row FROM "${table}" t ORDER BY id`)).rows.map(({ row }) => row);
  const studentsBefore = await snapshot('Student');
  const gradesBefore = await snapshot('Grade');
  const contactBefore = (await pg.query(`SELECT * FROM "StudentCall" WHERE id='contact'`)).rows[0];
  const run = (fn) => pg.transaction((sql) => fn(adapter(sql)));
  const knownNoteIds = new Map();
  const save = async (notes, revision, examId = 'exam-a', expectedNoteId = knownNoteIds.get(examId) || null) => {
    const result = await run((tx) => upsertExamCallNote(tx, actor, { studentId: 'student', examId, notes, expectedRevision: revision, expectedNoteId }));
    knownNoteIds.set(examId, result.studentCall?.id || null);
    return result;
  };
  const resolve = (id, revision, resolved = true) => run((tx) => setCallNoteResolved(tx, actor, { id, expectedRevision: revision, resolved }));
  const note = (id) => pg.query('SELECT * FROM "StudentCall" WHERE id=$1', [id]).then(({ rows }) => rows[0]);

  assert.equal(readExpectedNoteRevision(0), 0);
  for (const value of [-1, 0.5, NaN, '0', null]) assert.throws(() => readExpectedNoteRevision(value));
  await assert.rejects(save('ملاحظة بلا امتحان', 0, null), /اختر الامتحان/);

  await assert.rejects(save('امتحان دورة أخرى', 0, 'exam-other'), /غير مرتبط/);

  const created = (await save('اتصل بولي الأمر', 0)).studentCall;
  assert.equal(created.noteRevision, 1);
  assert.equal(created.noteResolved, false);
  assert.equal((await note('general')).examId, null);
  assert.equal((await note('general')).notes, 'ملاحظة عامة محفوظة');
  await assert.rejects(save('نص كتبه مستخدم آخر', 0), /تغيّرت الملاحظة/);
  assert.equal((await note(created.id)).notes, 'اتصل بولي الأمر');

  const done = await resolve(created.id, 1);
  assert.equal(done.noteResolved, true);
  assert.equal(done.notes, created.notes);
  assert.equal((await note('contact')).status, 'لم يرد');
  const auditCount = (await snapshot('AuditLog')).length;
  await resolve(created.id, 1); // A retried checkbox never duplicates the note/audit.
  await save('اتصل بولي الأمر', 0); // Lost-response retry after completion stays completed.
  assert.equal((await snapshot('AuditLog')).length, auditCount);
  assert.equal((await note(created.id)).noteResolved, true);
  await assert.rejects(save('تعديل قديم بدون نسخة', undefined), /حدّث الملاحظة/);

  const edited = (await save('أعد الاتصال غداً', 1)).studentCall;
  assert.equal(edited.noteRevision, 2);
  assert.equal(edited.noteResolved, false);
  await assert.rejects(resolve(created.id, 1), /تغيّرت الملاحظة/);
  assert.equal((await note(created.id)).noteResolved, false);
  const otherExam = (await save('ملاحظة الامتحان الثاني', 0, 'exam-b')).studentCall;
  assert.notEqual(otherExam.id, created.id);
  await resolve('general', 0);
  assert.equal((await note('general')).noteResolved, true);
  assert.equal((await note(created.id)).noteResolved, false);
  assert.equal((await note(otherExam.id)).noteResolved, false);
  await run((tx) => editCallNote(tx, actor, { id: 'general', notes: 'تعديل الملاحظة العامة', expectedRevision: 0 }));
  assert.equal((await note('general')).examId, null);
  assert.equal((await note('general')).noteResolved, false);
  await assert.rejects(resolve('contact', 0), /غير موجودة/);
  await assert.rejects(resolve('missing', 0), /غير موجودة/);

  // Two operators editing the same version cannot overwrite one another.
  const concurrent = await Promise.allSettled([save('النص الأول', 2), save('النص الثاني', 2)]);
  assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((entry) => entry.status === 'rejected').length, 1);
  const latest = await note(created.id);
  assert.equal(latest.noteRevision, 3);
  const auditsBeforeRollback = await snapshot('AuditLog');
  await assert.rejects(pg.transaction(async (sql) => {
    await setCallNoteResolved(adapter(sql), actor, { id: created.id, expectedRevision: 3, resolved: true });
    throw new Error('simulated transaction failure');
  }), /simulated transaction failure/);
  assert.deepEqual(await note(created.id), latest);
  assert.deepEqual(await snapshot('AuditLog'), auditsBeforeRollback);

  // Explicitly clearing text is still supported; checking a note never does this.
  await save('', 3);
  assert.equal(await note(created.id), undefined);
  const recreated = (await save('ملاحظة جديدة بعد الحذف', 0)).studentCall;
  assert.equal(recreated.noteRevision, 1);
  assert.notEqual(recreated.id, created.id);
  await assert.rejects(save('نسخة قديمة قبل الحذف', 1, 'exam-a', created.id), (error) => error.status === 409 && error.studentCall?.id === recreated.id);
  assert.equal((await note(recreated.id)).notes, 'ملاحظة جديدة بعد الحذف');
  assert.equal((await note(otherExam.id)).notes, 'ملاحظة الامتحان الثاني');
  assert.deepEqual(await snapshot('Student'), studentsBefore);
  assert.deepEqual(await snapshot('Grade'), gradesBefore);
  assert.deepEqual(await note('contact'), contactBefore);
  const audits = await snapshot('AuditLog');
  assert(audits.every((row) => row.userId === actor.id && row.userName === actor.name));
  assert(audits.every((row) => JSON.parse(row.details).source === 'call-note-management'));
  await pg.close();
  console.log('Shared call-note PostgreSQL behavior passed: exam isolation, legacy preservation, revision conflicts, completion, idempotence, rollback, concurrent edits, durable audit, unchanged grades and balances.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
