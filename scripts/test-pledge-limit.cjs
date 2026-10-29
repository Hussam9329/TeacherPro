const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), crypto = require("node:crypto");
const ts = require("typescript");
// Prisma DateTime columns are UTC instants; read PGlite timestamps the same way.
process.env.TZ = "UTC";
const { PGlite } = require("@electric-sql/pglite");
const { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const { Prisma } = require("@prisma/client");
const { NextRequest } = require("next/server");

// «حد التعهدات»: two pledges per chapter, then «إرجاع الطالب» in «إدارة
// المفصولين» is refused on the server. Runs the real status-action route, the
// real pledge summaries and «قائمة التعهدات» on the real migrated schema.
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename, load = Module._load, mocks = new Map();
Module._resolveFilename = function (r, p, ...a) { return resolve.call(this, r.startsWith("@/") ? path.join(root, "src", r.slice(2)) : r, p, ...a); };
Module._load = function (r, p, ...a) { return mocks.has(r) ? mocks.get(r) : load.call(this, r, p, ...a); };
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);

// A Prisma-shaped client over PostgreSQL: rows come from SQL, the where/select
// semantics the code under test uses (AND/OR, in, null, contains, gte/lte,
// relation filters and nested selects) are applied on them.
const models = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name[0].toLowerCase() + m.name.slice(1), m]));
const modelByName = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const keyOf = (name) => name[0].toLowerCase() + name.slice(1);
const bind = (v) => (v instanceof Date ? v.toISOString() : v);
const same = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

function adapter(client) {
  const rowsOf = async (key) => (await client.query(`SELECT * FROM "${models[key].dbName || models[key].name}"`)).rows;
  async function related(model, field, row) {
    const target = keyOf(field.type);
    const [fk] = field.relationFromFields || [];
    if (!fk) return null;
    return (await rowsOf(target)).find((r) => r.id === row[fk]) || null;
  }
  async function matches(model, row, where) {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === "AND") { for (const w of cond) if (!(await matches(model, row, w))) return false; continue; }
      if (key === "OR") { let any = false; for (const w of cond) if (await matches(model, row, w)) { any = true; break; } if (!any) return false; continue; }
      const field = model.fields.find((f) => f.name === key);
      assert.ok(field, `unknown ${model.name}.${key}`);
      if (field.kind === "object") {
        const other = await related(model, field, row);
        if (!other || !(await matches(modelByName[field.type], other, cond.is ?? cond))) return false;
        continue;
      }
      const value = row[key];
      if (cond === null) { if (value !== null) return false; continue; }
      if (typeof cond === "object" && !(cond instanceof Date)) {
        if ("in" in cond && !cond.in.some((v) => same(v, value))) return false;
        if ("not" in cond && same(cond.not, value)) return false;
        if ("equals" in cond && !same(cond.equals, value)) return false;
        if ("contains" in cond) {
          const hay = String(value ?? ""), needle = String(cond.contains);
          if (!(cond.mode === "insensitive" ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle))) return false;
        }
        if ("startsWith" in cond && !String(value ?? "").startsWith(cond.startsWith)) return false;
        if ("gte" in cond && !(value >= cond.gte)) return false;
        if ("lte" in cond && !(value <= cond.lte)) return false;
        continue;
      }
      if (!same(value, cond)) return false;
    }
    return true;
  }
  async function project(model, row, select) {
    if (!select) return row;
    const out = {};
    for (const [key, spec] of Object.entries(select)) {
      if (!spec) continue;
      const field = model.fields.find((f) => f.name === key);
      assert.ok(field, `unknown select ${model.name}.${key}`);
      if (field.kind === "object") {
        const other = await related(model, field, row);
        out[key] = other ? await project(modelByName[field.type], other, spec.select) : null;
      } else out[key] = row[key];
    }
    return out;
  }
  const db = {};
  for (const [key, model] of Object.entries(models)) {
    const table = `"${model.dbName || model.name}"`;
    const findMany = async (args = {}) => {
      let rows = [];
      for (const row of await rowsOf(key)) if (await matches(model, row, args.where)) rows.push(row);
      for (const order of [].concat(args.orderBy || []).reverse()) {
        const [[field, dir]] = Object.entries(order);
        rows = [...rows].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (dir === "desc" ? -1 : 1));
      }
      if (args.take) rows = rows.slice(0, args.take);
      return Promise.all(rows.map((row) => project(model, row, args.select)));
    };
    const insert = async (data) => {
      const row = { id: crypto.randomUUID(), ...data };
      const keys = Object.keys(row);
      for (const k of keys) assert.ok(model.fields.some((f) => f.name === k && f.kind !== "object"), `unknown ${key}.${k}`);
      if (model.fields.some((f) => f.name === "updatedAt" && f.isUpdatedAt) && !row.updatedAt) { row.updatedAt = new Date(); keys.push("updatedAt"); }
      const result = await client.query(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, keys.map((k) => bind(row[k])));
      return result.rows[0];
    };
    db[key] = {
      findMany,
      findFirst: async (args = {}) => (await findMany({ ...args, take: 1 }))[0] || null,
      findUnique: async (args) => (await findMany(args))[0] || null,
      findUniqueOrThrow: async (args) => { const row = (await findMany(args))[0]; if (!row) throw Object.assign(new Error("not found"), { code: "P2025" }); return row; },
      count: async (args = {}) => (await findMany({ where: args.where })).length,
      create: async ({ data }) => insert(data),
      update: async ({ where, data }) => {
        const keys = Object.keys(data);
        const result = await client.query(`UPDATE ${table} SET ${keys.map((k, i) => `"${k}"=$${i + 1}`).join(",")} WHERE id=$${keys.length + 1} RETURNING *`, [...keys.map((k) => bind(data[k])), where.id]);
        if (!result.rows[0]) throw Object.assign(new Error("not found"), { code: "P2025" });
        return result.rows[0];
      },
    };
  }
  return db;
}

