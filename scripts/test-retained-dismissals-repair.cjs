const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const runId = 'retained_dismissal_20260917_v1';
const contract = fs.readFileSync('scripts/contracts/repair-retained-dismissals.sql', 'utf8');
const childTables = ['Grade', 'OpportunityLog', 'StudentLeave', 'StudentNote', 'GradeSmartNote'];
const metadataTables = ['Exam', 'ExamCourse', 'CourseChapter', 'Chapter'];

(async () => {
  const db = new PGlite();
  for (const directory of fs.readdirSync('prisma/migrations').sort()) {
    const file = `prisma/migrations/${directory}/migration.sql`;
    if (fs.existsSync(file) && directory !== '20260917180000_guard_automatic_log_chapter') await db.exec(fs.readFileSync(file, 'utf8'));
  }
  await db.exec(`
    INSERT INTO "Course" (id,name) VALUES ('course','course');
    INSERT INTO "Chapter" (id,name,opportunities) VALUES ('old','old',3),('origin','origin',3),('current','current',3);
    INSERT INTO "CourseChapter" (id,"courseId","chapterId",active) VALUES ('cc','course','current',true);
    INSERT INTO "Student" (id,name,gender,code,"courseId",status,opportunities,"dismissalReason","dismissalType")
     VALUES ('s','student','ذكر','TEST','course','مفصول',0,'مخالفة بعد انتهاء الفرص: current-title','فصل'),
            ('u','untouched','ذكر','KEEP','course','نشط',2,NULL,NULL);
    INSERT INTO "Exam" (id,name,type,date,"courseIds","fullMark","passMark","discountMark","opportunitiesPenalty")
     VALUES ('old-exam','old-exam','تراكمي','2026-07-18','["course"]',50,25,19,'1'),
            ('source-exam','current-title','تراكمي','2026-09-05','["course"]',50,25,19,'1'),
            ('current-exam','current-exam','تراكمي','2026-09-12','["course"]',50,25,19,'2');
    UPDATE "ExamCourse" SET "chapterId"=CASE "examId" WHEN 'old-exam' THEN 'old' WHEN 'source-exam' THEN 'origin' ELSE 'current' END;
    INSERT INTO "Grade" (id,"studentId","examId",status,score,"updatedAt") VALUES
     ('g-old','s','old-exam','غائب',NULL,CURRENT_TIMESTAMP),
     ('g-source','s','source-exam','درجة',14,CURRENT_TIMESTAMP),
     ('g-current','s','current-exam','غائب',NULL,CURRENT_TIMESTAMP),
     ('g-u','u','source-exam','درجة',45,CURRENT_TIMESTAMP);
    INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,"chapterId") VALUES
     ('bad-old','s','old-exam','خصم تلقائي',1,'تلقائي: غياب في امتحان قديم',NULL),
     ('bad-dismissal','s','source-exam','فصل تلقائي',0,'تلقائي: مخالفة بعد انتهاء الفرص: current-title',NULL),
     ('current-valid','s','current-exam','خصم تلقائي',2,'تلقائي: غياب في امتحان حالي','current'),
     ('manual','s',NULL,'إضافة',1,'إضافة يدوية','origin'),
     ('valid-history','s','source-exam','خصم تلقائي',1,'تلقائي: خصم تاريخي صحيح','origin'),
     ('other-log','u','source-exam','خصم تلقائي',1,'تلقائي: خصم تاريخي صحيح','origin');
    INSERT INTO "GradeSmartNote" (id,category,status,"examId","studentId",score,reason,"updatedAt") VALUES
     ('pending','DISMISSED_PENDING','PENDING','source-exam','s',35,'pending review',CURRENT_TIMESTAMP);
    INSERT INTO "StudentLeave" (id,"studentId","leaveType",reason,"dateFrom","dateTo")
     VALUES ('leave','s','period','saved leave','2026-08-01','2026-08-02');
    INSERT INTO "StudentNote" (id,"studentId",kind,text) VALUES ('note','s','ملاحظة','preserved note');
    INSERT INTO "AuditLog" (id,module,action,details) VALUES
     ('prior','الفرص','تصحيح أثر امتحان من فصل سابق',jsonb_build_object(
       'repairId','chapter_scope_20260910_v2','studentId','s',
       'before',jsonb_build_object('status','مفصول','opportunities',0,'dismissalReason','مخالفة بعد انتهاء الفرص: former-title'),
       'after',jsonb_build_object('status','نشط','opportunities',0,'dismissalReason',''),
       'removedLogs',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('chapterId','origin') ORDER BY id) FROM "OpportunityLog" l WHERE id IN ('bad-old','bad-dismissal'))
     )::text);
    CREATE TEMP TABLE retained_dismissal_repair_plan(payload jsonb);
  `);
  const futureGuard = 'prisma/migrations/20260917180000_guard_automatic_log_chapter/migration.sql';
  if (fs.existsSync(futureGuard)) await db.exec(fs.readFileSync(futureGuard, 'utf8'));
  const hash = async (table, condition = '', params = []) =>
    (await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY t.id),'')) hash FROM "${table}" t${condition}`, params)).rows[0].hash;
  const makePlan = async () => {
    const student = (await db.query(`SELECT to_jsonb(s) row,md5(to_jsonb(s)::text) hash FROM "Student" s WHERE id='s'`)).rows[0];
    const expected = { Student: [{ id: 's', _rowHash: student.hash }] };
    for (const table of childTables) expected[table] = [{ studentId: 's', hash: await hash(table, ' WHERE t."studentId"=$1', ['s']) }];
    for (const table of metadataTables) expected[table] = await hash(table);
    const priorHash = (await db.query(`SELECT md5(to_jsonb(a)::text) hash FROM "AuditLog" a WHERE id='prior'`)).rows[0].hash;
    return {
      repairId: runId, expected,
      items: [{ studentId: 's', chapterId: 'current',
        before: { status: student.row.status, opportunities: student.row.opportunities, dismissalReason: student.row.dismissalReason },
        after: { status: 'نشط', opportunities: 1, dismissalReason: '' },
        removeLogIds: ['bad-old', 'bad-dismissal'], insertLogs: [],
        evidence: { sourceDismissalLogId: 'bad-dismissal', sourceExamId: 'source-exam', sourceChapterId: 'origin',
          priorCorrectionAuditId: 'prior', priorCorrectionAuditHash: priorHash,
          originalChapterReplay: { status: 'نشط', opportunities: 0 }, currentChapterReplay: { status: 'نشط', opportunities: 1 } },
      }],
    };
  };
  const apply = async (plan, setup = '', commit = false) => {
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      if (setup) await db.exec(setup);
      await db.exec('DELETE FROM retained_dismissal_repair_plan');
      await db.query('INSERT INTO retained_dismissal_repair_plan VALUES ($1::jsonb)', [JSON.stringify(plan)]);
      await db.exec(contract);
      await db.exec(commit ? 'COMMIT' : 'ROLLBACK');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  };
  const plan = await makePlan();
  const originalHashes = {};
  for (const table of ['Student', 'Grade', 'GradeSmartNote', 'StudentLeave', 'StudentNote', 'OpportunityLog', ...metadataTables]) originalHashes[table] = await hash(table);

  await assert.rejects(apply(plan, `UPDATE "Student" SET phone='changed' WHERE id='s'`), /Stale repair snapshot: Student/);
  const mutations = {
    Grade: `UPDATE "Grade" SET score=15 WHERE id='g-source'`,
    OpportunityLog: `UPDATE "OpportunityLog" SET reason='manual changed' WHERE id='manual'`,
    StudentLeave: `UPDATE "StudentLeave" SET reason='changed' WHERE id='leave'`,
    StudentNote: `UPDATE "StudentNote" SET text='changed' WHERE id='note'`,
    GradeSmartNote: `UPDATE "GradeSmartNote" SET score=36 WHERE id='pending'`,
    Exam: `UPDATE "Exam" SET name='changed' WHERE id='source-exam'`,
    ExamCourse: `UPDATE "ExamCourse" SET "chapterSource"='changed' WHERE "examId"='source-exam'`,
    CourseChapter: `UPDATE "CourseChapter" SET archive='[{}]' WHERE id='cc'`,
    Chapter: `UPDATE "Chapter" SET opportunities=4 WHERE id='current'`,
  };
  for (const [table, sql] of Object.entries(mutations)) await assert.rejects(apply(plan, sql), new RegExp(`Stale repair snapshot: ${table}`));
  const invalid = (mutate) => { const copy = structuredClone(plan); mutate(copy); return copy; };
  await assert.rejects(apply(invalid(p => { p.items[0].after.opportunities = -1; })), /cannot reduce balances/);
  await assert.rejects(apply(invalid(p => { p.items[0].after.opportunities = 4; })), /cannot reduce balances/);
  await assert.rejects(apply(invalid(p => { p.items[0].after.status = 'مفصول'; })), /reviewed restoration/);
  await assert.rejects(apply(invalid(p => { p.items.push(structuredClone(p.items[0])); })), /duplicate repair targets/);
  await assert.rejects(apply(invalid(p => { p.expected.Grade = []; })), /fingerprints for Grade/);
  await assert.rejects(apply(invalid(p => { p.items[0].evidence.sourceDismissalLogId = 'manual'; })), /exact automatic dismissal/);
  await assert.rejects(apply(invalid(p => { p.items[0].evidence.originalChapterReplay.status = 'مفصول'; })), /original\/current chapter replay/);
  await assert.rejects(apply(invalid(p => { p.items[0].evidence.currentChapterReplay.opportunities = 2; })), /original\/current chapter replay/);
  await assert.rejects(apply(invalid(p => { p.items[0].evidence.priorCorrectionAuditId = 'missing'; })), /durable prior correction/);
  await assert.rejects(apply(plan, `UPDATE "AuditLog" SET action='changed' WHERE id='prior'`), /durable prior correction/);
  await assert.rejects(apply(invalid(p => { p.items[0].removeLogIds.push('manual'); })), /manual, unrelated/);
  await assert.rejects(apply(invalid(p => { p.items[0].removeLogIds.push('valid-history'); })), /unproven historical/);
  await assert.rejects(apply(invalid(p => { p.items[0].removeLogIds.push('other-log'); })), /unrelated/);
  await assert.rejects(apply(invalid(p => { p.items[0].removeLogIds = ['bad-old']; })), /stale dismissal must be removed/);
  const badInsert = { id: 'replacement', studentId: 's', examId: 'old-exam', action: 'خصم تلقائي', amount: 1, reason: 'تلقائي: غياب', date: '2026-07-18T00:00:00.000Z', chapterId: 'current', chapterNameSnapshot: 'current' };
  await assert.rejects(apply(invalid(p => { p.items[0].insertLogs = [badInsert]; })), /valid automatic deduction/);
  await assert.rejects(apply(invalid(p => { p.items[0].insertLogs = [{ ...badInsert, examId: 'current-exam', chapterId: null }]; })), /valid automatic deduction/);
  await assert.rejects(apply(invalid(p => { p.items[0].insertLogs = [{ ...badInsert, examId: 'current-exam', action: 'رصيد إعادة التفعيل' }]; })), /valid automatic deduction/);
  // Even an unexpected trigger cannot silently alter another student or a pending grade.
  await assert.rejects(apply(plan, `CREATE FUNCTION sabotage_student() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='s' THEN UPDATE "Student" SET opportunities=1 WHERE id='u'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER sabotage AFTER UPDATE ON "Student" FOR EACH ROW EXECUTE FUNCTION sabotage_student();`), /protected table, unrelated student/);
  await assert.rejects(apply(plan, `CREATE FUNCTION sabotage_smart_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='s' THEN UPDATE "GradeSmartNote" SET status='PROCESSED' WHERE id='pending'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER sabotage AFTER UPDATE ON "Student" FOR EACH ROW EXECUTE FUNCTION sabotage_smart_note();`), /protected table, unrelated student/);
  for (const [table, fingerprint] of Object.entries(originalHashes)) assert.equal(await hash(table), fingerprint, `${table}: every failed repair rolled back`);

  // A legitimate replacement is permitted only for the current chapter and
  // cannot silently overwrite an existing preserved log with the same ID.
  const replaceCurrent = invalid(p => {
    p.items[0].removeLogIds.push('current-valid');
    p.items[0].insertLogs = [{ ...badInsert, id: 'current-valid', examId: 'current-exam', amount: 2, date: '2026-09-12T00:00:00.000Z' }];
  });
  await apply(replaceCurrent);
  await assert.rejects(apply(invalid(p => { p.items[0].insertLogs = [{ ...badInsert, id: 'current-valid', examId: 'current-exam' }]; })), /valid automatic deduction/);

  const withFixture = async (setup, test) => {
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await db.exec(setup);
      const fixturePlan = await makePlan();
      const attempt = async (value, verify = async () => {}) => {
        await db.exec('SAVEPOINT fixture_attempt');
        try {
          await db.exec('DELETE FROM retained_dismissal_repair_plan');
          await db.query('INSERT INTO retained_dismissal_repair_plan VALUES ($1::jsonb)', [JSON.stringify(value)]);
          await db.exec(contract);
          await verify();
        } finally { await db.exec('ROLLBACK TO SAVEPOINT fixture_attempt'); }
      };
      await test(fixturePlan, attempt);
    } finally { await db.exec('ROLLBACK'); }
  };
  const originArchive = { date: '2026-09-13', studentId: 's', opportunities: 2 };
  await withFixture(`INSERT INTO "CourseChapter" (id,"courseId","chapterId",active,archive)
    VALUES ('origin-link','course','origin',false,'${JSON.stringify([originArchive])}');`, async (review, attempt) => {
    Object.assign(review.items[0], { repeatedReplayStable: true, ordinaryReplayStable: true, removeLogIds: ['bad-dismissal'] });
    Object.assign(review.items[0].evidence, { kind: 'verified-historical-replay', originArchiveCourseChapterId: 'origin-link',
      originArchiveEntry: originArchive, transitionDate: '2026-09-13', originalChapterReplay: { status: 'نشط', opportunities: 2 } });
    await attempt(review);
    const missingArchive = structuredClone(review); delete missingArchive.items[0].evidence.originArchiveEntry;
    await assert.rejects(attempt(missingArchive), /positive transition archive/);
    const zeroBalance = structuredClone(review); zeroBalance.items[0].evidence.originArchiveEntry.opportunities = 0;
    await assert.rejects(attempt(zeroBalance), /positive transition archive/);
    const unstable = structuredClone(review); unstable.items[0].ordinaryReplayStable = false;
    await assert.rejects(attempt(unstable), /positive transition archive/);
    const unprovenOldRemoval = structuredClone(review); unprovenOldRemoval.items[0].removeLogIds.push('bad-old');
    await assert.rejects(attempt(unprovenOldRemoval), /unproven historical effect/);
  });
  const emptyOriginArchive = { ...originArchive, opportunities: 0 };
  const transitionReason = 'تسوية تاريخية: تحويل فصل يدوي؛ تجاهل آثار امتحانات الفصل السابق وبدء رصيد جديد من الفصل النشط الجديد';
  const transitionFixture = `INSERT INTO "CourseChapter" (id,"courseId","chapterId",active,archive)
    VALUES ('origin-link','course','origin',false,'${JSON.stringify([emptyOriginArchive])}');
    UPDATE "Student" SET "createdAt"='2026-06-17' WHERE id='s';
    INSERT INTO "OpportunityLog" (id,"studentId",action,amount,reason,date,"chapterId","ledgerVersion","balanceAfter","settledGradeIds")
    VALUES ('source-transition','u','إعادة تعيين',3,'${transitionReason}','2026-09-13T13:22:45.012','current',2,3,'["g-u"]');`;
  const addCheckpointProof = async review => {
    Object.assign(review.items[0], { originChapterId: 'origin', repeatedReplayStable: true, ordinaryReplayStable: true, removeLogIds: ['bad-dismissal'] });
    Object.assign(review.items[0].evidence, { kind: 'missing-chapter-transition', originArchiveCourseChapterId: 'origin-link',
      originArchiveEntry: emptyOriginArchive, sourceTransitionLogId: 'source-transition',
      sourceTransitionLogHash: (await db.query(`SELECT md5(to_jsonb(l)::text) hash FROM "OpportunityLog" l WHERE id='source-transition'`)).rows[0].hash });
    review.items[0].balanceCheckpoint = { id: `${runId}_checkpoint_s`, studentId: 's', examId: null, chapterId: 'current',
      action: 'إعادة تعيين', amount: 3, balanceAfter: 3, ledgerVersion: 2, date: '2026-09-13T13:22:45.012', reason: transitionReason,
      settledGradeIds: '[]', chapterNameSnapshot: 'current' };
  };
  await withFixture(transitionFixture, async (review, attempt) => {
    await addCheckpointProof(review);
    await attempt(review, async () => {
      assert.equal((await db.query(`SELECT amount FROM "OpportunityLog" WHERE id='current-valid'`)).rows[0].amount, 2, 'current grade deduction survives opening checkpoint');
      assert.equal((await db.query(`SELECT opportunities FROM "Student" WHERE id='s'`)).rows[0].opportunities, 1);
      const checkpoint = (await db.query(`SELECT "settledGradeIds", "balanceAfter" FROM "OpportunityLog" WHERE id=$1`, [`${runId}_checkpoint_s`])).rows[0];
      assert.deepEqual(checkpoint, { settledGradeIds: '[]', balanceAfter: 3 }, 'checkpoint never settles a grade');
    });
    for (const [field, value] of [['settledGradeIds', '["g-current"]'], ['date', '2026-09-17T00:00:00'], ['amount', 2], ['action', 'رصيد إعادة التفعيل']]) {
      const invalidCheckpoint = structuredClone(review); invalidCheckpoint.items[0].balanceCheckpoint[field] = value;
      await assert.rejects(attempt(invalidCheckpoint), /exact course opening checkpoint/);
    }
    const missingSourceHash = structuredClone(review); delete missingSourceHash.items[0].evidence.sourceTransitionLogHash;
    await assert.rejects(attempt(missingSourceHash), /exact course opening checkpoint/);
    const unexpectedCheckpoint = structuredClone(review); unexpectedCheckpoint.items[0].evidence.kind = 'verified-historical-replay';
    await assert.rejects(attempt(unexpectedCheckpoint), /Only a proven missing chapter transition/);
  });
  await withFixture(transitionFixture + `INSERT INTO "OpportunityLog" (id,"studentId",action,amount,reason,"chapterId","ledgerVersion","balanceAfter","settledGradeIds")
    VALUES ('existing-checkpoint','s','إعادة تعيين',3,'already processed','current',2,3,'[]');`, async (review, attempt) => {
    await addCheckpointProof(review);
    await assert.rejects(attempt(review), /exact course opening checkpoint/);
  });
  await withFixture(transitionFixture + `INSERT INTO "StudentNote" (id,"studentId",kind,text) VALUES ('manual-dismissal','s','إجراء','فصل الطالب بسبب إجراء يدوي');`, async (review, attempt) => {
    await addCheckpointProof(review);
    await assert.rejects(attempt(review), /exact course opening checkpoint/);
  });

  await apply(plan, '', true);
  const student = (await db.query(`SELECT status,opportunities,"dismissalReason","dismissalType" FROM "Student" WHERE id='s'`)).rows[0];
  assert.deepEqual(student, { status: 'نشط', opportunities: 1, dismissalReason: null, dismissalType: null });
  for (const table of ['Grade', 'GradeSmartNote', 'StudentLeave', ...metadataTables]) assert.equal(await hash(table), originalHashes[table], `${table} preserved in full`);
  assert.equal((await db.query(`SELECT opportunities FROM "Student" WHERE id='u'`)).rows[0].opportunities, 2);
  const logs = (await db.query(`SELECT id FROM "OpportunityLog" ORDER BY id`)).rows.map(x => x.id);
  assert.deepEqual(logs, ['current-valid', 'manual', 'other-log', 'valid-history']);
  const audit = JSON.parse((await db.query('SELECT details FROM "AuditLog" WHERE id=$1', [`${runId}_s`])).rows[0].details);
  assert.equal(audit.removedLogs.length, 2);
  assert.equal(audit.studentBefore.status, 'مفصول');
  assert.equal(audit.studentAfter.status, 'نشط');
  assert.equal(audit.studentBefore.opportunities, 0);
  assert.equal(audit.studentAfter.opportunities, 1);
  const note = (await db.query('SELECT * FROM "StudentNote" WHERE id=$1', [`${runId}_note_s`])).rows[0];
  assert.equal(note.sourceType, 'repair');
  assert.equal(note.sourceId, runId);
  assert(!note.text.startsWith('فصل الطالب'));
  await apply(plan, '', true);
  assert.equal((await db.query(`SELECT count(*)::int count FROM "AuditLog" WHERE id LIKE $1`, [`${runId}%`])).rows[0].count, 2);
  assert.equal((await db.query(`SELECT count(*)::int count FROM "StudentNote" WHERE "sourceId"=$1`, [runId])).rows[0].count, 1);
  assert.equal((await db.query(`SELECT opportunities FROM "Student" WHERE id='s'`)).rows[0].opportunities, 1, 'repeat cannot grant anything');
  await db.close();
  console.log('PASS: retained dismissal recovery requires exact prior evidence, aborts stale sources, preserves grades/pending attempts, rolls back side effects, audits restoration, and is idempotent');
})().catch(error => { console.error(error); process.exitCode = 1; });
