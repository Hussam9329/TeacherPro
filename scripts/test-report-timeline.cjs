const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  file,
);
const {
  buildReportTimelineEvents: timeline,
  reportGradeTimelineDate: gradeDate,
  buildReportOpportunityContext: context,
  reportGradePresentation: presentation,
} = require("../src/lib/student-report-presentation.ts");

const at = (day, time = "12:00:00.000") => `2026-09-${String(day).padStart(2, "0")}T${time}Z`;
const log = (action, day, extra = {}) => ({ action, date: at(day), chapterId: "chapter", ...extra });
const history = [
  log("رصيد إعادة التفعيل", 26, { amount: 1, balanceAfter: 1, reason: "PRIVATE_ADMIN_REASON" }),
  log("إعادة تعيين", 1, { amount: 3, appliedAmount: 0, reason: "تسوية تاريخية: تحويل فصل يدوي PRIVATE_ID" }),
  log("إضافة", 5, { amount: 3, appliedAmount: 2, balanceAfter: 3, reason: "PRIVATE_ADDITION" }),
  log("إعادة تفعيل", 10, { amount: 0, reason: "بعد تعهد الطالب" }),
  log("رصيد إعادة التفعيل", 10, { date: at(10, "12:00:00.400"), amount: 2, reason: "تم تعهد الطالب" }),
  log("خصم", 15, { amount: 2, appliedAmount: 1, balanceAfter: 1, reason: "PRIVATE_MANUAL_DEBIT" }),
  log("خصم", 16, { amount: 1, examId: "PRIVATE_EXAM_ID" }),
  log("خصم تلقائي", 17, { amount: 1 }),
  log("فصل تلقائي", 18, { amount: 0 }),
  log("إضافة", 19, { amount: 2, appliedAmount: 0 }),
  log("إضافة", 20, { amount: 2, chapterId: "other-chapter" }),
  log("إعادة تعيين", 21, { amount: 1, reason: "حماية P2: تثبيت الرصيد دون تغيير بتوجيه المالك" }),
  log("إعادة تفعيل", 26, { amount: 0, balanceAfter: 1, reason: "PRIVATE_ADMIN_REASON" }),
];
const original = JSON.stringify(history);
const events = timeline(history, "chapter");
assert.deepEqual(events.map(event => event.kind), ["reset", "add", "return", "deduct", "return"]);
assert.deepEqual(events.map(event => event.balanceAfter), [3, 3, 2, 1, 1]);
assert.match(events[0].text, /بدأ حساب فرص الفصل برصيد 3 فرص/);
assert.match(events[1].text, /أضافت الإدارة فرصتين — أصبح الرصيد 3/);
assert.match(events[2].text, /تم قبول التعهّد وإعادة تفعيلك برصيد فرصتين/);
assert.match(events[3].text, /خصمت الإدارة فرصة واحدة — أصبح الرصيد 1/);
assert.equal(events[4].text, "أُعيد تفعيلك برصيد فرصة واحدة");
assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|حماية|P2|تلقائي|reason|chapterId|examId/);
for (const event of events) assert.deepEqual(Object.keys(event).sort(), ["balanceAfter", "date", "kind", "text"]);
assert.equal(JSON.stringify(history), original, "history presentation does not mutate its source");

// Repeated real additions remain distinct, even at the same timestamp. A later
// grant does not erase earlier movements from the public timeline.
const additions = [log("إضافة", 5, { amount: 1 }), log("إضافة", 5, { amount: 1 })];
assert.equal(timeline(additions, "chapter").length, 2);
assert.equal(timeline([...additions, log("رصيد إعادة التفعيل", 8, { amount: 1 })], "chapter").length, 3);
assert.equal(timeline([log("إضافة", 5, { amount: 1, chapterId: null })], "chapter").length, 1);
assert.equal(timeline([log("إضافة", 5, { amount: 1 })]).length, 1, "already-scoped callers may omit chapter context");

for (const bad of [
  { amount: -1 }, { amount: 1.5 }, { amount: "bad" }, { amount: Infinity },
  { amount: 2, appliedAmount: -1 }, { amount: 2, appliedAmount: 1.5 },
  { amount: 2, appliedAmount: "bad" }, { amount: 2, date: "bad" },
  { amount: 2, date: new Date(NaN) },
]) assert.deepEqual(timeline([log("إضافة", 5, bad)], "chapter"), []);
assert.deepEqual(timeline([log("رصيد إعادة التفعيل", 5, { amount: 2, balanceAfter: -1 })], "chapter"), []);
assert.equal(timeline([log("إعادة تعيين", 5, { amount: 0, balanceAfter: 0 })], "chapter")[0].balanceAfter, 0);
assert.equal(timeline([log("إعادة تعيين", 5, { amount: 2, appliedAmount: -1, balanceAfter: 2 })], "chapter")[0].balanceAfter, 2);

