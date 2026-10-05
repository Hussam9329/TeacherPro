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
  reportGradeTimelineDates: gradeDates,
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
assert.deepEqual(events.map(event => event.balanceAfter), [3, null, 2, null, 1]);
assert.match(events[0].text, /بدأ حساب فرص الفصل برصيد 3 فرص/);
assert.equal(events[1].text, "سُجّل منح فرصتين");
assert.match(events[2].text, /تم قبول التعهّد وإعادة تفعيلك برصيد فرصتين/);
assert.equal(events[3].text, "خصمت الإدارة فرصة واحدة");
assert.equal(events[4].text, "أُعيد تفعيلك برصيد فرصة واحدة");
assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|حماية|P2|تلقائي|reason|chapterId|examId/);
for (const event of events) assert.deepEqual(Object.keys(event).sort(), ["balanceAfter", "date", "kind", "text"]);
assert.equal(JSON.stringify(history), original, "history presentation does not mutate its source");

const cappedCredit = log("إضافة", 18, {
  id: "private-credit-command", studentId: "private-student", ledgerVersion: 2, amount: 2, appliedAmount: 2,
  balanceBefore: 0, balanceAfter: 2, reason: "تعهد PRIVATE_ADMIN_REASON",
});
const projectedCappedEffect = {
  studentId: "private-student", chapterId: "chapter", logId: "private-credit-command",
  balanceBefore: 2, balanceAfter: 3, amount: 1, cap: 3,
};
const cappedInputs = JSON.stringify({ cappedCredit, projectedCappedEffect });
const projectedCappedEvent = timeline([cappedCredit], "chapter", [projectedCappedEffect])[0];
assert.equal(projectedCappedEvent.text, "بعد قبول التعهّد، أضافت الإدارة فرصة واحدة — ارتفع الرصيد من 2 إلى 3 (الحد الأعلى لفرص الفصل)");
assert.equal(projectedCappedEvent.balanceAfter, 3, "public balance follows the evaluated command effect rather than an old saved snapshot");
assert.equal(projectedCappedEvent.kind, "add");
assert.deepEqual(Object.keys(projectedCappedEvent).sort(), ["balanceAfter", "date", "kind", "text"]);
assert.doesNotMatch(JSON.stringify(projectedCappedEvent), /private-|PRIVATE_|studentId|chapterId|logId|cap|reason/);
assert.equal(JSON.stringify({ cappedCredit, projectedCappedEffect }), cappedInputs, "projected presentation never rewrites source ledgers or calculation evidence");

const ordinaryCredit = { ...cappedCredit, id: "ordinary-credit", amount: 1, appliedAmount: 1, balanceBefore: 2, balanceAfter: 3, reason: "PRIVATE_ADMIN_REASON" };
const ordinaryEffect = { ...projectedCappedEffect, logId: ordinaryCredit.id, balanceBefore: 0, balanceAfter: 1, amount: 1 };
assert.equal(timeline([ordinaryCredit], "chapter", [ordinaryEffect])[0].text, "أضافت الإدارة فرصة واحدة — أصبح الرصيد 1");
const staleFallback = timeline([cappedCredit], "chapter");
for (const patch of [
  { studentId: "other-student" }, { chapterId: "other-chapter" }, { logId: "other-command" },
  { amount: -1 }, { amount: 1.5 }, { balanceBefore: -1 }, { balanceAfter: 99 },
  { amount: 2 }, { cap: 2 },
]) {
  assert.deepEqual(timeline([cappedCredit], "chapter", [{ ...projectedCappedEffect, ...patch }]), staleFallback,
    "unrelated or invalid projection must not supply another command's actual balance: " + JSON.stringify(patch));
}
assert.deepEqual(timeline([cappedCredit], "chapter", [
  { ...projectedCappedEffect, studentId: "other-student", balanceBefore: 0, balanceAfter: 1 },
  { ...projectedCappedEffect, chapterId: "other-chapter", balanceBefore: 0, balanceAfter: 1 },
  projectedCappedEffect,
]), [projectedCappedEvent], "scoping finds the exact student/chapter/log command even when unrelated effects come first");

