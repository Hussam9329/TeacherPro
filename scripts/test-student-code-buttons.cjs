// ☢️ «إغلاق الكود» / «فتح الكود» on every student card: only one is enabled
// at a time, only for dismissed students, only for the admin and the
// supervisor; «فتح الكود» clears ☢️ and «الكود مغلق» so ☢️ works again.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { NextRequest, NextResponse } = require("next/server");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compile = (file, requireFn) => {
  const module = { exports: {} };
  const output = ts.transpileModule(read(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("module", "exports", "require", output)(module, module.exports, requireFn);
  return module.exports;
};

const format = compile("src/lib/format.ts", () => ({}));
const contact = compile("src/lib/code-closure-contact.ts", (name) => {
  assert.equal(name, "./format");
  return format;
});

// ── Closed or open ────────────────────────────────────────────────────────
assert.equal(contact.isStudentCodeClosed({ dismissedChecked: false, dismissedCheckEpoch: 3, closurePlatformEpoch: null }), false, "nothing pressed: open");
assert.equal(contact.isStudentCodeClosed({ dismissedChecked: false, dismissedCheckEpoch: 3, closurePlatformEpoch: 3 }), true, "☢️ pressed in this dismissal: closed");
assert.equal(contact.isStudentCodeClosed({ dismissedChecked: false, dismissedCheckEpoch: 3, closurePlatformEpoch: 2 }), false, "☢️ from an older dismissal does not count");
assert.equal(contact.isStudentCodeClosed({ dismissedChecked: true, dismissedCheckEpoch: 3, closurePlatformEpoch: null }), true, "«الكود مغلق» ticked: closed");
assert.equal(contact.isStudentCodeClosed({ dismissedChecked: false, closurePlatformEpoch: 0 }), true, "a missing episode reads as 0");

// ── Who may press ─────────────────────────────────────────────────────────
assert.equal(contact.canUseStudentCodeButtons({ username: " Admin ", roleId: "" }), true);
assert.equal(contact.canUseStudentCodeButtons({ username: "x", roleId: "role_admin" }), true);
assert.equal(contact.canUseStudentCodeButtons({ username: "x", roleId: "role_supervisor" }), true);
for (const roleId of ["role_registrar", "role_checker", "", null]) {
  assert.equal(contact.canUseStudentCodeButtons({ username: "x", roleId }), false, `${roleId} cannot press`);
}
assert.equal(contact.canUseStudentCodeButtons(null), false);
console.log("PASS: a code is closed by ☢️ in this dismissal or by «الكود مغلق»; only the admin and the supervisor may press");

// ── The buttons on a card ─────────────────────────────────────────────────
let user = { username: "sup", roleId: "role_supervisor" };
const calls = [];
const { StudentCodeButtons } = compile("src/components/teacher-pro/student-code-buttons.tsx", (name) => {
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": { Radiation: () => null, LockKeyholeOpen: () => null },
    "@/lib/code-closures-client": { codeClosuresApi: { markContact: async (...args) => calls.push(["close", ...args]), reopenCode: async (...args) => calls.push(["open", ...args]) } },
    "@/lib/code-closure-contact": contact,
    "@/lib/code-closure-open": { openMzCodePage: (...args) => calls.push(["page", args[1]]) },
    "@/lib/teacher-store": { useTeacherStore: (select) => select({ currentUser: () => user }) },
    "@/lib/teacherpro-sync": { emitTeacherProDataChanged: () => null },
    "@/lib/user-toast": { toast: { error: () => {}, success: () => {} } },
    "./student-code-buttons.css": {},
  };
  assert(name in mocks, `unexpected dependency: ${name}`);
  return mocks[name];
});
const render = (student) => renderToStaticMarkup(React.createElement(StudentCodeButtons, { student }));
const buttons = (html) => {
  const found = {};
  for (const match of html.matchAll(/<button([^>]*)>/g)) {
    const attrs = match[1];
    const kind = /tp-code-buttons__close/.test(attrs) ? "close" : "open";
    found[kind] = { disabled: /\sdisabled=""/.test(attrs), done: /data-done="true"/.test(attrs) };
  }
  return found;
};
const dismissed = { id: "s1", name: "طالب", phone: "07705550679", status: "مفصول", dismissedChecked: false, dismissedCheckEpoch: 3, closurePlatformEpoch: null };

