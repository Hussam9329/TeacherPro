const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");
const { NextRequest, NextResponse } = require("next/server");

const source = fs.readFileSync("src/app/api/students/code-closures/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const historyModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync("src/lib/dismissed-history.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(historyModule, historyModule.exports);

(async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE "Course" (id text PRIMARY KEY, name text NOT NULL);
      CREATE TABLE "Student" (
        id text PRIMARY KEY, name text NOT NULL, code text NOT NULL,
        username text, telegram text,
        status text NOT NULL, "dismissedChecked" boolean NOT NULL,
        "dismissedCheckEpoch" integer NOT NULL, "courseId" text REFERENCES "Course"(id),
        "dismissalReason" text, opportunities integer NOT NULL
      );
      INSERT INTO "Course" VALUES ('course-a','الدورة الأولى'),('course-b','الدورة الثانية');
      INSERT INTO "Student"
      SELECT 'student-' || lpad(i::text, 4, '0'), 'طالب ' || lpad((i / 2)::text, 4, '0'),
        'BIO-' || i,
        CASE WHEN i % 3 = 0 THEN 'student_user_' || i ELSE NULL END,
        CASE WHEN i % 3 = 0 THEN (1000000000 + i)::text WHEN i % 3 = 1 THEN '@telegram_' || i ELSE NULL END,
        'مفصول', i % 3 = 0, i % 4,
        CASE WHEN i % 2 = 0 THEN 'course-a' ELSE 'course-b' END,
        CASE WHEN i % 2 = 0 THEN 'غياب' ELSE NULL END, 0
      FROM generate_series(1, 601) i;
      INSERT INTO "Student" VALUES
        ('active','طالب نشط','ACTIVE',NULL,NULL,'نشط',true,1,'course-a',NULL,2),
        ('archived','طالب مؤرشف','ARCHIVED',NULL,NULL,'مؤرشف',true,0,'course-b',NULL,0);
      CREATE TABLE "OpportunityLog" (
        id text PRIMARY KEY, "studentId" text REFERENCES "Student"(id),
        action text NOT NULL, reason text, date timestamptz NOT NULL
      );
      CREATE TABLE "StudentNote" (
        id text PRIMARY KEY, "studentId" text REFERENCES "Student"(id),
        kind text NOT NULL, text text NOT NULL, "dismissalDate" timestamptz, date timestamptz NOT NULL
      );
      INSERT INTO "OpportunityLog" VALUES
        ('log-1','student-0001','فصل تلقائي','تلقائي: غياب','2026-09-20T12:00:00Z'),
        ('log-3','student-0003','فصل تلقائي','تلقائي: غياب','2026-09-23T12:00:00Z'),
        ('log-3-reactivation','student-0003','إعادة تفعيل','إعادة تفعيل بعد فصل الطالب','2026-09-25T12:00:00Z'),
        ('log-5','student-0005','خصم','فصل الطالب: يدوي','2026-09-24T12:00:00Z'),
        ('log-6','student-0006','إضافة','فصل الطالب: نص في حركة غير فصل','2026-09-25T12:00:00Z');
      INSERT INTO "StudentNote" VALUES
        ('note-1','student-0001','إجراء','فصل الطالب: يدوي','2026-09-21T12:00:00Z','2026-09-24T12:00:00Z'),
        ('note-2','student-0002','إجراء','تم فصل الطالب: يدوي',NULL,'2026-09-22T12:00:00Z'),
        ('note-3-reactivation','student-0003','إجراء','تم تعهد الطالب: إعادة تفعيله بعد فصل سابق',NULL,'2026-09-25T12:00:00Z'),
        ('note-5','student-0005','إجراء','فصل الطالب: قديم',NULL,'2026-09-22T12:00:00Z'),
        ('note-6-other','student-0006','إجراء','فصل الطالبات موضوع للمراجعة',NULL,'2026-09-25T12:00:00Z'),
        ('note-6-kind','student-0006','ملاحظة','فصل الطالب: ليس إجراء فصل',NULL,'2026-09-25T12:00:00Z');
    `);
    const snapshot = () => pg.query('SELECT row_to_json(s) AS row FROM "Student" s ORDER BY id').then(({ rows }) => rows);
    const before = await snapshot();
    let reads = 0;
    let denied = false;
    let failRead = false;
    const authCalls = [];
    const schemaChecks = [];
    const expectedSelect = {
      id: true, name: true, code: true, username: true, telegram: true, status: true,
      dismissedChecked: true, dismissedCheckEpoch: true,
      courseId: true, course: { select: { id: true, name: true } }, dismissalReason: true,
      opportunityLogs: {
        where: { OR: [{ action: "فصل تلقائي" }, { action: "خصم", reason: { startsWith: "فصل الطالب" } }] },
        select: { action: true, reason: true, date: true },
      },
      studentNotes: {
        where: { kind: "إجراء", OR: [{ text: { startsWith: "فصل الطالب" } }, { text: { startsWith: "تم فصل الطالب" } }] },
        select: { kind: true, text: true, dismissalDate: true, date: true },
      },
    };
    // The adapter offers only a read, so an unexpected mutation fails the test.
    // Execute it in a PostgreSQL read-only transaction as an additional guard.
    const mocks = {
      "next/server": { NextRequest, NextResponse },
      "@/lib/dismissed-history": historyModule.exports,
      "@/lib/server-auth": {
        requirePermission: async (req, permission) => {
          authCalls.push({ req, permission });
          return denied ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : null;
        },
      },
      "@/lib/db": { db: { student: { findMany: async (args) => {
        reads += 1;
        assert.deepEqual(Object.keys(args).sort(), ["orderBy", "select", "where"], "the list has no pagination or truncation");
        assert.deepEqual(args.where, { status: "مفصول" }, "all current dismissed students are returned, including checked ones");
        assert.deepEqual(args.select, expectedSelect, "only display data and the authoritative shared flag/epoch are loaded");
        assert.deepEqual(args.orderBy, [{ name: "asc" }, { id: "asc" }]);
        if (failRead) throw new Error("simulated database outage");
        return pg.transaction(async (sql) => {
          await sql.exec("SET TRANSACTION READ ONLY");
          const rows = (await sql.query(`SELECT s.id,s.name,s.code,s.username,s.telegram,s.status,
            s."dismissedChecked",s."dismissedCheckEpoch",s."courseId",s."dismissalReason",
            json_build_object('id',c.id,'name',c.name) AS course,
            COALESCE((SELECT json_agg(json_build_object('action',l.action,'reason',l.reason,'date',l.date))
              FROM "OpportunityLog" l WHERE l."studentId"=s.id
              AND (l.action='فصل تلقائي' OR (l.action='خصم' AND l.reason LIKE 'فصل الطالب%'))), '[]') AS "opportunityLogs",
            COALESCE((SELECT json_agg(json_build_object('kind',n.kind,'text',n.text,'dismissalDate',n."dismissalDate",'date',n.date))
              FROM "StudentNote" n WHERE n."studentId"=s.id AND n.kind='إجراء'
              AND (n.text LIKE 'فصل الطالب%' OR n.text LIKE 'تم فصل الطالب%')), '[]') AS "studentNotes"
            FROM "Student" s JOIN "Course" c ON c.id=s."courseId"
            WHERE s.status=$1 ORDER BY s.name ASC,s.id ASC`, [args.where.status])).rows;
          return rows.map((student) => ({
            ...student,
            opportunityLogs: student.opportunityLogs.map((log) => ({ ...log, date: new Date(log.date) })),
            studentNotes: student.studentNotes.map((note) => ({ ...note, date: new Date(note.date), dismissalDate: note.dismissalDate ? new Date(note.dismissalDate) : null })),
          }));
        });
      } } } },
      "@/lib/schema-readiness": { withDatabaseSchema: async (read, model) => { schemaChecks.push(model); return read(); } },
      "@/lib/route-helpers": { routeErrorResponse: (_error, message) => NextResponse.json({ error: message }, { status: 500 }) },
    };
    const loaded = { exports: {} };
    new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name) => {
      assert(name in mocks, `unexpected route dependency: ${name}`);
      return mocks[name];
    });
    assert.equal(loaded.exports.dynamic, "force-dynamic");
    assert.equal(loaded.exports.runtime, "nodejs");
    const { GET } = loaded.exports;
    const request = () => new NextRequest("https://teacherpro.test/api/students/code-closures");

    denied = true;
    assert.equal((await GET(request())).status, 403);
    assert.equal(reads, 0, "denied requests cannot read student information");
    assert.equal(schemaChecks.length, 0);
    denied = false;

    const response = await GET(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const data = await response.json();
    assert.equal(reads, 1, "counts and records share the same single-query snapshot");
    assert.deepEqual(schemaChecks, ["Student"]);
    assert.equal(data.students.length, 601, "all records beyond the usual 500-row cap remain available");
    assert.equal(data.totalCount, 601);
    assert.equal(data.checkedCount, 200, "existing checked flags remain visible to the Checked filter");
    assert.equal(data.uncheckedCount, 401);
    assert.equal(data.checkedCount + data.uncheckedCount, data.totalCount);
    assert(Number.isFinite(Date.parse(data.generatedAt)));
    assert(data.students.every((student) => student.status === "مفصول"));
    const checkedStudent = data.students.find((student) => student.id === "student-0003");
    assert.equal(checkedStudent.dismissedChecked, true);
    assert.equal(checkedStudent.dismissedCheckEpoch, 3, "the existing lifecycle epoch is preserved for CAS writes");
    assert.deepEqual(checkedStudent.course, { id: "course-b", name: "الدورة الثانية" });
    assert.equal(checkedStudent.dismissalReason, null);
    assert.equal(checkedStudent.username, 'student_user_3', "the stored username remains available beside a numeric Telegram ID");
    assert.equal(checkedStudent.telegram, '1000000003', "reading does not rewrite Telegram IDs or handles");
    const telegramOnlyStudent = data.students.find((student) => student.id === "student-0001");
    assert.equal(telegramOnlyStudent.username, null);
    assert.equal(telegramOnlyStudent.telegram, '@telegram_1', "legacy Telegram handles remain available without a username");
    const noTelegramStudent = data.students.find((student) => student.id === "student-0002");
    assert.equal(noTelegramStudent.username, null);
    assert.equal(noTelegramStudent.telegram, null, "missing Telegram details are returned honestly");
    assert.equal(telegramOnlyStudent.lastDismissalAt, "2026-09-21T12:00:00.000Z", "the recorded dismissal date supersedes the older automatic log, not the note creation date");
    assert.equal(noTelegramStudent.lastDismissalAt, "2026-09-22T12:00:00.000Z", "legacy action notes can supply their own date when dismissalDate is absent");
    assert.equal(checkedStudent.lastDismissalAt, "2026-09-23T12:00:00.000Z", "reactivation movements and notes must never count as dismissal events");
    assert.equal(data.students.find((student) => student.id === "student-0004").lastDismissalAt, null, "no date is fabricated for students without dismissal evidence");
    assert.equal(data.students.find((student) => student.id === "student-0005").lastDismissalAt, "2026-09-24T12:00:00.000Z", "a newer manual dismissal movement supersedes an older action note");
    assert.equal(data.students.find((student) => student.id === "student-0006").lastDismissalAt, null, "unrelated notes and movements are not dismissal evidence");
    assert(data.students.every((student) => !("studentNotes" in student) && !("opportunityLogs" in student)), "internal dismissal history is not exposed in the response");
    const checkedIds = data.students.filter((student) => student.dismissedChecked).map((student) => student.id);
    const originalCheckedIds = before.map(({ row }) => row).filter((student) => student.status === "مفصول" && student.dismissedChecked).map((student) => student.id);
    assert.deepEqual(checkedIds.sort(), originalCheckedIds.sort(), "the read preserves every previously checked student");
    assert.deepEqual(await snapshot(), before, "reading never changes any flag, status, epoch, or academic value");
    assert(authCalls.every(({ permission }) => permission === "students.view"));

    failRead = true;
    const failedResponse = await GET(request());
    assert.equal(failedResponse.status, 500, "failed reads are errors, never fabricated empty results");
    failRead = false;

    // A later request sees reactivation and newly dismissed records immediately.
    await pg.query('UPDATE "Student" SET status=$1 WHERE id=$2', ["نشط", "student-0003"]);
    await pg.query('UPDATE "Student" SET status=$1 WHERE id=$2', ["مفصول", "active"]);
    const fresh = await (await GET(request())).json();
    assert(!fresh.students.some((student) => student.id === "student-0003"));
    assert(fresh.students.some((student) => student.id === "active"));
    assert.equal(fresh.totalCount, 601);

    await pg.query('UPDATE "Student" SET status=$1', ["نشط"]);
    const empty = await (await GET(request())).json();
    assert.deepEqual(empty.students, []);
    assert.equal(empty.totalCount, 0);
    assert.equal(empty.checkedCount, 0);
    assert.equal(empty.uncheckedCount, 0);
    console.log("PASS: code-closure query permissions, complete current dismissed snapshot, Telegram handles and IDs, preserved checked flags/epochs, consistent counts, fresh status reads, no-store and read-only behavior");
  } finally {
    await pg.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