const principal = { id: "u1", name: "مسؤول الفرص", isAdmin: true, permissions: [] };
const writes = { migratedPendingGrades: 0 };

(async () => {
  const pg = new PGlite({ extensions: { pg_trgm } });
  for (const dir of fs.readdirSync(path.join(root, "prisma/migrations")).sort()) {
    const file = path.join(root, "prisma/migrations", dir, "migration.sql");
    if (fs.existsSync(file)) await pg.exec(fs.readFileSync(file, "utf8"));
  }
  const db = adapter(pg);
  mocks.set("@/lib/db", { db });
  mocks.set("@/lib/server-auth", { requirePermissionPrincipal: async () => principal });
  mocks.set("@/lib/grace-periods-server", { studentsWithGracePeriodsForResponse: async (rows) => rows });
  mocks.set("@/lib/student-opportunity-snapshot-server", { attachStudentOpportunitySnapshots: async (rows) => rows });
  mocks.set("@/lib/academic-recalculate-server", { recalculateStudentsAcademicState: async () => ({ automaticOpportunityLogs: [] }) });
  mocks.set("@/lib/grade-smart-note-reactivation-server", { migrateDismissedPendingGradesAfterActivation: async () => { writes.migratedPendingGrades++; return null; } });
  mocks.set("@/lib/serializable-transaction", { withSerializableTransaction: (run) => pg.transaction((tx) => run(adapter(tx))) });

  const { POST } = require(path.join(root, "src/app/api/students/status-action/route.ts"));
  const { attachStudentPledgeSummaries, loadPledgeList } = require(path.join(root, "src/lib/pledge-limit-server.ts"));
  const { PLEDGE_BALANCE_REASON, PLEDGE_LIMIT_REACHED_REASON, isPledgeOpportunityLog } = require(path.join(root, "src/lib/pledge-limit.ts"));

  // One course: the first chapter is over, the second is active.
  await pg.exec(`
    INSERT INTO "Course" (id,name) VALUES ('c','الدورة الصيفية');
    INSERT INTO "Chapter" (id,name,opportunities) VALUES ('ch1','الفصل الأول',3),('ch2','الفصل الثاني',3);
    INSERT INTO "CourseChapter" (id,"courseId","chapterId",active,archived) VALUES ('l1','c','ch1',false,true),('l2','c','ch2',true,false);
    INSERT INTO "AppUser" (id,username,name,role,permissions,active,"passwordHash") VALUES ('u1','opp','مسؤول الفرص','admin','[]',true,'test-only');
  `);
  const student = (id, status) => pg.query(`INSERT INTO "Student" (id,name,gender,code,"courseId",status,opportunities,"baseOpportunities") VALUES ($1,$1,'ذكر',$2,'c',$3,0,3)`, [id, `BIO-${id}`, status]);
  const pledgeRow = (studentId, chapterId, date, overrides = {}) => db.opportunityLog.create({
    data: { studentId, chapterId, date: new Date(date), action: "رصيد إعادة التفعيل", amount: 2, ledgerVersion: 2, reason: PLEDGE_BALANCE_REASON, ...overrides },
  });
  const reactivate = async (studentId, extra = {}) => {
    const res = await POST(new NextRequest("http://localhost/api/students/status-action", {
      method: "POST", body: JSON.stringify({ action: "reactivate", studentId, reactivationMode: "pledge", ...extra }),
    }));
    return { status: res.status, body: await res.json() };
  };
  const dismiss = (studentId) => POST(new NextRequest("http://localhost/api/students/status-action", {
    method: "POST", body: JSON.stringify({ action: "dismiss", studentId, reason: "غياب" }),
  }));
  const countRows = async (table, studentId) => Number((await pg.query(`SELECT count(*) AS n FROM "${table}" WHERE "studentId"=$1`, [studentId])).rows[0].n);

  // Which ledger rows are pledges.
  assert.equal(isPledgeOpportunityLog({ action: "رصيد بعد تعهد", reason: "قديم" }), true, "pledges before 2026-08-28");
  assert.equal(isPledgeOpportunityLog({ action: "رصيد إعادة التفعيل", reason: PLEDGE_BALANCE_REASON, requestedAmount: null }), true);
  assert.equal(isPledgeOpportunityLog({ action: "رصيد إعادة التفعيل", reason: "إرجاع الطالب إلى الحالة النشطة برصيد فرصتين" }), true, "the renamed pledge return");
  assert.equal(isPledgeOpportunityLog({ action: "رصيد إعادة التفعيل", reason: PLEDGE_BALANCE_REASON, requestedAmount: 2 }), false, "a return with chosen opportunities");
  assert.equal(isPledgeOpportunityLog({ action: "رصيد إعادة التفعيل", reason: "تسوية السياسة الحالية: رصيد فرصتين" }), false);
  console.log("PASS: a pledge is the two-opportunity pledge return, old or new; a return with chosen opportunities is not");

  // Three pledges in this chapter (like غنى and حارث): both ways of «إرجاع الطالب» are refused, nothing is written.
  await student("ghina", "مفصول");
  for (const date of ["2026-09-25T09:00:00Z", "2026-10-11T09:00:00Z", "2026-10-28T09:00:00Z"]) await pledgeRow("ghina", "ch2", date);
  const before = await countRows("OpportunityLog", "ghina");
  let res = await reactivate("ghina");
  assert.equal(res.status, 409);
  assert.ok(res.body.error.startsWith(PLEDGE_LIMIT_REACHED_REASON), res.body.error);
  res = await reactivate("ghina", { reactivationMode: "manual", amount: 1, reason: "قرار الإدارة" });
  assert.equal(res.status, 409, "a return with chosen opportunities is closed too");
  assert.equal((await pg.query(`SELECT status FROM "Student" WHERE id='ghina'`)).rows[0].status, "مفصول");
  assert.equal(await countRows("OpportunityLog", "ghina"), before);
  assert.equal(await countRows("StudentNote", "ghina"), 0);
  console.log("PASS: after the limit both ways of «إرجاع الطالب» are refused with «نفاد عدد التعهدات للفصل الواحد» and nothing is written");

  // A pledge in the previous chapter does not count; the second one in this chapter closes the return.
  await student("faris", "مفصول");
  await pledgeRow("faris", "ch1", "2026-07-13T09:00:00Z", { action: "رصيد بعد تعهد", reason: "تسوية السياسة الحالية: رصيد فرصتين بعد تعهد ولي الأمر" });
  await pledgeRow("faris", "ch2", "2026-10-01T09:00:00Z");
  // A return with chosen opportunities in this chapter is not a pledge.
  await pledgeRow("faris", "ch2", "2026-10-05T09:00:00Z", { requestedAmount: 2, reason: PLEDGE_BALANCE_REASON });
  res = await reactivate("faris");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.student.status, "نشط");
  assert.equal(res.body.student.opportunities, 2);
  assert.equal((await dismiss("faris")).status, 200);
  res = await reactivate("faris");
  assert.equal(res.status, 409);
  assert.ok(res.body.error.includes("وقّع 2 تعهدات في «الفصل الثاني»"), res.body.error);
  console.log("PASS: the limit counts this chapter only; the second pledge closes the next return");

  // A new chapter starts the count again.
  await pg.exec(`UPDATE "CourseChapter" SET active=false, archived=true WHERE id='l2';
    INSERT INTO "Chapter" (id,name,opportunities) VALUES ('ch3','الفصل الثالث',3);
    INSERT INTO "CourseChapter" (id,"courseId","chapterId",active,archived) VALUES ('l3','c','ch3',true,false);`);
  res = await reactivate("faris");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await pg.exec(`UPDATE "CourseChapter" SET active=false, archived=true WHERE id='l3'; UPDATE "CourseChapter" SET active=true, archived=false WHERE id='l2';`);
  console.log("PASS: a new chapter starts the pledge count again");

  // Cards: his pledges in the active chapter, oldest first.
  const [ghina, faris] = await attachStudentPledgeSummaries(db, [
    { id: "ghina", activeChapter: { id: "ch2", name: "الفصل الثاني" } },
    { id: "faris", activeChapter: { id: "ch2", name: "الفصل الثاني" } },
  ]);
  assert.deepEqual(ghina.pledges, {
    chapterId: "ch2", chapterName: "الفصل الثاني", count: 3, limit: 2, limitReached: true,
    dates: ["2026-09-25T09:00:00.000Z", "2026-10-11T09:00:00.000Z", "2026-10-28T09:00:00.000Z"],
  });
  assert.equal(faris.pledges.count, 2);
  assert.equal(faris.pledges.limitReached, true);
  const [none] = await attachStudentPledgeSummaries(db, [{ id: "faris", activeChapter: null }]);
  assert.equal(none.pledges.count, 0, "no active chapter, nothing to count");
  console.log("PASS: cards get the count and dates of the active chapter");

  // «قائمة التعهدات».
  const base = { courseIds: [], chapterScope: "active", count: "", status: "", q: "", sort: "count" };
  let rows = await loadPledgeList(db, base);
  assert.deepEqual(rows.map((r) => [r.studentId, r.chapterId, r.count, r.limitReached]), [["ghina", "ch2", 3, true], ["faris", "ch2", 2, true]]);
  const route = rows.find((r) => r.studentId === "faris").pledges.at(-1);
  assert.equal(route.recordedBy, "مسؤول الفرص", "the pledge recorded through the route names who recorded it");
  assert.equal(rows[0].pledges[0].recordedBy, "", "a pledge without an audit row has no recorder");
  rows = await loadPledgeList(db, { ...base, chapterScope: "all" });
  assert.deepEqual(rows.map((r) => `${r.studentId}:${r.chapterId}:${r.count}`).sort(), ["faris:ch1:1", "faris:ch2:2", "faris:ch3:1", "ghina:ch2:3"]);
  assert.equal(rows.find((r) => r.chapterId === "ch1").isActiveChapter, false);
  rows = await loadPledgeList(db, { ...base, chapterScope: "all", count: "1" });
  assert.deepEqual(rows.map((r) => r.chapterId).sort(), ["ch1", "ch3"]);
  rows = await loadPledgeList(db, { ...base, count: "2" });
  assert.deepEqual(rows.map((r) => r.studentId), ["faris"]);
  rows = await loadPledgeList(db, { ...base, status: "active" });
  assert.deepEqual(rows.map((r) => r.studentId), ["faris"], "status filter reads the current status");
  rows = await loadPledgeList(db, { ...base, q: "bio-ghina" });
  assert.deepEqual(rows.map((r) => r.studentId), ["ghina"], "search by code ignores case");
  rows = await loadPledgeList(db, { ...base, sort: "last" });
  assert.deepEqual(rows.map((r) => r.studentId), ["faris", "ghina"], "latest pledge first");
  rows = await loadPledgeList(db, { ...base, courseIds: ["other"] });
  assert.equal(rows.length, 0);
  console.log("PASS: «قائمة التعهدات» groups per student and chapter, filters, sorts and names who recorded each pledge");

  await pg.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
