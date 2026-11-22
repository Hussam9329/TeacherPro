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
const { formatCorrectionDuration, mirmazGradeMoment } = require("../src/lib/mirmaz-holds-client.ts");

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

// The grade's moment is when it was corrected; a grade that came without it counts by its arrival.
assert.equal(mirmazGradeMoment({ correctedAt: lateNight, arrivedAt: afternoon }), lateNight);
assert.equal(mirmazGradeMoment({ correctedAt: null, arrivedAt: afternoon }), afternoon);
assert.equal(formatCorrectionDuration(200), "3:20 د");
assert.equal(formatCorrectionDuration(5), "0:05 د");

// What Mirmaz Pro says about the correction: believed only when it makes sense.
const { readCorrectionTime, correctionTimeData } = require("../src/lib/mirmaz-correction-time.ts");
const now = new Date("2026-11-21T14:00:00.000Z");
const told = readCorrectionTime({ correctedAt: afternoon, durationSeconds: 200 }, now);
assert.equal(told.correctedAt.toISOString(), afternoon);
assert.equal(told.correctionSeconds, 200);
assert.deepEqual(readCorrectionTime({}, now), { correctedAt: null, correctionSeconds: null }, "an older Mirmaz Pro sends neither");
assert.equal(readCorrectionTime({ correctedAt: "2026-11-21T15:00:00.000Z" }, now).correctedAt, null, "not from the future");
assert.equal(readCorrectionTime({ correctedAt: "أمس" }, now).correctedAt, null);
assert.equal(readCorrectionTime({ durationSeconds: -3 }, now).correctionSeconds, null);
assert.equal(readCorrectionTime({ durationSeconds: "200" }, now).correctionSeconds, null);
assert.equal(readCorrectionTime({ durationSeconds: 0 }, now).correctionSeconds, 0);
assert.deepEqual(correctionTimeData({ correctedAt: null, correctionSeconds: null }), {}, "a grade without them never wipes an earlier arrival's");
assert.deepEqual(Object.keys(correctionTimeData(told)), ["correctedAt", "correctionSeconds"]);

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
assert.ok(dialog.includes("withinBaghdadRange(mirmazGradeMoment(hold), range)") && dialog.includes("withinBaghdadRange(mirmazGradeMoment(row), range)"));
assert.equal((dialog.match(/baghdadDateKey\(mirmazGradeMoment\(row\)\)/g) || []).length, 2, "the days follow the same moment as «من / إلى»");
assert.ok(dialog.includes("{correctedText(hold)}وصلت") && dialog.includes("{row.correctedAt && <span>{correctedText(row, \"\")}</span>}"));
assert.ok(dialog.includes("for (const group of rangedGroups) {") && dialog.includes("const groups = rangedGroups.flatMap("));
assert.equal((dialog.match(/type="datetime-local"/g) || []).length, 2, "«من» و«إلى»");
assert.ok(dialog.includes('setRange({ from: "", to: "" });'), "closing the window clears the range");

console.log("PASS: مرماز برو shows the arrival minute on Baghdad's clock and «وصلت من / إلى» filters by it");
