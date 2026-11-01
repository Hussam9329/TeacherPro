// ☢️ asks the «TeacherPro · مرماز بالخلفية» userscript to open the platform in
// a background tab, and opens a normal tab when no script answers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const compile = (file, requireFn) => {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("module", "exports", "require", output)(module, module.exports, requireFn);
  return module.exports;
};

const opened = [];
const toasts = [];
global.window = { open: (...args) => opened.push(args) };
global.document = new EventTarget();
const contact = {
  mzPlatformPhone: (phone) => (phone ? "009647705550679" : ""),
  mzCodeActionUrl: (action) => `https://www.mz-academy.com/ar/teachers/users/active#tp-do=${action}`,
  copyText: async () => true,
};
const open = compile("src/lib/code-closure-open.ts", (name) => {
  if (name === "@/lib/code-closure-contact") return contact;
  if (name === "@/lib/user-toast") return { toast: { success: (m) => toasts.push(m), error: (m) => toasts.push(m) } };
  throw new Error(`unexpected dependency: ${name}`);
});
const student = { name: "امنه", phone: "07705550679" };

// No userscript: a normal new tab, as before.
open.openMzCodePage(student, "close", {});
assert.deepEqual(opened, [["https://www.mz-academy.com/ar/teachers/users/active#tp-do=close", "_blank", "noopener,noreferrer"]]);

// The userscript, written as installed: it answers, so TeacherPro opens nothing itself.
const script = fs.readFileSync(path.join(root, "docs/userscripts/teacherpro-mirmaz-background.user.js"), "utf8");
assert.match(script, /@match\s+https:\/\/teacherpro-eight\.vercel\.app\/\*/);
assert.match(script, /@grant\s+GM_openInTab/);
assert(script.includes(`"${open.MZ_BACKGROUND_TAB_EVENT}"`), "the script listens to the event TeacherPro sends");
const tabs = [];
new Function("GM_openInTab", "document", script)((url, options) => tabs.push([url, options]), global.document);
open.openMzCodePage(student, "open", {});
assert.deepEqual(tabs, [["https://www.mz-academy.com/ar/teachers/users/active#tp-do=open", { active: false, insert: true, setParent: true }]]);
assert.equal(opened.length, 1, "with the script, no foreground tab is opened");

// The script opens the platform only.
const event = new CustomEvent(open.MZ_BACKGROUND_TAB_EVENT, { detail: "https://evil.example/", cancelable: true });
assert.equal(global.document.dispatchEvent(event), true, "another address is left to TeacherPro");
assert.equal(tabs.length, 1);

setTimeout(() => {
  assert(toasts.includes("نُسخ رقم الطالب 009647705550679"), "the phone is still copied");
  console.log("PASS: ☢️ opens the platform behind TeacherPro through the userscript, a normal tab without it, and the script opens mz-academy only");
}, 0);