assert.deepEqual(buttons(render(dismissed)), { close: { disabled: false, done: false }, open: { disabled: true, done: false } }, "open code: ☢️ works, «فتح الكود» is off");
assert.deepEqual(buttons(render({ ...dismissed, closurePlatformEpoch: 3 })), { close: { disabled: true, done: true }, open: { disabled: false, done: false } }, "closed code: ☢️ is off with its check, «فتح الكود» works");
assert.deepEqual(buttons(render({ ...dismissed, dismissedChecked: true, closurePlatformEpoch: 3 })), { close: { disabled: true, done: true }, open: { disabled: false, done: false } });
for (const status of ["نشط", "مؤرشف"]) assert.equal(render({ ...dismissed, status }), "", `no buttons for a ${status} student`);
user = { username: "reg", roleId: "role_registrar" };
assert.deepEqual(buttons(render(dismissed)), { close: { disabled: true, done: false }, open: { disabled: true, done: false } }, "without the right both are off");
assert.match(render(dismissed), /للأدمن والمشرف فقط/);
user = null;
assert.deepEqual(buttons(render({ ...dismissed, closurePlatformEpoch: 3 })).open, { disabled: true, done: false });
console.log("PASS: on a dismissed student's card only one button works at a time; other students show none; without the right both are off");