for (const reason of ["بدون تعهد", "دون التعهد", "لا يوجد تعهد", "لم يتعهد", "لم يتم قبول التعهد", "إلغاء التعهد", "عدم التعهد", "تعهد غير مقبول"]) {
  const result = timeline([log("رصيد إعادة التفعيل", 5, { amount: 1, reason })], "chapter")[0];
  assert.equal(result.text, "أُعيد تفعيلك برصيد فرصة واحدة", reason);
}
assert.match(timeline([log("رصيد بعد تعهد", 5, { amount: 1 })], "chapter")[0].text, /التعهّد.*فرصة واحدة/);
assert.match(timeline([log("إعادة تعيين", 5, { amount: 2, appliedAmount: 0, reason: "تثبيت رصيد بعد تعهد" })], "chapter")[0].text, /التعهّد.*فرصتين/);
assert.match(timeline([log("إضافة", 5, { amount: 1, reason: "تعهد" })], "chapter")[0].text, /التعهّد.*أضافت الإدارة فرصة واحدة/);
assert.equal(timeline([log("إعادة تفعيل", 5, { amount: 0, reason: "بعد تعهد الطالب بفرصتين" })], "chapter")[0].balanceAfter, 2);
assert.equal(timeline([log("إعادة تفعيل", 5, { amount: 0 })], "chapter")[0].balanceAfter, null, "status-only zero is not a zero-balance grant");
assert.equal(timeline([
  log("إعادة تفعيل", 5, { balanceAfter: 1 }),
  log("رصيد إعادة التفعيل", 5, { date: at(5, "12:00:01.001"), amount: 1 }),
], "chapter").length, 2, "unrelated distant events are not silently collapsed");
assert.equal(timeline([
  log("إعادة تفعيل", 5, { balanceAfter: 1 }),
  log("رصيد إعادة التفعيل", 5, { amount: 2 }),
], "chapter").length, 2, "contradictory recorded balances are not silently merged");

const grade = { id: "grade", status: "غائب", createdAt: at(12) };
const exam = { id: "exam", date: at(10), type: "تراكمي", passMark: 50, discountMark: 40 };
const debit = log("خصم تلقائي", 10, { amount: 2, examId: exam.id });
const dismissal = log("فصل تلقائي", 10, { amount: 0, examId: exam.id });
const grant = log("رصيد إعادة التفعيل", 15, {
  amount: 1, balanceAfter: 1, ledgerVersion: 2, settledGradeIds: JSON.stringify([grade.id]),
});
const balanceContext = context([debit, dismissal, grant], "chapter");
const historical = { ...balanceContext, historical: true };
assert.equal(presentation(grade, exam, [debit, dismissal], balanceContext).text, "لا خصم (قبل رصيدك الجديد)", "default callers keep their effective-balance semantics");
assert.deepEqual(presentation(grade, exam, [debit, dismissal], historical), {
  text: "خُصمت فرصتان. سُجّل فصل بسبب هذا الامتحان", tone: "dismissed",
});
assert.equal(presentation(grade, exam, [], historical).text, "لا يوجد خصم مسجّل", "a missing debit is not invented from an absence");
assert.equal(presentation({ ...grade, status: "درجة", score: 20 }, exam, [], historical).text, "لا يوجد خصم مسجّل");
assert.equal(presentation({ ...grade, status: "درجة", score: 90 }, exam, [], historical).text, "لا خصم", "a passing settled result does not suggest a lost debit");
assert.equal(presentation({ ...grade, status: "غش" }, exam, [], historical).text, "لا يوجد خصم مسجّل");
assert.equal(presentation(grade, { ...exam, noDiscount: true }, [], historical).text, "امتحان بدون خصم");
assert.equal(presentation({ ...grade, status: "مجاز" }, exam, [], historical).text, "لا خصم");
assert.equal(presentation(grade, exam, [debit, log("خصم", 16, { amount: 1 })], historical).text, "خُصمت 3 فرص", "history includes both earlier and later recorded debits");

