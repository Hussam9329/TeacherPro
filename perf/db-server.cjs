// A throwaway local PostgreSQL for performance measurement only.
//
// Starts an in-memory PGlite, applies prisma/migrations, fills it with
// synthetic data of a realistic size and serves it on a local TCP port.
// Nothing is read from or written to any real database.
//
// PGlite and the socket server are installed OUTSIDE the repo; point NODE_PATH
// at that folder:
//   NODE_PATH=<tools>/node_modules node perf/db-server.cjs [--port 54329] [--latency 0]
// The admin password for the seeded account comes from PERF_ADMIN_PASSWORD.
//
// The app connects to <port>, a small proxy in front of PGlite (on <port>+1).
// PGlite is one session, so the proxy runs one connection's request (or open
// transaction) at a time. It counts database round trips (one per client Sync
// or simple Query message) and can delay each of them by --latency ms to
// stand in for the network between the app and its database. <port>+2 is its
// control port:
//   GET /reset            -> zero the counter
//   GET /count            -> {"roundTrips": n}
//   GET /latency?ms=5     -> change the added delay
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const { PGLiteSocketServer } = require("@electric-sql/pglite-socket");

const root = path.resolve(__dirname, "..");
const portFlag = process.argv.indexOf("--port");
const port = portFlag > -1 ? Number(process.argv[portFlag + 1]) : 54329;
const latencyFlag = process.argv.indexOf("--latency");
let latencyMs = latencyFlag > -1 ? Number(process.argv[latencyFlag + 1]) : 0;
let roundTrips = 0;

// PGlite is a single session, so the proxy lets one connection talk at a time:
// from a request until the server reports that connection idle (outside a
// transaction). It also counts the round trips and adds the latency.
let lockHolder = null;
const lockWaiters = [];
function acquireLock(connection) {
  if (lockHolder === connection) return Promise.resolve();
  if (!lockHolder) {
    lockHolder = connection;
    return Promise.resolve();
  }
  return new Promise((resolve) => lockWaiters.push({ connection, resolve }));
}
function releaseLock(connection) {
  const waiting = lockWaiters.findIndex((waiter) => waiter.connection === connection);
  if (waiting > -1) lockWaiters.splice(waiting, 1);
  if (lockHolder !== connection) return;
  const next = lockWaiters.shift();
  lockHolder = next ? next.connection : null;
  if (next) next.resolve();
}

function startCountingProxy(listenPort, targetPort) {
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    const connection = {};
    let closed = false;
    let fromClient = Buffer.alloc(0);
    let fromServer = Buffer.alloc(0);
    let startupDone = false;
    let unitStart = 0;
    let onReady = null;
    let queue = Promise.resolve();

    // One unit: the bytes up to a message that makes the server answer.
    const sendUnit = (bytes, counted, expectsReply) => {
      queue = queue.then(async () => {
        if (closed) return;
        if (counted && latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
        await acquireLock(connection);
        if (closed) return releaseLock(connection);
        const ready = expectsReply ? new Promise((resolve) => { onReady = resolve; }) : null;
        upstream.write(bytes);
        const status = ready ? await ready : "I";
        if (status === "I") releaseLock(connection);
      });
    };

    client.on("data", (chunk) => {
      fromClient = Buffer.concat([fromClient, chunk]);
      let offset = unitStart;
      while (true) {
        if (!startupDone) {
          if (fromClient.length - offset < 4) break;
          const length = fromClient.readInt32BE(offset);
          if (fromClient.length - offset < length) break;
          offset += length;
          startupDone = true;
          sendUnit(fromClient.subarray(0, offset), false, true);
          fromClient = fromClient.subarray(offset);
          offset = 0;
          continue;
        }
        if (fromClient.length - offset < 5) break;
        const length = fromClient.readInt32BE(offset + 1);
        if (fromClient.length - offset < 1 + length) break;
        const type = String.fromCharCode(fromClient[offset]);
        offset += 1 + length;
        if (type === "S" || type === "Q" || type === "X") {
          if (type !== "X") roundTrips += 1;
          sendUnit(fromClient.subarray(0, offset), type !== "X", type !== "X");
          fromClient = fromClient.subarray(offset);
          offset = 0;
        }
      }
      unitStart = offset;
    });

    upstream.on("data", (chunk) => {
      if (!client.destroyed) client.write(chunk);
      fromServer = Buffer.concat([fromServer, chunk]);
      while (fromServer.length >= 5) {
        const length = fromServer.readInt32BE(1);
        if (fromServer.length < 1 + length) break;
        if (String.fromCharCode(fromServer[0]) === "Z" && onReady) {
          const resolve = onReady;
          onReady = null;
          resolve(String.fromCharCode(fromServer[5]));
        }
        fromServer = fromServer.subarray(1 + length);
      }
    });

    const close = () => {
      if (closed) return;
      closed = true;
      if (onReady) onReady("I");
      releaseLock(connection);
      client.destroy();
      upstream.destroy();
    };
    client.on("close", close);
    client.on("error", close);
    upstream.on("close", close);
    upstream.on("error", close);
  });
  return new Promise((resolve) => server.listen(listenPort, "127.0.0.1", () => resolve(server)));
}

