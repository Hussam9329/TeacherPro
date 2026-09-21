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

for (const invalid of [null, [], {}, { studentId: "s", checked: "false", expectedChecked: false },
  { studentId: "s", checked: false }, { studentId: "s", checked: true, expectedChecked: 0 }]) {
  assert.throws(() => parse(invalid), (error) => error.status === 400);
}
assert.deepEqual(parse({ studentId: " s ", checked: false, expectedChecked: true, opportunities: 99 }), {
  studentId: "s", checked: false, expectedChecked: true,
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
        const result = await sql.query('UPDATE "Student" SET "dismissedChecked"=$1 WHERE id=$2 AND status=$3 AND "dismissedChecked"=$4 RETURNING id',
          [data.dismissedChecked, where.id, where.status, where.dismissedChecked]);
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
    const mutate = (input, options) => db.transaction((sql) => update(adapter(sql, options), parse(input), actor));
    const read = async () => (await db.query('SELECT * FROM "Student" WHERE id=$1', ["s"])).rows[0];
    const beforeStudent = await read();
    const beforeGrades = (await db.query('SELECT * FROM "Grade"')).rows;
    assert.equal(beforeStudent.dismissedChecked, false, "all existing students start unchecked");

    await mutate({ studentId: "s", checked: true, expectedChecked: false });
    assert.equal((await read()).dismissedChecked, true, "a separate read sees the same shared value");
    assert.equal((await db.query('SELECT count(*)::int n FROM "AuditLog"')).rows[0].n, 1);
    await mutate({ studentId: "s", checked: true, expectedChecked: false });
    assert.equal((await db.query('SELECT count(*)::int n FROM "AuditLog"')).rows[0].n, 1, "duplicate same-value request is idempotent");
    await assert.rejects(mutate({ studentId: "s", checked: false, expectedChecked: false }), (error) => error.status === 409);
    assert.equal((await read()).dismissedChecked, true, "stale request cannot undo another user's choice");
    await db.close();
    db = new PGlite(directory);
    assert.equal((await read()).dismissedChecked, true, "checked survives closing and reopening the database");

    await assert.rejects(mutate({ studentId: "s", checked: false, expectedChecked: true }, { failAudit: true }), /audit failure/);
    assert.equal((await read()).dismissedChecked, true, "audit failure rolls the flag back atomically");
    await assert.rejects(mutate({ studentId: "s", checked: false, expectedChecked: true }, { activateBeforeWrite: true }), (error) => error.status === 409);
    assert.equal((await read()).dismissedChecked, true, "conditional write protects a concurrent status transition");
    for (const studentId of ["active", "archived"]) {
      await assert.rejects(mutate({ studentId, checked: true, expectedChecked: false }), (error) => error.status === 409);
    }
    await assert.rejects(mutate({ studentId: "missing", checked: true, expectedChecked: false }), (error) => error.status === 404);

    await mutate({ studentId: "s", checked: false, expectedChecked: true });
    await db.close();
    db = new PGlite(directory);
    assert.deepEqual(await read(), beforeStudent, "explicit unchecked survives reload without changing academic fields");
    assert.deepEqual((await db.query('SELECT * FROM "Grade"')).rows, beforeGrades, "grades remain untouched");
    const audits = (await db.query('SELECT * FROM "AuditLog" ORDER BY id')).rows;
    assert.equal(audits.length, 2);
    assert.equal(JSON.parse(audits[1].details).after.dismissedChecked, false);

    const route = fs.readFileSync("src/app/api/students/dismissed-check/route.ts", "utf8");
    assert.match(route, /requirePermission\(req, "students.view"\)/);
    assert.match(route, /requirePermissionPrincipal\(req, "students.edit"\)/);
    assert.match(route, /withSerializableTransaction\(\(tx\) => updateDismissedCheck/);
    console.log("PASS: shared true/false persistence, strict input, stale-write safety, status guards, atomic audit, permissions and unchanged academic data");
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
