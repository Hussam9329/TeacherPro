const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  file,
);

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { parseBaghdadDateTime } = require("../src/lib/baghdad-time.ts");

assert.equal(
  parseBaghdadDateTime("2026-09-14T01:15").toISOString(),
  "2026-09-13T22:15:00.000Z",
  "datetime-local values are stored as the corresponding Baghdad UTC instant",
);

const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260913120000_add_exam_telegram_submission_window/migration.sql",
);
const route = read("src/app/api/exams/route.ts");
const mutationToken = read("src/lib/exam-mutation-token.ts");
const backup = read("src/app/api/backup/route.ts");
const newForm = read("src/components/teacher-pro/exam-new.tsx");
const editForm = read("src/components/teacher-pro/exam-edit-dialog.tsx");
const academicSnapshot = route.slice(
  route.indexOf("function academicExamSnapshot"),
  route.indexOf("function hasAcademicExamChange"),
);

assert.match(schema, /telegramOpenAt\s+DateTime\?/);
assert.match(schema, /telegramCloseAt\s+DateTime\?/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS "telegramOpenAt" TIMESTAMP\(3\)/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS "telegramCloseAt" TIMESTAMP\(3\)/);
assert.doesNotMatch(migration, /\b(?:UPDATE|DEFAULT)\b/i);

assert.match(route, /requireTelegramWindow:\s*true/);
assert.match(route, /telegramOpenAt,\s*\n\s*telegramCloseAt,/);
assert.match(route, /'telegramOpenAt', 'telegramCloseAt'/);
assert.match(route, /data\.telegramOpenAt !== undefined/);
assert.match(route, /data\.telegramCloseAt !== undefined/);
assert.doesNotMatch(academicSnapshot, /telegram(?:Open|Close)At/);

assert.match(mutationToken, /"telegramOpenAt"/);
assert.match(mutationToken, /"telegramCloseAt"/);
assert.match(backup, /const BACKUP_VERSION = 9/);
assert.match(backup, /upsertRecord\(tx\.exam/);

for (const form of [newForm, editForm]) {
  assert.match(form, /نافذة تسليم الإجابات عبر تيليجرام/);
  assert.match(form, /telegramOpenAt/);
  assert.match(form, /telegramCloseAt/);
}
// The create screen deliberately omits explanatory prose. Keep the actual
// required time controls and their error associations as the UI contract.
assert.match(newForm, /requireTelegramWindow:\s*true/);
for (const suffix of ["telegram-open-at", "telegram-close-at"]) {
  assert.ok(newForm.includes(`${suffix}-error`));
}
assert.doesNotMatch(newForm, /telegram-window-help/);
assert.match(editForm, /امسحهما معاً لتعطيل التسليم عبر تيليجرام/);

console.log("Telegram exam submission-window integrity checks passed.");
