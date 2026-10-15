#!/usr/bin/env node
// «اختصارات»: the ready texts of the admin and the supervisors. Only they
// reach the route; adding is safe to send twice, an edit never overwrites a
// newer one, the order is saved only over the order the window saw, and every
// change is recorded.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function createLoader(mocks) {
  const cache = new Map();
  const resolve = (specifier, parent) => {
    const base = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(parent), specifier);
    return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
  };
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const record = { exports: {} };
    cache.set(file, record);
    const localRequire = (specifier) => {
      if (mocks.has(specifier)) return mocks.get(specifier);
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const found = resolve(specifier, file);
        if (found) return load(found);
      }
      return require(specifier);
    };
    new Function("exports", "require", "module", "__filename", "__dirname", compiled)(record.exports, localRequire, record, file, path.dirname(file));
    return record.exports;
  };
  return (relative) => load(path.join(root, relative));
}

class FakeNextResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.headers = init.headers ?? {}; }
  static json(body, init = {}) { return new FakeNextResponse(body, init); }
}

class KnownRequestError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** The TextShortcut table in memory, with the Prisma calls the route makes. */
function createStore() {
  const rows = [];
  const audit = [];
  let clock = Date.parse("2026-10-15T09:00:00.000Z");
  const tick = () => new Date((clock += 1000));
  const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row });
  const sorted = () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  const model = {
    findMany: async ({ select } = {}) => sorted().map((row) => pick(row, select)),
    findUnique: async ({ where, select }) => { const row = rows.find((item) => item.id === where.id); return row ? pick(row, select) : null; },
    findUniqueOrThrow: async (args) => { const row = await model.findUnique(args); if (!row) throw new KnownRequestError("P2025"); return row; },
    count: async () => rows.length,
    aggregate: async () => ({ _max: { sortOrder: rows.length ? Math.max(...rows.map((row) => row.sortOrder)) : null } }),
    create: async ({ data, select }) => {
      const id = data.id ?? `c${rows.length + 1}xxxxxxxx`;
      if (rows.some((row) => row.id === id)) throw new KnownRequestError("P2002");
      const now = tick();
      const row = { createdById: null, createdByName: "", updatedById: null, updatedByName: "", ...data, id, createdAt: now, updatedAt: now };
      rows.push(row);
      return pick(row, select);
    },
    updateMany: async ({ where, data }) => {
      const row = rows.find((item) => item.id === where.id && (!where.updatedAt || item.updatedAt.getTime() === where.updatedAt.getTime()));
      if (!row) return { count: 0 };
      Object.assign(row, data, { updatedAt: tick() });
      return { count: 1 };
    },
    deleteMany: async ({ where }) => {
      const index = rows.findIndex((row) => row.id === where.id);
      if (index < 0) return { count: 0 };
      rows.splice(index, 1);
      return { count: 1 };
    },
  };
  const client = {
    textShortcut: model,
    $executeRaw: async (strings, ...values) => {
      assert.match(strings.join("?"), /UPDATE "TextShortcut" SET "sortOrder" = \? WHERE "id" = \?/);
      const row = rows.find((item) => item.id === values[1]);
      if (row) row.sortOrder = values[0];
      return row ? 1 : 0;
    },
  };
  const db = { ...client, $transaction: async (run) => run(client) };
  return { db, rows, audit, setTime: (row, iso) => { row.updatedAt = new Date(iso); } };
}

const SUPERVISOR = { id: "u-sup", name: "مشرف", username: "sup", isAdmin: false, permissions: ["system.oversight"] };
const EMPLOYEE = { id: "u-emp", name: "موظف", username: "emp", isAdmin: false, permissions: ["students.view"] };

function loadRoute(store, principal) {
  const loader = createLoader(new Map([
    ["next/server", { NextResponse: FakeNextResponse }],
    ["@prisma/client", { Prisma: { PrismaClientKnownRequestError: KnownRequestError } }],
    ["@/lib/db", { db: store.db }],
    ["@/lib/server-auth", {
      getAuthPrincipal: async () => principal,
      oversees: (p) => p.isAdmin || p.permissions.includes("system.oversight"),
    }],
    ["@/lib/schema-readiness", { withDatabaseSchema: (run) => run() }],
    ["@/lib/audit-log-server", { writeAuditLog: async (p, module, action, details) => { store.audit.push({ user: p.id, module, action, details }); } }],
  ]));
  return loader("src/app/api/text-shortcuts/route.ts");
}

const request = (body, url = "http://local/api/text-shortcuts") => ({ url, json: async () => body });

