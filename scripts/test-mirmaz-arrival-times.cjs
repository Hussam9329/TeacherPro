// «مرماز برو»: every grade shows when it arrived, to the minute on Baghdad's
// clock, and «وصلت من / إلى» keeps only what arrived inside the range.
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
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};

const { withinBaghdadRange } = require("../src/lib/baghdad-time-range.ts");
const { formatBaghdadDateTime } = require("../src/lib/baghdad-time.ts");

// 21:30 UTC on the 20th is 00:30 on the 21st in Baghdad.
const lateNight = "2026-11-20T21:30:00.000Z";
const afternoon = "2026-11-21T13:35:00.000Z"; // 16:35 Baghdad

assert.equal(withinBaghdadRange(afternoon, { from: "", to: "" }), true, "no range: everything");
assert.equal(withinBaghdadRange(lateNight, { from: "2026-11-21T00:00", to: "" }), true, "read on Baghdad's clock, not UTC");
assert.equal(withinBaghdadRange(lateNight, { from: "", to: "2026-11-20T23:59" }), false);
assert.equal(withinBaghdadRange(afternoon, { from: "2026-11-21T16:35", to: "2026-11-21T16:35" }), true, "both ends are included, to the minute");
assert.equal(withinBaghdadRange(afternoon, { from: "2026-11-21T16:36", to: "" }), false);
assert.equal(withinBaghdadRange(afternoon, { from: "", to: "2026-11-21T16:34" }), false);
assert.equal(withinBaghdadRange(afternoon, { from: "2026-11-21T09:00", to: "2026-11-21T18:00" }), true);
assert.equal(withinBaghdadRange("", { from: "2026-11-21T09:00", to: "" }), false, "an unknown moment is outside any range");
assert.equal(withinBaghdadRange(null, { from: "", to: "" }), true);
assert.match(formatBaghdadDateTime(afternoon), /4:35/, "the time shows on Baghdad's clock");

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const dialog = read("src/components/teacher-pro/mirmaz-pro-dialog.tsx");
const route = read("src/app/api/mirmaz-holds/route.ts");

// One rule for «وصلت» on the server, for «كل الدرجات» and the hold lists.
assert.equal((route.match(/holdArrivedAt\(hold\)\.toISOString\(\)/g) || []).length, 2);
assert.ok(route.includes('if (hold.status === "SAVED") return hold.resolvedAt ?? hold.updatedAt;'));
assert.ok(route.includes('return hold.status === "PENDING" ? hold.updatedAt : hold.createdAt;'));

// The window shows the minute and filters every view by it; the days and numbers follow the range.
assert.ok(dialog.includes("وصلت {formatBaghdadDateTime(row.arrivedAt, \"\")}"));
assert.ok(dialog.includes("وصلت {formatBaghdadDateTime(hold.arrivedAt, \"\")}"));
assert.ok(dialog.includes("withinBaghdadRange(hold.arrivedAt, range)") && dialog.includes("withinBaghdadRange(row.arrivedAt, range)"));
assert.ok(dialog.includes("for (const group of rangedGroups) {") && dialog.includes("const groups = rangedGroups.flatMap("));
assert.equal((dialog.match(/type="datetime-local"/g) || []).length, 2, "«من» و«إلى»");
assert.ok(dialog.includes('setRange({ from: "", to: "" });'), "closing the window clears the range");

console.log("PASS: مرماز برو shows the arrival minute on Baghdad's clock and «وصلت من / إلى» filters by it");
