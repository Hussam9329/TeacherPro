// The shortcut numbers (dashboard + sidebar): each uses its window's rule and
// is sent only to someone allowed to open that window.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename,
);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, isMain, options);
};

let principal = null;
const queries = [];
const fakeDb = {
  studentCall: {
    findMany: async (args) => {
      queries.push(["studentCall", args]);
      return [
        { category: "call-student-note", notes: "اتصلت وما رد" },
        { category: "call-student-note", notes: "   " },
        { category: "call-student-note", notes: "ولي الأمر حضر" },
      ];
    },
  },
  gradeSmartNote: { count: async (args) => { queries.push(["gradeSmartNote", args]); return 4; } },
  student: { count: async (args) => { queries.push(["student", args]); return args.where.dismissedChecked === false ? 2 : 3; } },
  studentLeave: {
    findMany: async () => [
      { studentId: "a", leaveType: "period", date: null, dateFrom: new Date("2026-09-20T00:00:00Z"), dateTo: new Date("2099-01-01T00:00:00Z"), exam: null },
      { studentId: "b", leaveType: "period", date: null, dateFrom: new Date("2020-01-01T00:00:00Z"), dateTo: new Date("2020-01-05T00:00:00Z"), exam: null },
    ],
  },
  gracePeriod: { count: async (args) => { queries.push(["gracePeriod", args]); return 1; } },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/db") return { db: fakeDb };
  if (request === "@/lib/server-auth") return {
    getAuthPrincipal: async () => principal,
    hasPermission: (who, permission) => who.isAdmin || who.permissions.includes(permission),
    unauthorizedResponse: () => new Response(JSON.stringify({ error: "401" }), { status: 401 }),
  };
  return originalLoad.call(this, request, parent, isMain);
};

const { GET } = require("../src/app/api/stats/alerts/route.ts");
const { NextRequest } = require("next/server");
const call = async () => {
  const res = await GET(new NextRequest("http://localhost/api/stats/alerts"));
  return { status: res.status, body: await res.json() };
};

(async () => {
  principal = null;
  assert.equal((await call()).status, 401, "signed-out visitors get nothing");

  principal = { isAdmin: true, permissions: [] };
  const all = (await call()).body;
  assert.equal(all.callNotesPending, 2, "blank notes are not waiting notes");
  assert.equal(all.gradeReviewsPending, 4);
  assert.equal(all.dismissedStudents, 3);
  assert.equal(all.codeClosuresPending, 2);
  assert.equal(all.currentLeaves, 1, "an ended leave is not a current leave");
  assert.equal(all.currentGracePeriods, 1);
  const callQuery = queries.find(([name]) => name === "studentCall")[1];
  assert.equal(callQuery.where.noteResolved, false, "only notes not marked done");
  assert.deepEqual(queries.find(([name]) => name === "gradeSmartNote")[1], { where: { status: "PENDING" } });
  assert.equal(queries.find(([name]) => name === "gracePeriod")[1].where.cancelledAt, null, "cancelled grace never counts");

  principal = { isAdmin: false, permissions: ["follow-up.calls.view"] };
  const calls = (await call()).body;
  assert.equal(calls.callNotesPending, 2);
  for (const key of ["gradeReviewsPending", "dismissedStudents", "codeClosuresPending", "currentLeaves", "currentGracePeriods"]) {
    assert.equal(calls[key], null, `${key} stays hidden without permission`);
  }

  principal = { isAdmin: false, permissions: [] };
  const none = (await call()).body;
  for (const key of ["callNotesPending", "gradeReviewsPending", "dismissedStudents", "codeClosuresPending", "currentLeaves", "currentGracePeriods"]) {
    assert.equal(none[key], null);
  }
  console.log("PASS: shortcut numbers follow each window's rule and the viewer's permissions");
})().catch((error) => { console.error(error); process.exit(1); });