const historicalDismissalContext = { ...historical, studentStatus: "نشط", reactivationDates: [at(15)] };
const pastDismissalText = "خُصمت فرصتان. سُجّل فصل سابقاً بسبب هذا الامتحان";
const currentDismissalText = "خُصمت فرصتان. سُجّل فصل بسبب هذا الامتحان";
assert.deepEqual(presentation(grade, exam, [debit, dismissal], historicalDismissalContext), {
  text: pastDismissalText, tone: "dismissed",
}, "explicit later recovery marks the historical event without losing its deduction or tone");
for (const patch of [
  { studentStatus: "مفصول" }, { studentStatus: "مؤرشف" }, { studentStatus: undefined },
  { reactivationDates: undefined }, { reactivationDates: [] },
  { reactivationDates: [at(9)] }, { reactivationDates: [dismissal.date] },
  { reactivationDates: ["invalid"] },
]) assert.equal(presentation(grade, exam, [debit, dismissal], { ...historicalDismissalContext, ...patch }).text,
  currentDismissalText, "current dismissal wording remains when later recovery is not proved: " + JSON.stringify(patch));
for (const date of [undefined, "", "invalid", new Date(NaN)]) {
  assert.equal(presentation(grade, exam, [debit, { ...dismissal, date }], historicalDismissalContext).text,
    currentDismissalText, "invalid or missing dismissal time prevents historical-order inference");
}
assert.equal(presentation(grade, exam, [debit, dismissal, log("فصل تلقائي", 16, { amount: 0 })], historicalDismissalContext).text,
  currentDismissalText, "a new dismissal after recovery is not marked as old");
assert.equal(presentation(grade, exam, [debit, dismissal, log("فصل تلقائي", 14, { amount: 0 })], historicalDismissalContext).text,
  pastDismissalText, "the return must follow every dismissal attached to the exam");
assert.equal(presentation(grade, exam, [debit, dismissal, log("فصل تلقائي", 16, { amount: 0 })], {
  ...historicalDismissalContext, reactivationDates: [at(15), "invalid", at(17)],
}).text, pastDismissalText, "a later valid return can cover the newest dismissal");
const ordinaryMovements = timeline([log("إضافة", 15, { amount: 1 }), log("إعادة تعيين", 16, { amount: 3 })]);
assert.equal(presentation(grade, exam, [debit, dismissal], {
  ...historicalDismissalContext,
  reactivationDates: ordinaryMovements.filter(event => event.kind === "return").map(event => event.date),
}).text, currentDismissalText, "ordinary added opportunities and resets never establish a return to study");
assert.equal(presentation(grade, exam, [debit, dismissal], {
  ...historicalDismissalContext, settlement: null, historical: false,
}).text, currentDismissalText, "non-historical callers keep their existing wording");
assert.equal(presentation(grade, exam, [dismissal], historicalDismissalContext).text,
  "سُجّل فصل سابقاً بسبب هذا الامتحان", "historical wording does not invent a deduction");

const between = timeline([log("إضافة", 11, { amount: 1 })], "chapter");
assert.equal(gradeDate(grade, exam, between), grade.createdAt, "late-entered result follows an already granted credit");
assert.equal(gradeDate({ ...grade, createdAt: at(9), updatedAt: at(20) }, exam, between), exam.date, "editing a grade never moves its historical event");
assert.equal(gradeDate(grade, exam, timeline([log("خصم", 11, { amount: 1 })])), exam.date, "a debit does not establish a new balance");
assert.equal(gradeDate(grade, exam, timeline([log("إعادة تفعيل", 11, { amount: 0 })])), exam.date, "status-only recovery with unknown balance does not establish a credit");
assert.equal(gradeDate(grade, exam, timeline([log("إعادة تعيين", 11, { amount: 0 })])), grade.createdAt, "a saved reset is an explicit balance boundary");
assert.equal(gradeDate(grade, exam, timeline([log("إضافة", 12, { amount: 1 })])), grade.createdAt, "credit recorded at entry time is already available");
assert.equal(gradeDate(grade, exam, timeline([log("إضافة", 13, { amount: 1 })])), exam.date, "future credits never reorder an earlier result");
assert.equal(gradeDate({ ...grade, createdAt: "bad" }, exam, between), exam.date);
assert.equal(gradeDate(grade, undefined, between), grade.createdAt);
assert.equal(gradeDate({}, undefined, between), "");
console.log("PASS: report timeline preserves dated grants and actual history, merges paired recoveries, uses real amounts, handles delayed results and excludes private data");
