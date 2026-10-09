// A mistaken manual command and its documented undo are hidden together from
// a student's file; anything that does not cancel out exactly stays.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const file = path.join(__dirname, "../src/lib/opportunity-log-pairs.ts");
const mod = { exports: {} };
new Function("module", "exports", "require", ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(mod, mod.exports, require);
const { withoutCancelledManualPairs, cancelledManualPairIds } = mod.exports;
const ids = (logs) => logs.map((log) => log.id);

// BIO-1111 on 3 October: a gift to the wrong group, its undo, the right gift.
const gift = { id: "a", action: "إضافة", amount: 1, appliedAmount: 1, reason: "النطاق: كل الدورات - هدية من استاذ حسن فلاح" };
const undo = { id: "b", action: "خصم", amount: 1, appliedAmount: 1, reason: "تراجع موثق عن إضافة: هدية من استاذ حسن فلاح [undo-ref:a]" };
const again = { id: "c", action: "إضافة", amount: 1, appliedAmount: 1, reason: "هدية من استاذ حسن فلاح" };
assert.deepEqual(ids(withoutCancelledManualPairs([gift, undo, again])), ["c"], "the mistake and its undo are hidden; the real gift stays");
// Linked by reversalOfLogId instead of the marker.
assert.deepEqual(ids(withoutCancelledManualPairs([gift, { ...undo, reason: "تصحيح", reversalOfLogId: "a" }])), []);
// An undo of a deduction.
assert.deepEqual(ids(withoutCancelledManualPairs([
  { id: "d", action: "خصم", amount: 1, appliedAmount: 1 },
  { id: "e", action: "إضافة", amount: 1, appliedAmount: 1, reason: "تراجع موثق عن خصم: سلوك [undo-ref:d]" },
])), []);
// Not the same size: both stay, so the record still adds up.
assert.deepEqual(ids(withoutCancelledManualPairs([
  { ...gift, amount: 2, appliedAmount: 2 }, undo,
])), ["a", "b"]);
// An undo whose original is not in the list, or an exam's automatic row: kept.
assert.deepEqual(ids(withoutCancelledManualPairs([undo])), ["b"]);
assert.deepEqual(ids(withoutCancelledManualPairs([
  { id: "x", action: "خصم تلقائي", amount: 1, examId: "e1" },
  { id: "y", action: "إضافة", amount: 1, reason: "[undo-ref:x]" },
])), ["x", "y"]);
assert.equal(cancelledManualPairIds([gift, undo]).size, 2);
console.log("opportunity log pairs: a mistaken command and its undo are hidden together, nothing else");
