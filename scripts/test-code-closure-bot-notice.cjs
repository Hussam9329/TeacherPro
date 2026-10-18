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
const contact = compile("src/lib/code-closure-contact.ts", () => format);
const dismissal = compile("src/lib/code-closure-dismissal.ts", () => ({}));
const bot = compile("src/lib/telegram-bot.ts", () => ({}));

// The notice in Telegram's HTML mode: bold stays bold, nothing else is markup.
const html = contact.dismissalNoticeHtml(contact.buildDismissalNotice("يومي <3> & نصف", "17 من 50"));
assert(html.startsWith("🚨 <b>تبليغ رسمي</b>\n\nتم <b>فصلك وإغلاق الكود الخاص بك من المنصة</b>"));
assert(html.includes("<b>الامتحان:</b> يومي &lt;3&gt; &amp; نصف\n<b>الحالة:</b> 17 من 50"));
assert(html.includes("<b>@hf_chances</b>") && !html.includes("**"));

assert.equal(bot.telegramChatId("123456789"), "123456789");
for (const bad of ["@student", "-100123456", "0123", "12", "", null, "12a45"]) assert.equal(bot.telegramChatId(bad), "", `not a chat id: ${bad}`);
assert.equal(bot.telegramBotToken({ TELEGRAM_BOT_TOKEN: ' "123:abc" ' }), "123:abc");
assert.equal(bot.telegramBotToken({}), "");
for (const [status, description, reason] of [
  [403, "Forbidden: bot was blocked by the user", "blocked"],
  [403, "Forbidden: bot can't initiate conversation with a user", "not_started"],
  [403, "Forbidden: user is deactivated", "deactivated"],
  [400, "Bad Request: chat not found", "not_started"],
  [429, "Too Many Requests: retry after 5", "rate_limited"],
  [401, "Unauthorized", "bad_token"],
  [500, "Internal", "failed"],
]) assert.equal(bot.classifyTelegramFailure(status, description), reason, description);
console.log("PASS: the notice becomes Telegram HTML, only numeric chat ids are used, and Telegram's refusals are read into reasons");