function startControlServer(listenPort) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/reset") roundTrips = 0;
    if (url.pathname === "/latency") latencyMs = Math.max(0, Number(url.searchParams.get("ms")) || 0);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ roundTrips, latencyMs }));
  });
  return new Promise((resolve) => server.listen(listenPort, "127.0.0.1", () => resolve(server)));
}

const SIZE = {
  courses: 6,
  chapters: 4,
  students: 3000,
  examsPerCourse: 30,
  opportunityLogs: 20000,
  auditLogs: 60000,
  calls: 6000,
  notes: 3000,
  leaves: 400,
};

// A fixed seed: the same data on every start, so before/after runs compare.
let randomState = 20261117;
function random() {
  randomState = (randomState * 1664525 + 1013904223) % 4294967296;
  return randomState / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const iso = (date) => date.toISOString();
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function scryptHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$1$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function insertRows(pg, table, columns, rows, chunkSize = 500) {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = [];
    const tuples = chunk.map((row) => `(${row.map((value) => { values.push(value); return `$${values.length}`; }).join(",")})`);
    await pg.query(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES ${tuples.join(",")}`, values);
  }
}

async function seed(pg) {
  const password = process.env.PERF_ADMIN_PASSWORD;
  if (!password) throw new Error("PERF_ADMIN_PASSWORD is required");

  const firstNames = ["علي", "حسين", "محمد", "أحمد", "مصطفى", "زينب", "فاطمة", "مريم", "نور", "سجاد", "كرار", "عباس", "حيدر", "رقية", "زهراء", "يوسف", "مرتضى", "آية", "سارة", "هدى"];
  const fatherNames = ["جاسم", "كاظم", "عبد الله", "حسن", "صالح", "ناصر", "رحيم", "هادي", "فاضل", "ماجد", "سعد", "قاسم", "جواد", "طالب", "عادل"];
  const familyNames = ["الموسوي", "الربيعي", "الجبوري", "العبيدي", "الساعدي", "الزبيدي", "الخفاجي", "التميمي", "الكعبي", "اللامي"];
  const schools = ["ثانوية المتميزين", "إعدادية الكاظمية", "ثانوية بغداد للبنات", "إعدادية المنصور", "ثانوية الرسالة", "إعدادية الجمهورية"];
  const sites = ["الكرخ", "الرصافة", "الكاظمية", "المنصور", "الشعب"];
  const adminPermissions = JSON.stringify([
    "system.dashboard", "system.settings", "backup.view", "backup.restore", "system.maintenance",
    "courses.view", "courses.add", "courses.edit", "courses.delete",
    "chapters.view", "chapters.add", "chapters.edit", "chapters.delete",
    "students.view", "students.add", "students.edit", "students.delete",
    "exams.view", "exams.add", "exams.edit", "exams.delete",
    "grades.view", "grades.add", "grades.edit", "grades.delete",
    "opportunities.view", "opportunities.manage", "follow-up.view", "follow-up.manage",
    "accounts.view", "accounts.manage", "logs.view",
  ]);

  // Bulk load without the write triggers (they replay academic rules per row);
  // the rows they would derive (ExamCourse) are inserted here directly.
  await pg.exec(`SET session_replication_role = replica`);

  await pg.query(`INSERT INTO "Role" (id,name,"isDefault",permissions) VALUES ('role_admin','مدير عام',true,$1) ON CONFLICT (id) DO NOTHING`, [adminPermissions]);
  await pg.query(
    `INSERT INTO "AppUser" (id,username,name,"passwordHash",role,"roleId",permissions,active) VALUES ('u_admin','admin','مدير النظام',$1,'مدير عام','role_admin','[]',true)`,
    [scryptHash(password)],
  );
  const staff = [];
  for (let index = 1; index <= 8; index += 1) {
    staff.push([`u_staff_${index}`, `staff${index}`, `موظف ${index}`, null, "مدير عام", "role_admin", "[]", true]);
  }
  await insertRows(pg, "AppUser", ["id", "username", "name", "passwordHash", "role", "roleId", "permissions", "active"], staff);

  const courses = [];
  for (let index = 1; index <= SIZE.courses; index += 1) {
    courses.push([
      `course_${index}`, `دورة الأحياء ${index}`, true,
      JSON.stringify(["منهج كامل", "كورسات"]), JSON.stringify(["إلكتروني", "حضوري", "مدمج"]),
      JSON.stringify({ "منهج كامل": ["إلكتروني", "حضوري", "مدمج"], "كورسات": ["إلكتروني", "حضوري"] }), "{}",
    ]);
  }
  await insertRows(pg, "Course", ["id", "name", "active", "availablePrograms", "availableStudyTypes", "studyTypesByProgram", "locationConfig"], courses);

  const chapters = [];
  for (let index = 1; index <= SIZE.chapters; index += 1) chapters.push([`chapter_${index}`, `الفصل ${index}`, 5]);
  await insertRows(pg, "Chapter", ["id", "name", "opportunities"], chapters);

  const links = [];
  for (let course = 1; course <= SIZE.courses; course += 1) {
    for (let chapter = 1; chapter <= SIZE.chapters; chapter += 1) {
      const active = chapter === 2;
      links.push([`cc_${course}_${chapter}`, active, chapter < 2, "[]", `course_${course}`, `chapter_${chapter}`]);
    }
  }
  await insertRows(pg, "CourseChapter", ["id", "active", "archived", "archive", "courseId", "chapterId"], links);

  const students = [];
  for (let index = 1; index <= SIZE.students; index += 1) {
    const name = `${pick(firstNames)} ${pick(fatherNames)} ${pick(fatherNames)} ${pick(familyNames)} ${index}`;
    const roll = random();
    const status = roll < 0.82 ? "نشط" : roll < 0.94 ? "مفصول" : "مؤرشف";
    const opportunities = status === "نشط" ? 1 + Math.floor(random() * 5) : 0;
    const phone = `0770${String(1000000 + index).padStart(7, "0")}`;
    students.push([
      `student_${index}`, name, name, pick(schools), index % 2 ? "ذكر" : "أنثى", phone, phone,
      `0780${String(1000000 + index).padStart(7, "0")}`, random() < 0.6 ? `tg${index}` : null, random() < 0.6 ? `tg${index}` : null,
      random() < 0.7 ? "منهج كامل" : "كورسات", pick(["إلكتروني", "حضوري", "مدمج"]), "بغداد", pick(sites),
      `S${String(index).padStart(5, "0")}`, status, status === "مفصول" ? "فصل" : null,
      status === "مفصول" ? "استنفاد الفرص" : null, opportunities, 5,
      iso(new Date(NOW - (30 + Math.floor(random() * 200)) * DAY)), `course_${1 + (index % SIZE.courses)}`,
    ]);
  }
  await insertRows(pg, "Student", [
    "id", "name", "nameKey", "school", "gender", "phone", "phoneKey", "parentPhone", "telegram", "telegramKey",
    "courseProgram", "studyType", "locationScope", "mainSite", "code", "status", "dismissalType",
    "dismissalReason", "opportunities", "baseOpportunities", "createdAt", "courseId",
  ], students, 200);

  const exams = [];
  const examCourses = [];
  const examsByCourse = new Map();
  for (let course = 1; course <= SIZE.courses; course += 1) {
    const list = [];
    for (let index = 1; index <= SIZE.examsPerCourse; index += 1) {
      const id = `exam_${course}_${index}`;
      const type = index % 10 === 0 ? "تراكمي" : "يومي";
      const date = new Date(NOW - (SIZE.examsPerCourse - index) * 3 * DAY);
      const chapter = index <= SIZE.examsPerCourse / 2 ? 1 : 2;
      exams.push([id, `امتحان ${index} - دورة ${course}`, type, JSON.stringify([`course_${course}`]), iso(date), 100, 50, 70, "1", true, iso(date)]);
      examCourses.push([`ec_${course}_${index}`, id, `course_${course}`, `chapter_${chapter}`, "recorded"]);
      list.push({ id, date, chapter });
    }
    examsByCourse.set(course, list);
  }
  await insertRows(pg, "Exam", ["id", "name", "type", "courseIds", "date", "fullMark", "passMark", "discountMark", "opportunitiesPenalty", "active", "createdAt"], exams);
  await insertRows(pg, "ExamCourse", ["id", "examId", "courseId", "chapterId", "chapterSource"], examCourses);

  let grades = [];
  let gradeCount = 0;
  const gradeColumns = ["id", "status", "score", "academicAccountingChecked", "createdAt", "updatedAt", "studentId", "examId"];
  for (let index = 1; index <= SIZE.students; index += 1) {
    for (const exam of examsByCourse.get(1 + (index % SIZE.courses))) {
      const roll = random();
      const status = roll < 0.88 ? "درجة" : roll < 0.96 ? "غائب" : "مجاز";
      const score = status === "درجة" ? 30 + Math.floor(random() * 71) : null;
      gradeCount += 1;
      grades.push([`grade_${gradeCount}`, status, score, true, iso(exam.date), iso(exam.date), `student_${index}`, exam.id]);
    }
    if (grades.length >= 3000) {
      await insertRows(pg, "Grade", gradeColumns, grades, 1000);
      grades = [];
    }
  }
  await insertRows(pg, "Grade", gradeColumns, grades, 1000);

  const logs = [];
  for (let index = 1; index <= SIZE.opportunityLogs; index += 1) {
    const student = 1 + Math.floor(random() * SIZE.students);
    const exam = pick(examsByCourse.get(1 + (student % SIZE.courses)));
    const before = 1 + Math.floor(random() * 5);
    logs.push([`olog_${index}`, "خصم", 1, 1, 1, before, before - 1, "رسوب في الامتحان", iso(exam.date), `chapter_${exam.chapter}`, `الفصل ${exam.chapter}`, `student_${student}`, exam.id]);
  }
  await insertRows(pg, "OpportunityLog", ["id", "action", "amount", "requestedAmount", "appliedAmount", "balanceBefore", "balanceAfter", "reason", "date", "chapterId", "chapterNameSnapshot", "studentId", "examId"], logs, 1000);

  const audit = [];
  const modules = ["الطلاب", "الدرجات", "الامتحانات", "الفرص", "المكالمات", "أمان الحسابات"];
  for (let index = 1; index <= SIZE.auditLogs; index += 1) {
    const user = 1 + Math.floor(random() * 8);
    audit.push([`audit_${index}`, pick(modules), pick(["إضافة", "تعديل", "حذف"]), JSON.stringify({ id: `student_${1 + Math.floor(random() * SIZE.students)}`, note: "عملية تجريبية" }), iso(new Date(NOW - Math.floor(random() * 120 * DAY))), `u_staff_${user}`, `موظف ${user}`]);
  }
  await insertRows(pg, "AuditLog", ["id", "module", "action", "details", "time", "userId", "userName"], audit, 1000);

  const calls = [];
  const seenCalls = new Set();
  while (calls.length < SIZE.calls) {
    const student = 1 + Math.floor(random() * SIZE.students);
    const exam = pick(examsByCourse.get(1 + (student % SIZE.courses)));
    const key = `${student}:${exam.id}`;
    if (seenCalls.has(key)) continue;
    seenCalls.add(key);
    const completed = random() < 0.7;
    calls.push([`call_${calls.length + 1}`, `student_${student}`, exam.id, "مخصومين", "ولي الأمر", "", completed ? "تم الرد" : "", completed, completed ? iso(exam.date) : null, random() < 0.2 ? "ملاحظة متابعة" : "", iso(exam.date)]);
  }
  await insertRows(pg, "StudentCall", ["id", "studentId", "examId", "category", "target", "phone", "status", "completed", "completedAt", "notes", "createdAt"], calls, 1000);

  const notes = [];
  for (let index = 1; index <= SIZE.notes; index += 1) {
    notes.push([`note_${index}`, `student_${1 + Math.floor(random() * SIZE.students)}`, "ملاحظة", "ملاحظة متابعة تجريبية", iso(new Date(NOW - Math.floor(random() * 120 * DAY)))]);
  }
  await insertRows(pg, "StudentNote", ["id", "studentId", "kind", "text", "date"], notes, 1000);

  const leaves = [];
  const seenLeaves = new Set();
  while (leaves.length < SIZE.leaves) {
    const student = 1 + Math.floor(random() * SIZE.students);
    const exam = pick(examsByCourse.get(1 + (student % SIZE.courses)));
    const key = `${student}:${exam.id}`;
    if (seenLeaves.has(key)) continue;
    seenLeaves.add(key);
    leaves.push([`leave_${leaves.length + 1}`, `student_${student}`, exam.id, "exam", "مرض", iso(exam.date)]);
  }
  await insertRows(pg, "StudentLeave", ["id", "studentId", "examId", "leaveType", "reason", "date"], leaves, 500);

  await pg.exec(`SET session_replication_role = DEFAULT`);
  await pg.exec(`ANALYZE`);
  return { grades: gradeCount };
}

(async () => {
  const started = Date.now();
  const pg = new PGlite({ extensions: { pg_trgm } });
  let migrations = 0;
  // The history table `prisma migrate deploy` keeps; the app's schema guard reads it.
  await pg.exec(`CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
  for (const dir of fs.readdirSync(path.join(root, "prisma/migrations")).sort()) {
    const file = path.join(root, "prisma/migrations", dir, "migration.sql");
    if (!fs.existsSync(file)) continue;
    try {
      const sql = fs.readFileSync(file, "utf8");
      await pg.exec(sql);
      await pg.query(
        `INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","applied_steps_count") VALUES ($1,$2,now(),$3,1)`,
        [crypto.randomUUID(), crypto.createHash("sha256").update(sql).digest("hex"), dir],
      );
      migrations += 1;
    } catch (error) {
      throw new Error(`${dir}: ${error.message}`);
    }
  }
  const seeded = await seed(pg);
  const server = new PGLiteSocketServer({ db: pg, port: port + 1, host: "127.0.0.1", maxConnections: 20 });
  await server.start();
  await startCountingProxy(port, port + 1);
  await startControlServer(port + 2);
  console.log(`READY port=${port} latency=${latencyMs}ms migrations=${migrations} grades=${seeded.grades} students=${SIZE.students} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const stop = async () => {
    await server.stop();
    await pg.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
