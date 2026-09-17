const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  file,
);
const { buildReportOpportunityContext: context, reportGradeEffect: effect } =
  require("../src/lib/student-report-presentation.ts");

const grade = { id: "settled-grade", status: "غائب", examId: "exam" };
const exam = { id: "exam", date: "2026-09-12" };
const debit = { action: "خصم تلقائي", amount: 2, examId: "exam", chapterId: "chapter", date: "2026-09-12" };
const dismissal = { ...debit, action: "فصل تلقائي", amount: 0 };
const grant = {
  action: "رصيد إعادة التفعيل", amount: 3, balanceAfter: 3,
  chapterId: "chapter", ledgerVersion: 2, date: "2026-09-16T09:00:00Z",
  settledGradeIds: JSON.stringify([grade.id]), reason: "PRIVATE_ADMIN_REASON",
};
const input = [debit, dismissal, grant];
const original = JSON.stringify(input);
const report = context(input, "chapter");
assert.equal(effect(grade, exam, [debit, dismissal], report), "لا يوجد خصم لهذا الامتحان — مشمول بتسوية الرصيد");
assert.deepEqual(report.balanceNotes, [{ text: "أُعيد تفعيلك برصيد 3 من الفرص", date: grant.date }]);
assert.doesNotMatch(JSON.stringify(report.balanceNotes), /PRIVATE|settled-grade/);
assert.equal(JSON.stringify(input), original, "presentation never mutates source records");

const laterManual = { ...debit, action: "خصم", amount: 1, appliedAmount: 1, date: "2026-09-17T12:00:00Z" };
assert.equal(effect(grade, exam, [debit, laterManual], report), "تم خصم فرصة لهذا الامتحان", "manual deductions after recovery still apply");
assert.equal(effect(grade, exam, [debit, { ...laterManual, date: grant.date }], report), "تم خصم فرصة لهذا الامتحان", "same-timestamp command follows engine >= boundary");
assert.equal(effect(grade, exam, [debit, { ...laterManual, date: "2026-09-15" }], report), "لا يوجد خصم لهذا الامتحان — مشمول بتسوية الرصيد");
assert.equal(effect(grade, exam, [debit, { ...laterManual, date: "invalid" }], report), "تم خصم فرصة لهذا الامتحان", "missing evidence cannot suppress a manual deduction");

const reset = { ...grant, action: "إعادة تعيين", amount: 1, balanceAfter: 1 };
const resetContext = context([reset], "chapter");
assert.equal(effect({ ...grade, id: "new-backdated-grade" }, exam, [debit], resetContext), "تم خصم فرصتين لهذا الامتحان", "an old exam date does not settle a later-entered grade");
assert.equal(effect({ status: "غائب" }, exam, [debit], resetContext), "تم خصم فرصتين لهذا الامتحان", "missing grade identity must not infer settlement");
assert.deepEqual(resetContext.balanceNotes, [{ text: "حدّدت الإدارة رصيدك بـ 1 من الفرص", date: reset.date }]);
const tieReset = { ...reset, settledGradeIds: JSON.stringify(["different-grade"]) };
assert.equal(context([tieReset, grant], "chapter").settlement.settledGradeIds.has(grade.id), false, "equal-time reset wins over grant as in the engine");

for (const bad of [
  { ...grant, chapterId: "other-chapter" },
  { ...grant, ledgerVersion: null },
  { ...grant, date: "invalid" },
  { ...grant, date: new Date(NaN) },
  { ...grant, action: "إعادة تفعيل", reason: "" },
  { ...grant, amount: -1, balanceAfter: -1 },
  { ...grant, balanceAfter: -1 },
  { ...grant, balanceAfter: "invalid" },
]) {
  assert.equal(context([bad], "chapter").settlement, null);
}
assert.equal(context([grant]).settlement, null, "missing active chapter is not a license to infer");
for (const malformed of ["bad json", '{}', '["settled-grade",3]', '"settled-grade"', null]) {
  const badLatest = { ...reset, date: "2026-09-17", settledGradeIds: malformed };
  const c = context([grant, badLatest], "chapter");
  assert.equal(c.settlement.settledGradeIds.size, 0, "invalid latest membership never reuses an older grant's IDs");
  assert.equal(effect(grade, exam, [debit], c), "تم خصم فرصتين لهذا الامتحان");
}

const add = { action: "إضافة", amount: 2, appliedAmount: 2, chapterId: "chapter", date: "2026-09-13", reason: "PRIVATE_ADDITION" };
const adds = context([add, { ...add, date: "2026-09-14", appliedAmount: 0 }], "chapter");
assert.equal(adds.settlement, null, "an addition never settles existing deductions");
assert.equal(effect(grade, exam, [debit], adds), "تم خصم فرصتين لهذا الامتحان");
assert.deepEqual(adds.balanceNotes, [{ text: "أضافت الإدارة فرصتين", date: add.date }]);
assert.equal(context([add, grant], "chapter").balanceNotes.length, 1, "superseded addition is not shown as a new-balance addition");
assert.deepEqual(context([grant, { ...add, date: "2026-09-17" }], "chapter").balanceNotes.map(n => n.text), [
  "أُعيد تفعيلك برصيد 3 من الفرص", "أضافت الإدارة فرصتين",
]);
assert.equal(context([{ ...grant, action: "رصيد بعد تعهد", amount: 2, balanceAfter: 2 }], "chapter").balanceNotes[0].text,
  "مُنحت رصيداً قدره 2 من الفرص بعد قبول التعهّد");
assert.equal(context([{ ...reset, reason: "تسوية تاريخية: انتقال إلى فصل جديد" }], "chapter").balanceNotes.length, 0);
assert.equal(context([{ ...reset, reason: "حماية P2: دون تغيير بتوجيه المالك" }], "chapter").balanceNotes.length, 0);
assert.equal(effect(grade, exam, [debit]), "تم خصم فرصتين لهذا الامتحان", "existing callers without context retain their historical presentation");

console.log("PASS: report context respects exact settlement IDs, later manual deductions, untouched backdated grades, active chapter, invalid metadata, factual grant notes and source immutability");
