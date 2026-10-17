const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const extensionDir = path.join(root, "extensions/mirmaz-code-closer");
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
const closer = require(path.join(extensionDir, "content.js"));

// The extension runs only on the platform, with no extra permissions.
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.permissions, undefined, "no extension permissions");
assert.deepEqual(manifest.content_scripts.map((script) => script.js), [["content.js"]]);
assert(manifest.content_scripts[0].matches.every((match) => /^https:\/\/(www\.)?mz-academy\.com\/\*$/.test(match)), "only the platform's pages");
console.log("PASS: the extension is a plain content script on mz-academy.com, with no permissions");

// TeacherPro's link and the extension agree on the request.
const link = new URL(contact.mzCloseCodeUrl(contact.mzPlatformPhone("0770 555 0679")));
assert.equal(`${link.origin}${link.pathname}`, contact.MZ_ACTIVE_USERS_URL);
assert.match(link.pathname, /\/teachers\/users\/active$/, "the page the extension acts on");
assert.equal(closer.phoneFromHash(link.hash), "009647705550679");
for (const hash of ["", "#", "#tp-close=", "#tp-close=07705550679", "#tp-close=00964770555067912345", "#tp-close=009647705550679x", "#other=009647705550679"]) {
  assert.equal(closer.phoneFromHash(hash), "", `no request from ${hash || "an empty hash"}`);
}
assert.equal(closer.phoneFromHash("#a=1&tp-close=009647705550679"), "009647705550679");
console.log("PASS: the danger button's link carries the 00964… phone and the extension reads exactly that, nothing else");

// The search matches part of a number, so only an exact phone is chosen.
for (const [input, expected] of [
  ["009647705550679", "7705550679"],
  ["9647705550679", "7705550679"],
  ["07705550679", "7705550679"],
  ["٠٠٩٦٤٧٧٠٥٥٥٠٦٧٩", "7705550679"],
  ["00964770038555", "770038555"],
  ["", ""],
  [null, ""],
]) assert.equal(closer.nationalNumber(input), expected, `national number of ${input}`);
const planned = closer.planRows([
  { key: "1:10", mobile: "009647705550679", active: true },
  { key: "1:11", mobile: "07705550679", active: false },
  { key: "2:10", mobile: "0096477055506790", active: true },
], "009647705550679");
assert.deepEqual(planned.map((row) => row.exact), [true, true, false], "a longer number that contains the phone is not the student");
assert.deepEqual(closer.planRows([{ key: "1:10", mobile: "", active: true }], "").map((row) => row.exact), [false]);
console.log("PASS: rows are matched by the national number, whatever form the platform stored it in");

// A request is used once and only while fresh.
const now = Date.UTC(2026, 9, 17, 12);
assert.equal(closer.isFreshRequest({ phone: "009647705550679", at: now - 60_000 }, now), true);
assert.equal(closer.isFreshRequest({ phone: "009647705550679", at: now - closer.REQUEST_MAX_AGE_MS - 1 }, now), false, "an old request is ignored");
assert.equal(closer.isFreshRequest({ phone: "009647705550679", at: now + 1 }, now), false);
for (const broken of [null, {}, { phone: "", at: now }, { phone: "009647705550679" }, { phone: 9647705550679, at: now }]) {
  assert.equal(closer.isFreshRequest(broken, now), false);
}
const source = fs.readFileSync(path.join(extensionDir, "content.js"), "utf8");
assert.match(source, /sessionStorage\.removeItem\(REQUEST_KEY\)/, "a reload never asks again");
assert.match(source, /history\.replaceState\(/, "the phone leaves the address bar");
assert.match(source, /if \(!row \|\| !row\.active\) continue;/, "a row is clicked only while the platform shows it on");
assert.doesNotMatch(source, /innerHTML\s*=/, "platform text is never parsed as HTML");
console.log("PASS: a request is fresh for ten minutes, used once, and a closed row is never toggled back on");