test("only the admin and the supervisors reach «اختصارات»; nothing is read or written for others", async () => {
  const store = createStore();
  const route = loadRoute(store, EMPLOYEE);
  for (const [method, req] of [
    ["GET", request()],
    ["POST", request({ label: "س", text: "ص" })],
    ["PUT", request({ id: "abcdefgh1", label: "س", text: "ص" })],
    ["DELETE", request(null, "http://local/api/text-shortcuts?id=abcdefgh1")],
  ]) {
    const response = await route[method](req);
    assert.equal(response.status, 403, method);
  }
  assert.equal(store.rows.length, 0);
  assert.equal(store.audit.length, 0);
  const signedOut = await loadRoute(store, null).GET(request());
  assert.equal(signedOut.status, 401);
});

test("adding keeps the text as written, goes last, and the same request twice adds one button", async () => {
  const store = createStore();
  const route = loadRoute(store, SUPERVISOR);
  const text = "عزيزي الطالب\nآلية النظام كالآتي:\n  - يتم خصم فرصة لكل رسوب في امتحان تراكمي";
  const first = await route.POST(request({ id: "11111111-aaaa", label: "  شرح   الآلية ", text: `\n${text}\n\n` }));
  assert.equal(first.status, 200);
  assert.equal(first.body.shortcut.label, "شرح الآلية");
  assert.equal(first.body.shortcut.text, text);
  assert.equal(first.body.shortcut.updatedByName, "مشرف");
  const again = await route.POST(request({ id: "11111111-aaaa", label: "شرح الآلية", text }));
  assert.equal(again.status, 200);
  assert.equal(again.body.shortcut.id, "11111111-aaaa");
  const second = await route.POST(request({ id: "22222222-bbbb", label: "الدوام", text: "الدوام يبدأ الساعة ٤" }));
  assert.equal(store.rows.length, 2);
  assert.equal(second.body.shortcut.sortOrder, 1);
  assert.deepEqual(store.audit.map((line) => line.action), ["اضافة اختصار", "اضافة اختصار"]);
  assert.equal(store.audit[0].module, "الاختصارات");

  const list = await route.GET(request());
  assert.deepEqual(list.body.shortcuts.map((row) => row.label), ["شرح الآلية", "الدوام"]);
  assert.equal(list.headers["Cache-Control"], "private, no-store, max-age=0");
});

test("a request sent twice at once still adds one button", async () => {
  const store = createStore();
  const route = loadRoute(store, SUPERVISOR);
  const realFind = store.db.textShortcut.findUnique;
  let race = true;
  // The second copy checks before the first one saved, then loses the insert.
  store.db.textShortcut.findUnique = async (args) => {
    if (race) { race = false; await store.db.textShortcut.create({ data: { id: args.where.id, label: "أ", text: "ب", sortOrder: 0 } }); return null; }
    return realFind(args);
  };
  const response = await route.POST(request({ id: "33333333-cccc", label: "أ", text: "ب" }));
  assert.equal(response.status, 200);
  assert.equal(response.body.shortcut.id, "33333333-cccc");
  assert.equal(store.rows.length, 1);
});

test("empty or too long names and texts are refused before saving", async () => {
  const store = createStore();
  const route = loadRoute(store, SUPERVISOR);
  for (const body of [{ label: "", text: "نص" }, { label: "اسم", text: "   \n " }, { label: "س".repeat(61), text: "نص" }, { label: "اسم", text: "ن".repeat(4001) }]) {
    const response = await route.POST(request(body));
    assert.equal(response.status, 400);
  }
  assert.equal(store.rows.length, 0);
});

test("an edit over a newer change is refused; the same edit sent again succeeds; a deleted button says so", async () => {
  const store = createStore();
  const route = loadRoute(store, SUPERVISOR);
  const { body } = await route.POST(request({ id: "44444444-dddd", label: "قديم", text: "نص قديم" }));
  const loaded = body.shortcut;

  const edited = await route.PUT(request({ id: loaded.id, label: "جديد", text: "نص جديد", expectedUpdatedAt: loaded.updatedAt.toISOString() }));
  assert.equal(edited.status, 200);
  assert.equal(edited.body.shortcut.text, "نص جديد");
  const resent = await route.PUT(request({ id: loaded.id, label: "جديد", text: "نص جديد", expectedUpdatedAt: loaded.updatedAt.toISOString() }));
  assert.equal(resent.status, 200, "a save repeated after a lost answer is not a conflict");

  const stale = await route.PUT(request({ id: loaded.id, label: "ثالث", text: "نص ثالث", expectedUpdatedAt: loaded.updatedAt.toISOString() }));
  assert.equal(stale.status, 409);
  assert.equal(store.rows[0].text, "نص جديد");

  const gone = await route.PUT(request({ id: "missing-1234", label: "س", text: "ص" }));
  assert.equal(gone.status, 404);
  const edits = store.audit.filter((line) => line.action === "تعديل اختصار");
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].details, { before: { label: "قديم", text: "نص قديم" }, after: { label: "جديد", text: "نص جديد" } });
});