(async () => {
  // sendMessage itself: the request Telegram receives, and its answers.
  const calls = [];
  const fakeFetch = (reply) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return reply(); };
  const ok = await bot.sendTelegramMessage({ token: "T", chatId: "555", html: "<b>x</b>", fetch: fakeFetch(() => new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }))) });
  assert.deepEqual(ok, { ok: true, messageId: 9 });
  assert.equal(calls[0].url, "https://api.telegram.org/botT/sendMessage");
  assert.deepEqual(calls[0].body, { chat_id: "555", text: "<b>x</b>", parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  const limited = await bot.sendTelegramMessage({ token: "T", chatId: "555", html: "x", fetch: fakeFetch(() => new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } }), { status: 429 })) });
  assert.equal(limited.reason, "rate_limited");
  assert.equal(limited.retryAfter, 7);
  const down = await bot.sendTelegramMessage({ token: "T", chatId: "555", html: "x", fetch: async () => { throw new Error("offline"); } });
  assert.equal(down.reason, "failed");

  // The route.
  let rows, audits, telegramReply, chatRows, sends, denied, env;
  const reset = () => {
    rows = new Map([
      ["s1", { id: "s1", name: "امنه", code: "BIO-1", status: "مفصول", telegram: "@user", dismissedCheckEpoch: 3, closureTelegramEpoch: null, dismissedChecked: false, opportunities: 0, dismissalReason: "درجة فصل (17): نصف فاينل",
        opportunityLogs: [{ action: "فصل تلقائي", reason: "تلقائي: درجة فصل (17): نصف فاينل", date: new Date("2026-10-17"), examId: "e1", exam: { name: "الفصل الثالث - نصف فاينل", fullMark: 50 } }] }],
      ["noexam", { id: "noexam", name: "ب", code: "BIO-2", status: "مفصول", telegram: "777777", dismissedCheckEpoch: 1, closureTelegramEpoch: null, dismissalReason: null, opportunityLogs: [] }],
      ["active", { id: "active", name: "ج", code: "BIO-3", status: "نشط", telegram: "888888", dismissedCheckEpoch: 1, closureTelegramEpoch: null, dismissalReason: null, opportunityLogs: [] }],
    ]);
    audits = [];
    sends = [];
    chatRows = [{ telegram_chat_id: "123456789" }];
    telegramReply = { ok: true, messageId: 1 };
    denied = false;
    env = "123:token";
  };
  const auditLog = {
    findMany: async ({ where }) => audits.filter((row) => row.module === where.module && row.action === where.action && row.details.includes(where.details.contains)),
    create: async ({ data }) => { const row = { id: `a${audits.length + 1}`, ...data }; audits.push(row); return { id: row.id }; },
    update: async ({ where, data }) => { Object.assign(audits.find((row) => row.id === where.id), data); },
  };
  const student = {
    findUnique: async ({ where }) => rows.get(where.id) ?? null,
    updateMany: async ({ where, data }) => {
      const row = rows.get(where.id);
      if (!row || row.status !== where.status || row.dismissedCheckEpoch !== where.dismissedCheckEpoch) return { count: 0 };
      assert.deepEqual(Object.keys(data), ["closureTelegramEpoch"], "only the Telegram step is marked");
      Object.assign(row, data);
      return { count: 1 };
    },
  };
  const db = {
    student,
    auditLog,
    grade: { findFirst: async ({ where }) => (where.studentId === "s1" && where.examId === "e1" ? { status: "درجة", score: 17 } : null) },
    $queryRaw: async (strings, ...values) => {
      assert(strings.join("?").includes("correction.telegram_exam_submissions"));
      assert.deepEqual(values, ["s1"]);
      if (chatRows instanceof Error) throw chatRows;
      return chatRows;
    },
  };
  const mocks = {
    "next/server": { NextRequest, NextResponse },
    "@/lib/db": { db },
    "@/lib/server-auth": { requirePermissionPrincipal: async (_req, permission) => { assert.equal(permission, "students.edit"); return denied ? NextResponse.json({ error: "no" }, { status: 403 }) : { id: "u1", name: "موظف" }; } },
    "@/lib/route-helpers": {
      validationError: (message, status = 400) => NextResponse.json({ error: message }, { status }),
      routeErrorResponse: (_error, message) => NextResponse.json({ error: message }, { status: 500 }),
    },
    "@/lib/schema-readiness": { withDatabaseSchema: async (run) => run() },
    "@/lib/serializable-transaction": { withSerializableTransaction: async (run) => run({ student, auditLog }) },
    "@/lib/code-closure-contact": contact,
    "@/lib/code-closure-dismissal": dismissal,
    "@/lib/telegram-bot": {
      ...bot,
      telegramBotToken: () => env,
      sendTelegramMessage: async (input) => { sends.push(input); return telegramReply; },
    },
  };
  const { POST, dynamic } = compile("src/app/api/students/code-closures/bot-notice/route.ts", (name) => {
    assert(name in mocks, `unexpected route dependency: ${name}`);
    return mocks[name];
  });
  assert.equal(dynamic, "force-dynamic");
  const post = async (body) => {
    const res = await POST(new NextRequest("https://teacherpro.test/api/students/code-closures/bot-notice", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, data: await res.json() };
  };

  reset();
  denied = true;
  assert.equal((await post({ studentId: "s1", expectedEpoch: 3 })).status, 403);
  denied = false;
  assert.equal((await post({ studentId: "", expectedEpoch: 3 })).status, 400);
  assert.equal((await post({ studentId: "s1" })).status, 409);
  env = "";
  assert.equal((await post({ studentId: "s1", expectedEpoch: 3 })).status, 503, "no bot token: nothing is sent");
  env = "123:token";
  assert.equal((await post({ studentId: "missing", expectedEpoch: 3 })).status, 404);
  assert.equal((await post({ studentId: "s1", expectedEpoch: 2 })).status, 409, "an older list cannot send for the current dismissal");
  assert.equal((await post({ studentId: "active", expectedEpoch: 1 })).status, 409, "only dismissed students");
  assert.equal((await post({ studentId: "noexam", expectedEpoch: 1 })).status, 422, "an unknown exam or result is never sent with placeholders");
  assert.equal(sends.length, 0);
  assert.equal(audits.length, 0);

  const sent = await post({ studentId: "s1", expectedEpoch: 3 });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.sent, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].chatId, "123456789", "the chat id comes from Correction's submissions when the student has only a username");
  assert.equal(sends[0].token, "123:token");
  assert(sends[0].html.includes("<b>الامتحان:</b> الفصل الثالث - نصف فاينل\n<b>الحالة:</b> 17 من 50"), "the server builds the notice from the dismissing exam and grade");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, dismissal.BOT_NOTICE_SENT_ACTION);
  assert.deepEqual(dismissal.readBotNoticeDetails(audits[0].details), { studentId: "s1", epoch: 3 });
  assert.equal(rows.get("s1").closureTelegramEpoch, 3, "the card's Telegram step is marked done");
  assert.equal(rows.get("s1").status, "مفصول");

  const again = await post({ studentId: "s1", expectedEpoch: 3 });
  assert.equal(again.status, 409, "the same dismissal is never sent twice");
  assert.equal(sends.length, 1);

  // A refusal is recorded but does not count as sent, so it can be retried.
  reset();
  telegramReply = { ok: false, reason: "not_started", description: "Forbidden: bot can't initiate conversation with a user" };
  const refused = await post({ studentId: "s1", expectedEpoch: 3 });
  assert.equal(refused.status, 422);
  assert(refused.data.error.includes("لم يبدأ محادثة مع البوت"));
  assert.equal(audits[0].action, dismissal.BOT_NOTICE_FAILED_ACTION);
  assert.equal(rows.get("s1").closureTelegramEpoch, null, "a refused notice does not mark the step");
  telegramReply = { ok: true, messageId: 2 };
  assert.equal((await post({ studentId: "s1", expectedEpoch: 3 })).status, 200, "after a refusal it can be sent again");

  // A numeric id saved on the student is used directly; no id at all is explained.
  reset();
  rows.get("s1").telegram = "987654321";
  chatRows = new Error("must not be read");
  assert.equal((await post({ studentId: "s1", expectedEpoch: 3 })).status, 200);
  assert.equal(sends[0].chatId, "987654321");
  reset();
  chatRows = [];
  const unknown = await post({ studentId: "s1", expectedEpoch: 3 });
  assert.equal(unknown.status, 422);
  assert.equal(sends.length, 0);
  assert.equal(audits.length, 0);
  reset();
  chatRows = new Error('relation "correction.telegram_exam_submissions" does not exist');
  assert.equal((await post({ studentId: "s1", expectedEpoch: 3 })).status, 422, "a database without Correction's table is not an error");
  console.log("PASS: the bot notice needs edit permission, a token, the current dismissal and a known exam/result; it finds the chat id, sends once, records it, marks the step, and explains refusals");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
