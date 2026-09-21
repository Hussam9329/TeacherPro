const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");

const source = fs.readFileSync("src/lib/dismissed-check-server.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled)(loaded, loaded.exports, require);
const { parseDismissedCheckInput: parse, updateDismissedCheck: update } = loaded.exports;
const actor = { id: "operator-a", name: "Operator A" };
const migration = fs.readFileSync("prisma/migrations/20260921190000_dismissed_check_lifecycle/migration.sql", "utf8");

for (const invalid of [null, [], {}, { studentId: "s", checked: "false", expectedChecked: false },
  { studentId: "s", checked: false }, { studentId: "s", checked: true, expectedChecked: 0 },
  ...[-1, 0.5, "0", null, Number.MAX_SAFE_INTEGER + 1].map(expectedEpoch => ({ studentId: "s", checked: true, expectedChecked: false, expectedEpoch }))]) {
  assert.throws(() => parse(invalid), (error) => error.status === 400);
}
assert.throws(() => parse({ studentId: "s", checked: true, expectedChecked: false }), error => error.status === 409, "old clients must refresh rather than write without an episode version");
assert.deepEqual(parse({ studentId: " s ", checked: false, expectedChecked: true, expectedEpoch: 0, opportunities: 99 }), {
  studentId: "s", checked: false, expectedChecked: true, expectedEpoch: 0,
});

function adapter(sql, options = {}) {
  return {
    student: {
      findUnique: async ({ where }) => (await sql.query('SELECT * FROM "Student" WHERE id=$1', [where.id])).rows[0] || null,
      updateMany: async ({ where, data }) => {
        assert.deepEqual(Object.keys(data), ["dismissedChecked"], "only the flag can be written");
        if (options.activateBeforeWrite) {
          await sql.query('UPDATE "Student" SET status=$1 WHERE id=$2', ["نشط", where.id]);
        }
        if (options.cycleBeforeWrite) {
          await sql.query('UPDATE "Student" SET status=$1 WHERE id=$2', ["نشط", where.id]);
          await sql.query('UPDATE "Student" SET status=$1 WHERE id=$2', ["مفصول", where.id]);
        }
        const result = await sql.query('UPDATE "Student" SET "dismissedChecked"=$1 WHERE id=$2 AND status=$3 AND "dismissedChecked"=$4 AND "dismissedCheckEpoch"=$5 RETURNING id',
          [data.dismissedChecked, where.id, where.status, where.dismissedChecked, where.dismissedCheckEpoch]);
        return { count: result.rows.length };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        if (options.failAudit) throw new Error("audit failure");
        await sql.query('INSERT INTO "AuditLog" ("userId", details) VALUES ($1,$2)', [data.userId, data.details]);
        return data;
      },
    },
  };
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "teacherpro-shared-check-test-"));
  let db = new PGlite(directory);
  try {
    await db.exec(`CREATE TABLE "Student" (id text PRIMARY KEY, name text NOT NULL, code text NOT NULL,
      status text NOT NULL, opportunities integer NOT NULL, "dismissedChecked" boolean NOT NULL DEFAULT false);
      CREATE TABLE "Grade" (id text PRIMARY KEY, "studentId" text, score integer);
      CREATE TABLE "AuditLog" (id serial PRIMARY KEY, "userId" text, details text);
      INSERT INTO "Student" (id,name,code,status,opportunities) VALUES
        ('s','Student','TEST-1','مفصول',0), ('active','Active','TEST-2','نشط',2), ('archived','Archived','TEST-3','مؤرشف',0);
      INSERT INTO "Grade" VALUES ('g','s',35);`);
    await db.exec(migration);
    const mutate = (input, options) => db.transaction((sql) => update(adapter(sql, options), parse(input), actor));
    const read = async () => (await db.query('SELECT * FROM "Student" WHERE id=$1', ["s"])).rows[0];
    const beforeStudent = await read();
    const beforeGrades = (await db.query('SELECT * FROM "Grade"')).rows;
    assert.equal(beforeStudent.dismissedChecked, false, "all existing students start unchecked");

    await mutate({ studentId: "s", checked: true, expectedChecked: false, expectedEpoch: 0 });
    assert.equal((await read()).dismissedChecked, true, "a separate read sees the same shared value");
    assert.equal((await db.query('SELECT count(*)::int n FROM "AuditLog"')).rows[0].n, 1);
    await mutate({ studentId: "s", checked: true, expectedChecked: false, expectedEpoch: 0 });
    assert.equal((await db.query('SELECT count(*)::int n FROM "AuditLog"')).rows[0].n, 1, "duplicate same-value request is idempotent");
    await assert.rejects(mutate({ studentId: "s", checked: false, expectedChecked: false, expectedEpoch: 0 }), (error) => error.status === 409);
    assert.equal((await read()).dismissedChecked, true, "stale request cannot undo another user's choice");
    await db.close();
    db = new PGlite(directory);
    assert.equal((await read()).dismissedChecked, true, "checked survives closing and reopening the database");

    await assert.rejects(mutate({ studentId: "s", checked: false, expectedChecked: true, expectedEpoch: 0 }, { failAudit: true }), /audit failure/);
    assert.equal((await read()).dismissedChecked, true, "audit failure rolls the flag back atomically");
    await assert.rejects(mutate({ studentId: "s", checked: false, expectedChecked: true, expectedEpoch: 0 }, { activateBeforeWrite: true }), (error) => error.status === 409);
    assert.equal((await read()).dismissedChecked, true, "conditional write protects a concurrent status transition");
    for (const studentId of ["active", "archived"]) {
      await assert.rejects(mutate({ studentId, checked: true, expectedChecked: false, expectedEpoch: 0 }), (error) => error.status === 409);
    }
    await assert.rejects(mutate({ studentId: "missing", checked: true, expectedChecked: false, expectedEpoch: 0 }), (error) => error.status === 404);

    await mutate({ studentId: "s", checked: false, expectedChecked: true, expectedEpoch: 0 });
    await db.close();
    db = new PGlite(directory);
    assert.deepEqual(await read(), beforeStudent, "explicit unchecked survives reload without changing academic fields");
    assert.deepEqual((await db.query('SELECT * FROM "Grade"')).rows, beforeGrades, "grades remain untouched");
    const audits = (await db.query('SELECT * FROM "AuditLog" ORDER BY id')).rows;
    assert.equal(audits.length, 2);
    assert.equal(JSON.parse(audits[1].details).after.dismissedChecked, false);

    await assert.rejects(mutate({ studentId: "s", checked: true, expectedChecked: false, expectedEpoch: 0 }, { cycleBeforeWrite: true }), error => error.status === 409,
      "a status cycle interposed between read and CAS cannot resurrect a check despite equal status and flag");
    assert.deepEqual(await read(), beforeStudent, "the conflicting request and audit roll back atomically");
    await mutate({ studentId: "s", checked: true, expectedChecked: false, expectedEpoch: 0 });
    const activated = (await db.query('UPDATE "Student" SET status=$1 WHERE id=$2 RETURNING *', ["نشط", "s"])).rows[0];
    assert.equal(activated.dismissedChecked, false, "reactivation removes the persisted check in the same write");
    assert.equal(activated.dismissedCheckEpoch, 1);
    await db.query('UPDATE "Student" SET status=$1 WHERE id=$2', ["مفصول", "s"]);
    assert.equal((await read()).dismissedCheckEpoch, 2);
    assert.equal((await read()).dismissedChecked, false, "a later dismissal starts unchecked");
    for (const checked of [true, false]) {
      await assert.rejects(mutate({ studentId: "s", checked, expectedChecked: false, expectedEpoch: 0 }), error => error.status === 409,
        "prior-episode true and false requests are rejected even when their value already matches");
    }
    await mutate({ studentId: "s", checked: true, expectedChecked: false, expectedEpoch: 2 });
    await assert.rejects(mutate({ studentId: "s", checked: true, expectedChecked: false, expectedEpoch: 0 }), error => error.status === 409,
      "stale already-checked request must be rejected before the same-value early return");
    await mutate({ studentId: "s", checked: false, expectedChecked: true, expectedEpoch: 2 });
    assert.deepEqual((await db.query('SELECT * FROM "Grade"')).rows, beforeGrades);
    const finalStudent = await read();
    assert.deepEqual({ ...finalStudent, dismissedCheckEpoch: 0 }, beforeStudent, "only the episode counter changes after a complete status cycle");

    const route = fs.readFileSync("src/app/api/students/dismissed-check/route.ts", "utf8");
    assert.match(route, /requirePermission\(req, "students.view"\)/);
    assert.match(route, /requirePermissionPrincipal\(req, "students.edit"\)/);
    assert.match(route, /withSerializableTransaction\(\(tx\) => updateDismissedCheck/);
    console.log("PASS: shared check persistence, strict episode input, reactivation reset, repeated-dismissal and CAS race protection, atomic audit, permissions and unchanged academic data");
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