test("a new order is saved only over the order the window saw, and leaves «آخر تعديل» alone", async () => {
  const store = createStore();
  const route = loadRoute(store, SUPERVISOR);
  for (const [id, label] of [["aaaaaaaa", "أ"], ["bbbbbbbb", "ب"], ["cccccccc", "ج"]]) await route.POST(request({ id, label, text: label }));
  const before = store.rows.map((row) => row.updatedAt.getTime());

  const moved = await route.PUT(request({ order: ["bbbbbbbb", "aaaaaaaa", "cccccccc"], expectedRevision: "aaaaaaaa,bbbbbbbb,cccccccc" }));
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.body.shortcuts.map((row) => row.id), ["bbbbbbbb", "aaaaaaaa", "cccccccc"]);
  assert.deepEqual(store.rows.map((row) => row.updatedAt.getTime()), before);

  const outdated = await route.PUT(request({ order: ["aaaaaaaa", "bbbbbbbb", "cccccccc"], expectedRevision: "aaaaaaaa,bbbbbbbb,cccccccc" }));
  assert.equal(outdated.status, 409, "someone else ordered them since");
  const missing = await route.PUT(request({ order: ["bbbbbbbb", "aaaaaaaa"], expectedRevision: "bbbbbbbb,aaaaaaaa,cccccccc" }));
  assert.equal(missing.status, 409);
  const repeated = await route.PUT(request({ order: ["bbbbbbbb", "bbbbbbbb", "cccccccc"], expectedRevision: "bbbbbbbb,aaaaaaaa,cccccccc" }));
  assert.equal(repeated.status, 400);
  assert.equal(store.audit.filter((line) => line.action === "ترتيب الاختصارات").length, 1);
});

test("deleting is recorded once and deleting again is not an error", async () => {
  const store = createStore();
  const route = loadRoute(store, SUPERVISOR);
  await route.POST(request({ id: "55555555-eeee", label: "حذف", text: "نص" }));
  const url = "http://local/api/text-shortcuts?id=55555555-eeee";
  assert.equal((await route.DELETE(request(null, url))).status, 200);
  assert.equal((await route.DELETE(request(null, url))).status, 200);
  assert.equal(store.rows.length, 0);
  assert.deepEqual(store.audit.filter((line) => line.action === "حذف اختصار").map((line) => line.details), [{ label: "حذف", text: "نص" }]);
});

test("the dashboard shows «اختصارات» to the admin and the supervisors, and a click copies the text", () => {
  const dashboard = read("src/components/teacher-pro/dashboard.tsx");
  const gate = dashboard.slice(dashboard.indexOf("const canUseTextShortcuts"), dashboard.indexOf("const [textShortcutsOpen"));
  assert.match(gate, /actor\.permissions\?\.includes\("system\.oversight"\)/);
  assert.match(dashboard, /\{canUseTextShortcuts && \(\s*<button[\s\S]*?اختصارات/);
  assert.match(dashboard, /<TextShortcutsDialog open=\{textShortcutsOpen\}/);
  const dialog = read("src/components/teacher-pro/text-shortcuts-dialog.tsx");
  assert.match(dialog, /copyText\(shortcut\.text, button\)/);
  assert.match(dialog, /textShortcutsApi\.edit\(draft\.shortcut, input\)/);
  const api = read("src/lib/api.ts");
  assert.match(api, /expectedUpdatedAt: shortcut\.updatedAt/, "an edit is never queued and replayed later");
  assert.match(api, /apiPut\("text-shortcuts", \{ order, expectedRevision \}\)/);
});

test("the table comes from an additive migration the deploy policy knows", () => {
  const sql = read("prisma/migrations/20261015120000_text_shortcuts/migration.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "TextShortcut"/);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|RENAME|DELETE|UPDATE)\b/i);
  const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
  assert.equal(policy["20261015120000_text_shortcuts"]?.kind, "expand");
  assert.match(read("src/lib/schema-readiness.ts"), /'20261015120000_text_shortcuts'/);
  assert.match(read("package.json"), /test:text-shortcuts/);
});