assert.deepEqual(timeline([{ ...cappedCredit, ledgerVersion: undefined }], "chapter", [projectedCappedEffect]), staleFallback, "legacy commands do not consume versioned calculation evidence");
assert.deepEqual(timeline([cappedCredit], "chapter", [projectedCappedEffect, projectedCappedEffect]), staleFallback, "ambiguous duplicate projections cannot establish one factual balance");
assert.equal(staleFallback[0].balanceAfter, null, "without evaluated evidence an old additive balance must not be published as current history");
assert.equal(staleFallback[0].text, "بعد قبول التعهّد، سُجّل منح فرصتين");
assert.equal(timeline([cappedCredit], "chapter", undefined, 3)[0].text, "بعد قبول التعهّد، سُجّل منح فرصتين (بحدّ أقصى 3 للرصيد)");
assert.equal(timeline([ordinaryCredit], "chapter", undefined, 3)[0].text, "سُجّل منح فرصة واحدة (بحدّ أقصى 3 للرصيد)");
const projectedFullBalance = { ...projectedCappedEffect, amount: 0, balanceBefore: 3, balanceAfter: 3 };
const fullBalanceEvent = timeline([cappedCredit], "chapter", [projectedFullBalance])[0];
assert.equal(fullBalanceEvent.text, "بعد قبول التعهّد، بقي رصيدك مكتملًا عند 3 فرص (الحد الأعلى لفرص الفصل)");
assert.equal(fullBalanceEvent.balanceAfter, 3);
assert.equal(timeline([{ ...cappedCredit, reason: "PRIVATE_REASON" }], "chapter", [projectedFullBalance])[0].text, "بقي رصيدك مكتملًا عند 3 فرص (الحد الأعلى لفرص الفصل)");
assert.equal(timeline([cappedCredit], "chapter", [projectedFullBalance]).length, 1, "a recorded grant capped to no change keeps an honest explanatory row");

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
assert.match(timeline([log("إضافة", 5, { amount: 1, reason: "تعهد" })], "chapter")[0].text, /التعهّد.*سُجّل منح فرصة واحدة/);
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
  text: "خُصمت فرصتان وفُصلت بسبب هذا الامتحان", tone: "dismissed",
});
assert.equal(presentation(grade, exam, [], historical).text, "لا يوجد خصم مسجّل", "a missing debit is not invented from an absence");
assert.equal(presentation({ ...grade, status: "درجة", score: 20 }, exam, [], historical).text, "لا يوجد خصم مسجّل");
assert.equal(presentation({ ...grade, status: "درجة", score: 90 }, exam, [], historical).text, "لا خصم", "a passing settled result does not suggest a lost debit");
assert.equal(presentation({ ...grade, status: "غش" }, exam, [], historical).text, "لا يوجد خصم مسجّل");
assert.equal(presentation(grade, { ...exam, noDiscount: true }, [], historical).text, "امتحان بدون خصم");
assert.equal(presentation({ ...grade, status: "مجاز" }, exam, [], historical).text, "لا خصم");
assert.equal(presentation(grade, exam, [debit, log("خصم", 16, { amount: 1 })], historical).text, "خُصمت 3 فرص", "history includes both earlier and later recorded debits");

// The dismissal line tells what happened at the time. Today's status and any
// later return, credit or reset never change it (a return is its own line).
const dismissalText = "خُصمت فرصتان وفُصلت بسبب هذا الامتحان";
for (const patch of [
  {}, { studentStatus: "نشط" }, { studentStatus: "مفصول" }, { studentStatus: "مؤرشف" },
  { reactivationDates: [at(15)] }, { reactivationDates: [at(9)] }, { reactivationDates: ["invalid"] },
]) assert.equal(presentation(grade, exam, [debit, dismissal], { ...historical, ...patch }).text,
  dismissalText, "fixed dismissal wording: " + JSON.stringify(patch));
for (const date of [undefined, "", "invalid", new Date(NaN)]) {
  assert.equal(presentation(grade, exam, [debit, { ...dismissal, date }], historical).text, dismissalText);
}
assert.equal(presentation(grade, exam, [debit, dismissal, log("فصل تلقائي", 16, { amount: 0 })], historical).text, dismissalText);
assert.equal(presentation(grade, exam, [debit, dismissal], { ...historical, settlement: null, historical: false }).text,
  dismissalText, "non-historical callers use the same wording");