// Every card that shows a student carries the same component.
for (const file of [
  "src/components/teacher-pro/student-registry-results.tsx",
  "src/components/teacher-pro/dismissed-management.tsx",
  "src/components/teacher-pro/opportunities.tsx",
  "src/components/teacher-pro/student-profile-dialog.tsx",
  "src/components/teacher-pro/follow-up.tsx",
]) {
  const source = read(file);
  assert.match(source, /import \{ StudentCodeButtons \} from "\.\/student-code-buttons";/, `${file} imports the shared buttons`);
  assert.match(source, /<StudentCodeButtons student=\{/, `${file} renders the shared buttons`);
}
// The window and the cards open the platform through the same helper.
const dialog = read("src/components/teacher-pro/code-closures-dialog.tsx");
assert.match(dialog, /openMzCodePage\(student, "close", button\)/);
assert.match(dialog, /openMzCodePage\(student, "open", button\)/);
assert.match(dialog, /codeClosuresApi\.reopenCode\(student\.id, student\.dismissedCheckEpoch\)/);
assert.doesNotMatch(dialog, /window\.open\(/, "the window no longer keeps its own copy of the platform opener");
console.log("PASS: سجل الطلاب، المفصولين، الفرص، ملف الطالب والمتابعة all render the shared buttons; the window uses the same opener");

// ── «فتح الكود» on the server ─────────────────────────────────────────────
(async () => {
  const rows = new Map();
  const audits = [];
  let denied = false;
  const reset = () => {
    rows.clear();
    audits.length = 0;
    rows.set("s1", { id: "s1", name: "طالب", code: "BIO-1", status: "مفصول", dismissedChecked: true, dismissedCheckEpoch: 3, closurePlatformEpoch: 3, closureTelegramEpoch: 3, opportunities: 0 });
    rows.set("open", { id: "open", name: "مفتوح", code: "BIO-3", status: "مفصول", dismissedChecked: false, dismissedCheckEpoch: 5, closurePlatformEpoch: 4, closureTelegramEpoch: null, opportunities: 0 });
    rows.set("active", { id: "active", name: "نشط", code: "BIO-2", status: "نشط", dismissedChecked: false, dismissedCheckEpoch: 4, closurePlatformEpoch: null, closureTelegramEpoch: null, opportunities: 2 });
  };
  const pick = (row, select) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
  const tx = {
    student: {
      findUnique: async ({ where, select }) => (rows.has(where.id) ? pick(rows.get(where.id), select) : null),
      updateMany: async ({ where, data }) => {
        const row = rows.get(where.id);
        if (!row || row.status !== where.status || row.dismissedCheckEpoch !== where.dismissedCheckEpoch) return { count: 0 };
        assert.deepEqual(Object.keys(data).sort(), ["closurePlatformEpoch", "dismissedChecked"], "only ☢️ and «الكود مغلق» are written");
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); } },
  };
  const mocks = {
    "next/server": { NextRequest, NextResponse },
    "@/lib/server-auth": {
      requirePermissionPrincipal: async (_req, permission) => {
        assert.equal(permission, "students.edit");
        return denied ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : { id: "u1", name: "مشرف" };
      },
    },
    "@/lib/route-helpers": {
      validationError: (message, status = 400) => NextResponse.json({ error: message }, { status }),
      routeErrorResponse: (_error, message) => NextResponse.json({ error: message }, { status: 500 }),
    },
    "@/lib/schema-readiness": { withDatabaseSchema: async (run, model) => { assert.equal(model, "Student"); return run(); } },
    "@/lib/serializable-transaction": { withSerializableTransaction: async (run) => run(tx) },
  };
  const route = compile("src/app/api/students/code-closures/reopen/route.ts", (name) => {
    assert(name in mocks, `unexpected route dependency: ${name}`);
    return mocks[name];
  });
  assert.deepEqual(Object.keys(route).sort(), ["PUT", "dynamic", "runtime"], "a route file exports only route fields");
  const put = async (body) => {
    const res = await route.PUT(new NextRequest("https://teacherpro.test/api/students/code-closures/reopen", { method: "PUT", body: JSON.stringify(body) }));
    return { status: res.status, data: await res.json() };
  };

  reset();
  denied = true;
  assert.equal((await put({ studentId: "s1", expectedEpoch: 3 })).status, 403);
  denied = false;
  assert.equal((await put({ studentId: "", expectedEpoch: 3 })).status, 400);
  assert.equal((await put({ studentId: "s1" })).status, 409, "an episode is required");
  assert.equal((await put({ studentId: "missing", expectedEpoch: 3 })).status, 404);
  assert.equal((await put({ studentId: "s1", expectedEpoch: 2 })).status, 409, "a stale card cannot open the current dismissal");
  assert.equal((await put({ studentId: "active", expectedEpoch: 4 })).status, 409, "only dismissed students");
  assert.equal(rows.get("s1").dismissedChecked, true);
  assert.equal(audits.length, 0);

  const before = { ...rows.get("s1") };
  const opened = await put({ studentId: "s1", expectedEpoch: 3 });
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.data.student, { id: "s1", dismissedChecked: false, dismissedCheckEpoch: 3, closurePlatformEpoch: null });
  assert.deepEqual(rows.get("s1"), { ...before, dismissedChecked: false, closurePlatformEpoch: null }, "status, notice mark and balance are untouched");
  assert.equal(contact.isStudentCodeClosed(rows.get("s1")), false, "☢️ works again");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "فتح كود الطالب المفصول على المنصة");
  assert.deepEqual(JSON.parse(audits[0].details).after, { dismissedChecked: false, closurePlatformEpoch: null });

  assert.equal((await put({ studentId: "s1", expectedEpoch: 3 })).status, 200);
  assert.equal((await put({ studentId: "open", expectedEpoch: 5 })).status, 200);
  assert.equal(audits.length, 1, "opening an open code writes and audits nothing");
  assert.equal(rows.get("open").closurePlatformEpoch, 4, "an older dismissal's mark is left alone");

  // The student story reads the new log line as «انلغى قفل كوده».
  const story = read("src/lib/student-story-audit.ts");
  assert.match(story, /action === "فتح كود الطالب المفصول على المنصة"\) && ownStudent\) \{ push\("code-reopened"\)/);
  console.log("PASS: «فتح الكود» needs edit permission and the current dismissal, clears ☢️ and «الكود مغلق» once with an audit entry, and leaves everything else");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
