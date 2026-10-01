const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");

const root = path.resolve(__dirname, "..");
const compile = (file, requireFn) => {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("module", "exports", "require", output)(module, module.exports, requireFn);
  return module.exports;
};

const format = compile("src/lib/format.ts", () => ({}));
const contact = compile("src/lib/code-closure-contact.ts", (name) => {
  assert.equal(name, "./format");
  return format;
});

// Phone: the platform searches by 00964 followed by the national number.
for (const [input, expected] of [
  ["07705550679", "009647705550679"],
  ["0770 555 0679", "009647705550679"],
  ["+964 770 555 0679", "009647705550679"],
  ["9647705550679", "009647705550679"],
  ["009647705550679", "009647705550679"],
  ["7705550679", "009647705550679"],
  ["٠٧٧٠٥٥٥٠٦٧٩", "009647705550679"],
  ["", ""],
  [null, ""],
  ["123", ""],
]) assert.equal(contact.mzPlatformPhone(input), expected, `phone ${input}`);
assert.equal(contact.MZ_ACTIVE_USERS_URL, "https://www.mz-academy.com/ar/teachers/users/active");
const notice = contact.buildDismissalNotice("يومي 3", "4 من 20");
assert(notice.startsWith("🚨 **تبليغ رسمي**\n\nتم **فصلك وإغلاق الكود الخاص بك من المنصة** بسبب استنفاد الفرص، وذلك نتيجة:"));
assert(notice.includes("**الامتحان:** يومي 3\n**الحالة:** 4 من 20"));
assert(notice.endsWith("حيث تتم مراجعة الحالة ومعالجة المشكلة من خلال القسم حصراً."));
assert(contact.buildDismissalNotice(null, " ").includes("**الامتحان:** [اسم الامتحان]\n**الحالة:** [الدرجة / غياب / غش]"));
assert.equal(contact.telegramNoticeHref("", notice), "", "no chat, no link");
assert.equal(
  contact.telegramNoticeHref("tg://resolve?domain=student_one", "أ b"),
  "tg://resolve?domain=student_one&text=%D8%A3%20b",
);
console.log("PASS: 07… phones become 00964…, the notice keeps the agreed text with exam/result or placeholders, and the Telegram link carries it");

(async () => {
  const rows = new Map();
  const audits = [];
  let denied = false;
  let actor = { id: "u1", name: "موظف" };
  const reset = () => {
    rows.clear();
    audits.length = 0;
    rows.set("s1", { id: "s1", name: "طالب", code: "BIO-1", status: "مفصول", dismissedChecked: false, dismissedCheckEpoch: 3, closurePlatformEpoch: null, closureTelegramEpoch: 2, opportunities: 0 });
    rows.set("active", { id: "active", name: "نشط", code: "BIO-2", status: "نشط", dismissedChecked: false, dismissedCheckEpoch: 4, closurePlatformEpoch: null, closureTelegramEpoch: null, opportunities: 2 });
  };
  const pick = (row, select) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
  const tx = {
    student: {
      findUnique: async ({ where, select }) => (rows.has(where.id) ? pick(rows.get(where.id), select) : null),
      updateMany: async ({ where, data }) => {
        const row = rows.get(where.id);
        if (!row || row.status !== where.status || row.dismissedCheckEpoch !== where.dismissedCheckEpoch) return { count: 0 };
        assert.deepEqual(Object.keys(data).filter((key) => !key.startsWith("closure")), [], "only a contact mark is written");
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
        return denied ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : actor;
      },
    },
    "@/lib/route-helpers": {
      validationError: (message, status = 400) => NextResponse.json({ error: message }, { status }),
      routeErrorResponse: (_error, message) => NextResponse.json({ error: message }, { status: 500 }),
    },
    "@/lib/schema-readiness": { withDatabaseSchema: async (run, model) => { assert.equal(model, "Student"); return run(); } },
    "@/lib/serializable-transaction": { withSerializableTransaction: async (run) => run(tx) },
  };
  const { PUT, dynamic } = compile("src/app/api/students/code-closures/contact/route.ts", (name) => {
    assert(name in mocks, `unexpected route dependency: ${name}`);
    return mocks[name];
  });
  assert.equal(dynamic, "force-dynamic");
  const put = async (body) => {
    const res = await PUT(new NextRequest("https://teacherpro.test/api/students/code-closures/contact", { method: "PUT", body: JSON.stringify(body) }));
    return { status: res.status, data: await res.json() };
  };

  reset();
  denied = true;
  assert.equal((await put({ studentId: "s1", step: "platform", expectedEpoch: 3 })).status, 403);
  assert.equal(rows.get("s1").closurePlatformEpoch, null, "viewers cannot save marks");
  denied = false;

  for (const body of [{ studentId: "", step: "platform", expectedEpoch: 3 }, { studentId: "s1", step: "constructor", expectedEpoch: 3 }, { studentId: "s1", step: "dismissedChecked", expectedEpoch: 3 }]) {
    assert.equal((await put(body)).status, 400);
  }
  assert.equal((await put({ studentId: "s1", step: "platform" })).status, 409, "an episode is required");
  assert.equal((await put({ studentId: "missing", step: "platform", expectedEpoch: 3 })).status, 404);
  assert.equal((await put({ studentId: "s1", step: "platform", expectedEpoch: 2 })).status, 409, "a list from an older dismissal cannot mark the current one");
  assert.equal((await put({ studentId: "active", step: "platform", expectedEpoch: 4 })).status, 409, "only dismissed students");
  assert.equal(audits.length, 0);

  const before = { ...rows.get("s1") };
  const saved = await put({ studentId: "s1", step: "platform", expectedEpoch: 3 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.student, { id: "s1", dismissedCheckEpoch: 3, closurePlatformEpoch: 3, closureTelegramEpoch: 2 });
  assert.deepEqual(rows.get("s1"), { ...before, closurePlatformEpoch: 3 }, "status, closed-code flag and balance are untouched");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "فتح المنصة ونسخ هاتف الطالب المفصول");
  assert.equal(audits[0].userId, "u1");
  assert.deepEqual(JSON.parse(audits[0].details), { studentId: "s1", name: "طالب", code: "BIO-1" });

  assert.equal((await put({ studentId: "s1", step: "platform", expectedEpoch: 3 })).status, 200);
  assert.equal(audits.length, 1, "repeating a done step is idempotent and not audited twice");

  actor = { id: "u2", name: "موظف ثاني" };
  const telegram = await put({ studentId: "s1", step: "telegram", expectedEpoch: 3 });
  assert.equal(telegram.data.student.closureTelegramEpoch, 3, "an older episode's Telegram mark is replaced by this one");
  assert.equal(audits[1].action, "فتح تبليغ الفصل في تليكرام");
  assert.equal(audits[1].userName, "موظف ثاني");
  console.log("PASS: contact marks need edit permission, a valid step and the current dismissal episode; they write only their own column, once, with an audit entry");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