assert.deepEqual(presentation(grade, exam, [dismissal], historical), { text: "فُصلت بسبب هذا الامتحان", tone: "dismissed" },
  "the wording does not invent a deduction");
assert.equal(presentation(grade, exam, [debit, dismissal], { ...historical, audience: "staff" }).text,
  "خُصمت فرصتان وفُصل الطالب بسبب هذا الامتحان", "staff screens name the student instead of addressing them");

const between = timeline([log("إضافة", 11, { amount: 1 })], "chapter");
assert.equal(gradeDate(grade, exam, between), exam.date, "a later-day credit never moves an older exam to its entry day");
const sameDayCredit = timeline([log("إضافة", 10, { date: at(10, "13:00:00.000"), amount: 1 })]);
assert.equal(gradeDate(grade, exam, sameDayCredit), sameDayCredit[0].date, "same-day protection pins the grade to the credit time, not delayed entry");
assert.equal(gradeDate({ ...grade, createdAt: at(10, "12:30:00.000"), updatedAt: at(20) }, exam, sameDayCredit), exam.date, "editing a grade never moves its historical event after a later same-day credit");
assert.equal(gradeDate(grade, exam, timeline([log("خصم", 10, { date: at(10, "13:00:00.000"), amount: 1 })])), exam.date, "a debit does not establish a new balance");
assert.equal(gradeDate(grade, exam, timeline([log("إعادة تفعيل", 10, { date: at(10, "13:00:00.000"), amount: 0 })])), exam.date, "status-only recovery with unknown balance does not establish a credit");
assert.equal(gradeDate(grade, exam, timeline([log("إعادة تعيين", 11, { amount: 0 })])), exam.date, "even a saved reset cannot move an exam across calendar days");
const sameDayReset = timeline([log("إعادة تعيين", 10, { date: at(10, "13:00:00.000"), amount: 0 })]);
assert.equal(gradeDate(grade, exam, sameDayReset), sameDayReset[0].date, "a same-day saved reset is a balance boundary");
assert.equal(gradeDate(grade, exam, timeline([log("إضافة", 12, { amount: 1 })])), exam.date, "a credit at the late entry time remains on its own later day");
const exactEntry = { ...grade, createdAt: at(10, "13:00:00.000") };
assert.equal(gradeDate(exactEntry, exam, sameDayCredit), exactEntry.createdAt, "a same-day credit recorded exactly at entry is already available");
assert.equal(gradeDate(grade, exam, timeline([log("إضافة", 13, { amount: 1 })])), exam.date, "future credits never reorder an earlier result");
assert.equal(gradeDate({ ...grade, createdAt: "bad" }, exam, sameDayCredit), exam.date);
assert.equal(gradeDate(grade, undefined, between), grade.createdAt);
assert.equal(gradeDate({}, undefined, between), "");
const unsortedBalances = timeline([
  log("إضافة", 11, { amount: 1 }),
  log("إضافة", 10, { date: at(10, "20:00:00.000"), amount: 1 }),
  log("إضافة", 10, { date: at(10, "13:00:00.000"), amount: 1 }),
  log("إضافة", 10, { date: at(10, "11:00:00.000"), amount: 1 }),
  log("إضافة", 10, { date: at(10, "21:00:00.000"), amount: 1 }),
]);
assert.equal(gradeDate(grade, exam, unsortedBalances.reverse()), at(10, "20:00:00.000"), "latest qualifying balance on the exam's Baghdad day wins regardless of input order");
assert.equal(gradeDate(grade, { ...exam, date: at(10, "21:30:00.000") }, timeline([log("إضافة", 11, { date: at(11, "07:00:00.000"), amount: 1 })])), at(11, "07:00:00.000"), "different UTC dates can share the same Baghdad exam day");
assert.equal(gradeDate(grade, { ...exam, date: at(10, "20:59:59.000") }, timeline([log("إضافة", 10, { date: at(10, "21:00:00.000"), amount: 1 })])), at(10, "20:59:59.000"), "crossing Baghdad midnight excludes a later-day credit even on the same UTC date");
// The engine's own order: a pass (or a fail above the discount mark) keeps its
// exam's place however late it was typed, but never comes before an earlier
// exam of its day that a credit moved later.
const dayExam = (id, type = "يومي") => ({ id, date: at(10, "00:00:00.000"), type, passMark: 60, discountMark: 19, dismissalGrade: type === "فاينل" ? 10 : null });
const typed = (examId, status, score, time) => ({ examId, status, score, createdAt: at(10, time) });
const sameDayCreditOnly = timeline([log("إضافة", 10, { amount: 1 })], "chapter");
assert.equal(gradeDate(typed("p", "درجة", 80, "15:00:00.000"), dayExam("p"), sameDayCreditOnly), at(10, "00:00:00.000"),
  "a pass typed after a same-day credit keeps its exam's place");
