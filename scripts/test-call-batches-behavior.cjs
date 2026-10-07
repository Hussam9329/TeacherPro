// «دفعات» in إدارة المكالمات, on a real Postgres (PGlite) built from every
// migration: windows never share a student, a closed or silent window gives
// its batch back, and moving to another exam lets go of the old one.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");

const root = process.cwd();
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  file,
);
const server = require("../src/lib/call-reservations-server.ts");
const { CALL_BATCH_SIZE } = require("../src/lib/call-batch.ts");

(async () => {
  const db = new PGlite();
  for (const directory of fs.readdirSync("prisma/migrations").sort()) {
    const file = `prisma/migrations/${directory}/migration.sql`;
    if (fs.existsSync(file)) await db.exec(fs.readFileSync(file, "utf8"));
  }
  // The tagged-template calls the module makes, as Prisma would run them.
  const sql = (strings, values) => strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ""), "");
  const client = {
    $queryRaw: async (strings, ...values) => (await db.query(sql(strings, values), values)).rows,
    $executeRaw: async (strings, ...values) => (await db.query(sql(strings, values), values)).affectedRows || 0,
  };

  await db.exec(`INSERT INTO "Course" (id, name) VALUES ('c', 'course');
    INSERT INTO "Exam" (id, name, type, date, "courseIds", "fullMark", "passMark", "discountMark", "opportunitiesPenalty")
      VALUES ('e1', 'exam 1', 'يومي', '2026-10-01', '["c"]', 20, 10, 7, 1), ('e2', 'exam 2', 'يومي', '2026-10-02', '["c"]', 20, 10, 7, 1);
    INSERT INTO "Student" (id, name, gender, code, "courseId", status, opportunities, "baseOpportunities")
      SELECT 's' || lpad(i::text, 2, '0'), 'student ' || i, 'ذكر', 'T' || i, 'c', 'نشط', 3, 3 FROM generate_series(1, 25) i;`);
  const students = Array.from({ length: 25 }, (_, i) => `s${String(i + 1).padStart(2, "0")}`);
  const now = new Date("2026-10-06T09:00:00.000Z");
  const later = (ms) => new Date(now.getTime() + ms);
  const owner = (id) => ({ id, name: `staff ${id}` });
  const open = (id, user, examId = "e1", at = now) =>
    server.touchCallWindow(client, { id, owner: owner(user), courseId: "c", examId }, at);
  const ownerOf = { "window-a1": "u1", "window-b1": "u2", "window-c1": "u3", "window-d1": "u4" };
  const claim = (windowId, examId = "e1", at = now, openStudentIds = students) =>
    server.claimCallBatch(client, { windowId, ownerId: ownerOf[windowId], examId, openStudentIds, size: CALL_BATCH_SIZE }, at);
  const hold = (windowId, studentId, at = now, ownerId = ownerOf[windowId]) =>
    server.holdCallCase(client, { id: windowId, ownerId }, studentId, "e1", at);
  let count = 0;
  const step = (name) => { count += 1; console.log(`ok ${count} ${name}`); };

  // Three windows on one exam take 10, 10 and the last 5; nobody shares a student.
  await open("window-a1", "u1");
  await open("window-b1", "u2");
  await open("window-c1", "u3");
  const a = await claim("window-a1");
  const b = await claim("window-b1");
  const c = await claim("window-c1");
  assert.deepEqual([a.size, b.size, c.size], [10, 10, 5]);
  assert.equal(new Set([...a, ...b, ...c]).size, 25, "every student is held exactly once");
  assert.deepEqual([...a].sort(), students.slice(0, 10), "the first window gets the first ten in list order");
  step("three windows split one exam with no student in two batches");

  // Holding what it has, a window asking again gets nothing new.
  assert.equal((await claim("window-a1")).size, 10);
  // A race: two windows reaching for the same students at once still never share.
  await server.releaseCallBatch(client, "window-a1", "e1");
  await server.releaseCallBatch(client, "window-b1", "e1");
  const [ra, rb] = await Promise.all([claim("window-a1"), claim("window-b1")]);
  assert.equal([...ra].filter((id) => rb.has(id)).length, 0, "no student in both batches");
  assert.equal(ra.size + rb.size, 20);
  step("asking again or racing for the same students never doubles a student");

  // Any action ends the hold; taking it back holds the student for the asking window again.
  const acted = [...ra][0];
  await server.dropCallHold(client, acted, "e1");
  assert.equal((await server.liveCallHolders(client, "e1", now)).some((h) => h.studentId === acted), false);
  assert.equal(await hold("window-b1", acted, now, "u1"), false, "only the window's own account can hold for it");
  assert.equal(await hold("window-a1", acted), true);
  assert.equal(await hold("window-b1", acted), false, "someone else holds them now");
  step("an action ends the hold, and taking it back returns the student to the window that asked");

  // A closed window gives its batch back at once; another window can take it.
  const heldByC = new Set((await server.liveCallHolders(client, "e1", now)).filter((h) => h.windowId === "window-c1").map((h) => h.studentId));
  await server.closeCallWindow(client, "window-c1", "someone-else");
  assert.equal((await server.liveCallHolders(client, "e1", now)).filter((h) => h.windowId === "window-c1").length, heldByC.size,
    "only the window's own account can close it");
  await server.closeCallWindow(client, "window-c1", "u3");
  assert.equal((await server.liveCallHolders(client, "e1", now)).filter((h) => h.windowId === "window-c1").length, 0);
  await open("window-d1", "u4");
  const d = await claim("window-d1");
  assert.ok([...heldByC].every((id) => d.has(id)), "the closed window's students are free again");
  step("a closed window gives its batch back at once");

  // A window silent for over two minutes stops counting, then is dropped.
  const t3 = later(3 * 60 * 1000);
  await open("window-a1", "u1", "e1", t3);
  await open("window-d1", "u4", "e1", t3);
  const live = await server.liveCallHolders(client, "e1", t3);
  assert.equal(live.some((h) => h.windowId === "window-b1"), false, "a silent window's students are free");
  await server.releaseStaleCallWindows(client, t3);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CallReservation" WHERE "windowId" = 'window-b1'`)).rows[0].n, 0);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CallWindow" WHERE id = 'window-b1'`)).rows[0].n, 0);
  assert.equal(await hold("window-b1", "s25", t3), false, "a dropped window cannot hold");
  step("a window silent for more than two minutes gives its batch back");

  // Moving to another exam lets go of the old one.
  const before = (await server.liveCallHolders(client, "e1", t3)).filter((h) => h.windowId === "window-d1").length;
  assert.ok(before > 0);
  await open("window-d1", "u4", "e2", t3);
  assert.equal((await server.liveCallHolders(client, "e1", t3)).filter((h) => h.windowId === "window-d1").length, 0);
  assert.equal((await claim("window-d1", "e2", t3)).size, 10, "a full batch on the new exam");
  step("a window that moves to another exam lets go of the old one");

  // The admin's view and the «يشتغل ويّاك» count.
  const windows = await server.liveCallWindows(client, t3);
  assert.deepEqual(windows.map((w) => [w.id, w.held]).sort(), [["window-a1", 10], ["window-d1", 10]]);
  assert.equal(await server.countOtherLiveCallWindows(client, "e1", "window-a1", t3), 0);
  assert.equal(await server.countOtherLiveCallWindows(client, "e2", "window-a1", t3), 1);
  step("the admin sees every open window and what it still holds");

  // Deleting a student or an exam drops their holds with them.
  await db.exec(`DELETE FROM "Exam" WHERE id = 'e2'`);
  assert.equal((await server.liveCallWindows(client, t3)).find((w) => w.id === "window-d1").held, 0);
  step("a deleted exam takes its holds with it");

  // Another account cannot take a window over by its id.
  assert.equal(await server.touchCallWindow(client, { id: "window-a1", owner: { id: "intruder", name: "x" }, courseId: "c", examId: "e1" }, t3), false);
  assert.equal((await db.query(`SELECT "userId" FROM "CallWindow" WHERE id = 'window-a1'`)).rows[0].userId, "u1");
  assert.equal(await server.touchCallWindow(client, { id: "window-a1", owner: owner("u1"), courseId: "c", examId: "e1" }, t3), true);
  step("a window belongs to the account that opened it");

  // The reported case: a caller steps away (a call from the same phone, the
  // screen locked) and their page goes silent. A page that said «away» keeps
  // its batch for the whole call; another account never gets those names.
  await server.releaseCallBatch(client, "window-a1", "e1");
  await open("window-a1", "u1", "e1", t3);
  const away = await claim("window-a1", "e1", t3);
  assert.equal(away.size, 10);
  await server.touchCallWindow(client, { id: "window-a1", owner: owner("u1"), courseId: "c", examId: "e1" }, t3, { away: true });
  const t10 = later(10 * 60 * 1000);
  await server.releaseStaleCallWindows(client, t10);
  assert.deepEqual(new Set(await server.heldByCallWindow(client, "window-a1", "e1", t10)), away, "ten silent minutes away: still held");
  await open("window-b2", "u2", "e1", t10);
  ownerOf["window-b2"] = "u2";
  const other = await claim("window-b2", "e1", t10);
  assert.equal([...other].filter((id) => away.has(id)).length, 0, "another account does not get the away window's names");
  // Back on the page: a plain beat ends «away», and the batch is still there.
  await open("window-a1", "u1", "e1", t10);
  assert.equal((await db.query(`SELECT "awayUntil" FROM "CallWindow" WHERE id = 'window-a1'`)).rows[0].awayUntil, null);
  assert.deepEqual(new Set(await server.heldByCallWindow(client, "window-a1", "e1", t10)), away);
  step("a caller away on a call keeps their batch; nobody else gets those names");

  // Without «away», two silent minutes still give the batch back, and the
  // window's next beat learns it holds nothing, so its page drops the names.
  const t13 = later(13 * 60 * 1000);
  await open("window-b2", "u2", "e1", t13);
  await server.releaseStaleCallWindows(client, t13);
  assert.equal((await server.liveCallHolders(client, "e1", t13)).some((h) => h.windowId === "window-a1"), false);
  await open("window-a1", "u1", "e1", t13);
  assert.deepEqual(await server.heldByCallWindow(client, "window-a1", "e1", t13), [], "the returning page learns its batch is gone");
  // An away window past its grace is dropped too.
  await server.touchCallWindow(client, { id: "window-b2", owner: owner("u2"), courseId: "c", examId: "e1" }, t13, { away: true });
  await server.releaseStaleCallWindows(client, later(29 * 60 * 1000));
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CallWindow" WHERE id = 'window-b2'`)).rows[0].n, 0);
  step("a silent page without «away» loses its batch after two minutes, and learns it on return");

  // The race the ten-caller run found: a window picks students from a list
  // read a moment before another caller saved an action on some of them.
  // Those are let go after the hold and replaced by the next open students.
  await db.exec(`DELETE FROM "CallReservation"; DELETE FROM "CallWindow";`);
  await open("window-c2", "u3", "e1", t13);
  ownerOf["window-c2"] = "u3";
  await db.exec(`INSERT INTO "StudentCall" (id, "studentId", "examId", category, status, completed, "actedAt")
    VALUES ('just-called-1', 's01', 'e1', 'absent', 'تم الاتصال', true, now()),
           ('just-called-2', 's02', 'e1', 'absent', 'لم يرد', false, '${t13.toISOString()}'),
           ('only-a-note', 's03', 'e1', 'call-student-note', '', false, now())`);
  const fresh = await claim("window-c2", "e1", t13);
  assert.equal(fresh.has("s01"), false, "a student called a moment ago is not handed out");
  assert.equal(fresh.has("s02"), false, "nor one who did not answer a moment ago");
  assert.equal(fresh.has("s03"), true, "a note alone is not a call");
  assert.equal(fresh.size, 10, "the batch is filled from the next open students");
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CallReservation" WHERE "studentId" IN ('s01', 's02')`)).rows[0].n, 0);
  step("a student called while the batch was being picked is let go and replaced");

  // Who acted is stored on the call row.
  await db.exec(`INSERT INTO "StudentCall" (id, "studentId", "examId", category, status, "actedAt", "actedById", "actedByName")
    VALUES ('call-1', 's01', 'e1', 'grade:x', 'تم الاتصال', now(), 'u1', 'staff u1')`);
  assert.equal((await db.query(`SELECT "actedByName" FROM "StudentCall" WHERE id = 'call-1'`)).rows[0].actedByName, "staff u1");
  step("a call row keeps who made the last action");

  await db.close();
  console.log(`call batches: ${count} scenarios passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
