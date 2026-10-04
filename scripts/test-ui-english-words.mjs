#!/usr/bin/env node
// The screens speak Arabic: no English or technical words in what people read
// (labels, buttons, titles, placeholders, messages), and stored codes such as
// DISMISSED_PENDING or «student» are always shown in words.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failed = false;
const pass = (message) => console.log(`✅ ${message}`);
const fail = (message) => { failed = true; console.error(`❌ ${message}`); };
const must = (condition, message) => (condition ? pass(message) : fail(message));

// Names people know as they are, brands, and file formats.
const ALLOWED = new Set([
  "QR", "PDF", "Excel", "CSV", "HTML", "JSON", "WhatsApp", "Telegram",
  "admin", "username", "Ctrl", "TP", "TeacherPro", "BIO",
  "teacher.admin", // an example account name in the add-user window
]);

const dir = "src/components/teacher-pro";
const files = fs.readdirSync(path.join(root, dir))
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => path.join(dir, file));

const latinWords = (text) => text.match(/\b[A-Za-z][A-Za-z_.]{2,}\b/g) || [];
const hits = [];
for (const file of files) {
  const source = read(file);
  const check = (text) => {
    const plain = text.replace(/\$\{[^}]*\}?/g, " ");
    if (/' \+|\+ '/.test(plain)) return; // HTML built inside export scripts
    for (const word of latinWords(plain)) {
      if (!ALLOWED.has(word)) hits.push(`${file}: «${word}» في «${text.trim().slice(0, 70)}»`);
    }
  };
  // Arabic text between tags that carries an English word.
  for (const match of source.matchAll(/>([^<>{}\n]*[؀-ۿ][^<>{}\n]*)</g)) check(match[1]);
  // A tag whose whole text is English, like >All< or >Checked<.
  for (const match of source.matchAll(/>\s*([A-Za-z][A-Za-z ]{2,}?)\s*<\//g)) check(match[1]);
  // The props people read.
  for (const match of source.matchAll(/(?:label|title|placeholder|description|aria-label|triggerLabel)=\{?["'`]([^"'`]*[؀-ۿ][^"'`]*)["'`]/g)) {
    check(match[1]);
  }
}
must(hits.length === 0, hits.length ? `كلمات إنكليزية ظاهرة:\n  ${hits.join("\n  ")}` : "ماكو كلمات إنكليزية أو برمجية بنصوص الشاشات");

// Words that came back before and must not return.
const screens = files.map(read).join("\n");
for (const word of ["Telegram ID", "Tele Username", ">All<", ">Checked<", ">unChecked<", "Choose File", "تصفير الـ Log"]) {
  must(!screens.includes(word), `«${word}» ما يرجع للواجهة`);
}
must(!read("src/lib/permission-catalog.ts").includes("الـ Log"), "أقسام الصلاحيات كلها بالعربي");

// Stored codes are said in words in the logs and the profile.
const logDisplay = read("src/lib/audit-log-display.ts");
for (const [code, words] of [
  ["DISMISSED_PENDING", "مفصول بانتظار القرار"],
  ["student", "الطالب"],
  ["parent", "ولي الأمر"],
  ["role_admin", "مدير عام"],
]) {
  must(logDisplay.includes(`${code}: "${words}"`), `${code} يظهر «${words}»`);
}
must(logDisplay.includes('target: "الجهة"'), "حقل target يظهر «الجهة»");

if (failed) {
  console.error("\nفشل فحص الكلمات الإنكليزية بالواجهة.");
  process.exit(1);
}
console.log("\nكل نصوص الشاشات بالعربي.");