assert.equal(gradeDate(typed("f", "درجة", 45, "15:00:00.000"), dayExam("f"), sameDayCreditOnly), at(10, "00:00:00.000"),
  "so does a fail above the discount mark");
assert.equal(gradeDate(typed("d", "درجة", 10, "15:00:00.000"), dayExam("d"), sameDayCreditOnly), at(10, "12:00:00.000"),
  "a discount score still follows the credit it was typed after");
assert.equal(gradeDate(typed("z", "درجة", 5, "15:00:00.000"), dayExam("z", "فاينل"), sameDayCreditOnly), at(10, "12:00:00.000"),
  "a final at its dismissal grade can dismiss, so it follows the credit too");
const dayExams = { a: dayExam("a"), b: dayExam("b") };
assert.deepEqual(gradeDates([typed("a", "غائب", null, "15:00:00.000"), typed("b", "درجة", 80, "16:00:00.000")], g => dayExams[g.examId], sameDayCreditOnly),
  [at(10, "12:00:00.000"), at(10, "12:00:00.000")], "a pass never comes before an earlier exam of its day");
assert.deepEqual(gradeDates([typed("b", "درجة", 80, "16:00:00.000"), typed("a", "غائب", null, "15:00:00.000")], g => dayExams[g.examId], sameDayCreditOnly),
  [at(10, "12:00:00.000"), at(10, "12:00:00.000")], "whatever order the grades are given in");
assert.deepEqual(gradeDates([typed("a", "درجة", 80, "16:00:00.000"), typed("b", "غائب", null, "15:00:00.000")], g => dayExams[g.examId], sameDayCreditOnly),
  [at(10, "00:00:00.000"), at(10, "12:00:00.000")], "a pass before a later exam of its day keeps its place");
// A result with no effect keeps its place and never drags a pass behind a credit.
assert.equal(gradeDate(typed("l", "مجاز", null, "15:00:00.000"), dayExam("l"), sameDayCreditOnly), at(10, "00:00:00.000"), "a leave keeps its exam's place");
assert.equal(gradeDate(typed("n", "درجة", 5, "15:00:00.000"), { ...dayExam("n"), noDiscount: true }, sameDayCreditOnly), at(10, "00:00:00.000"), "so does a «بدون خصم» score");
assert.equal(gradeDate(typed("c", "غش", null, "15:00:00.000"), { ...dayExam("c"), noDiscount: true }, sameDayCreditOnly), at(10, "12:00:00.000"), "cheating counts even on a «بدون خصم» exam");
assert.deepEqual(gradeDates([typed("a", "مجاز", null, "15:00:00.000"), typed("b", "درجة", 80, "09:00:00.000")], g => dayExams[g.examId], sameDayCreditOnly),
  [at(10, "00:00:00.000"), at(10, "00:00:00.000")], "a leave typed late leaves the day's pass in place");
assert.equal(gradeDate(typed("i", "غائب", null, "15:00:00.000"), { ...dayExam("i"), active: false }, sameDayCreditOnly), at(10, "00:00:00.000"), "a result on a closed exam keeps its place");
assert.equal(gradeDate(typed("r", "درجة", 150, "15:00:00.000"), { ...dayExam("r"), fullMark: 100 }, sameDayCreditOnly), at(10, "00:00:00.000"), "so does a score outside the exam's range");
assert.equal(gradeDate(typed("o", "غائب", null, "15:00:00.000"), { ...dayExam("o"), active: true, fullMark: 100 }, sameDayCreditOnly), at(10, "12:00:00.000"), "an absence on an open exam still follows the credit");
console.log("PASS: report timeline preserves dated grants and actual history, merges paired recoveries, uses real amounts, handles delayed results and excludes private data");
