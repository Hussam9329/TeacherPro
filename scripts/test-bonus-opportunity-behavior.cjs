// «فرصة مكافأة»: every scenario the owner reviewed before the rule was built.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
// Exams in these scenarios are dated after the rule's start day, so the
// clock is pinned later: exams must already be open to count.
const RealDate = Date;
const NOW = new RealDate("2026-12-01T09:00:00.000Z").getTime();
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
};
const { recalculateAcademicState } = require("../src/lib/academic-engine.ts");
const {
  BONUS_OPPORTUNITY_ACTION, BONUS_START_DAY, bonusProgressLabel,
} = require("../src/lib/bonus-opportunity.ts");
const { CHAPTER_TRANSITION_SETTLEMENT_REASON } = require("../src/lib/second-chapter-transition.ts");

assert.equal(BONUS_START_DAY, "2026-10-03");
const day = (n) => {
  const d = new Date(Date.UTC(2026, 9, 3 + n));
  return d.toISOString();
};

/**
 * events: ["s", score] | ["a"] | ["leave"] | ["grace"] | ["missing"] | ["cheat"] | ["nd", score]
 * | ["final", score] | ["off", score]. Options per event: { pen, pm, sameDayAs, day }.
 */
function build(events, extra = {}) {
  const exams = [];
  const grades = [];
  const leaves = [];
  let d = 0;
  events.forEach((event, index) => {
    const [kind, value, opts = {}] = event;
    const id = `e${index + 1}`;
    const examDay = opts.day !== undefined ? opts.day : (opts.sameDay ? d : (d += 1));
    const exam = {
      id, name: `امتحان ${index + 1}`, type: kind === "final" ? "فاينل" : "يومي", date: day(examDay),
      fullMark: 100, passMark: opts.pm ?? 60, discountMark: kind === "final" ? 0 : 19,
      opportunitiesPenalty: opts.pen ?? 1, dismissalGrade: kind === "final" ? 10 : null,
      noDiscount: kind === "nd", active: kind !== "off", courseIds: ["course"],
      examCourses: [{ courseId: "course", chapterId: "chapter" }],
    };
    exams.push(exam);
    const entered = opts.entered || day(examDay).replace("T00:00", "T10:00");
    const g = { id: `g${index + 1}`, studentId: "student", examId: id, score: null, createdAt: entered, updatedAt: entered };
    if (kind === "s" || kind === "nd" || kind === "final" || kind === "off") grades.push({ ...g, status: "درجة", score: value });
    else if (kind === "a") grades.push({ ...g, status: "غائب" });
    else if (kind === "cheat") grades.push({ ...g, status: "غش" });
    else if (kind === "leave") { grades.push({ ...g, status: "مجاز" }); }
    else if (kind === "grace") grades.push({ ...g, status: "غائب" });
    // "missing": exam exists, no grade.
  });
  const graceDays = events.map((e, i) => (e[0] === "grace" ? exams[i].date : null)).filter(Boolean);
  return {
    students: [{
      id: "student", courseId: "course", status: extra.status || "نشط", dismissalReason: extra.dismissalReason || "",
      opportunities: 3, baseOpportunities: 3, createdAt: "2026-08-01T00:00:00.000Z",
      gracePeriods: graceDays.map((date, i) => ({ id: `gp${i}`, startDate: date.slice(0, 10), endDate: date.slice(0, 10) })),
    }],
    chapters: [{ id: "chapter", name: "الفصل", opportunities: extra.cap ?? 3 }],
    courseChapters: [{ id: "link", courseId: "course", chapterId: "chapter", active: true, archived: false }],
    exams: [...exams, ...(extra.exams || [])],
    grades: [...grades, ...(extra.grades || [])],
    opportunityLogs: extra.logs || [],
    studentLeaves: leaves,
    studentNotes: [],
  };
}
function run(events, extra) {
  const state = build(events, extra);
  const result = recalculateAcademicState(state, new Set(["student"]));
  const student = result.students[0];
  const bonuses = result.opportunityLogs.filter((log) => log.action === BONUS_OPPORTUNITY_ACTION);
  return { student, bonuses, logs: result.opportunityLogs, state };
}
const balance = (r) => r.student.status === "مفصول" ? "مفصول" : r.student.opportunities;
let count = 0;
function scenario(name, fn) { fn(); count += 1; process.stdout.write(`ok ${count} ${name}\n`); }

scenario("1 the owner's example: 12, 77, 69", () => {
  const r = run([["s", 12], ["s", 77], ["s", 69]]);
  assert.equal(balance(r), 3);
  assert.equal(r.bonuses.length, 1);
  assert.equal(r.bonuses[0].examId, "e3");
  assert.equal(r.bonuses[0].amount, 1);
  assert.match(r.bonuses[0].reason, /^تلقائي: فرصة مكافأة: نجاح متتالي في «امتحان 2» \(77\) و«امتحان 3» \(69\)$/);
  assert.equal(r.student.bonusProgress, 0);
});
scenario("2 a full student earns nothing", () => {
  const r = run([["s", 77], ["s", 69]]);
  assert.equal(balance(r), 3); assert.equal(r.bonuses.length, 0); assert.equal(r.student.bonusProgress, 0);
});
scenario("3 a pass before the loss never counts", () => {
  const r = run([["s", 80], ["s", 15], ["s", 70], ["s", 65]]);
  assert.equal(balance(r), 3); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e4"]);
});
scenario("4 a fail without deduction restarts the count", () => {
  const r = run([["s", 12], ["s", 77], ["s", 45], ["s", 70], ["s", 66]]);
  assert.deepEqual(r.bonuses.map((b) => b.examId), ["e5"]);
});
scenario("5 an absence between passes", () => {
  const r = run([["a"], ["s", 80], ["a"], ["s", 70], ["s", 90]]);
  assert.equal(balance(r), 2); assert.equal(r.bonuses.length, 1); assert.equal(r.student.bonusProgress, 0);
});
scenario("6 leave is neutral", () => {
  const r = run([["s", 12], ["s", 77], ["leave"], ["s", 69]]);
  assert.equal(balance(r), 3); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e4"]);
});
scenario("7 a «بدون خصم» exam is neutral, even when passed", () => {
  const r = run([["s", 12], ["s", 77], ["nd", 80], ["s", 69]]);
  assert.deepEqual(r.bonuses.map((b) => b.examId), ["e4"]);
});
scenario("8 grace is neutral", () => {
  const r = run([["s", 12], ["s", 77], ["grace"], ["s", 69]]);
  assert.equal(balance(r), 3); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e4"]);
});
scenario("9 a final pass counts", () => {
  const r = run([["s", 12], ["s", 77], ["final", 70]]);
  assert.equal(balance(r), 3); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e3"]);
});
scenario("10 a final fail above the dismissal grade restarts the count", () => {
  const r = run([["s", 12], ["s", 77], ["final", 45], ["s", 70], ["s", 75]]);
  assert.deepEqual(r.bonuses.map((b) => b.examId), ["e5"]);
});
scenario("11 two exams on the same day count as two passes", () => {
  const r = run([["s", 12], ["s", 77], ["s", 69, { sameDay: true }]]);
  assert.equal(balance(r), 3);
});
scenario("12 two losses, four passes", () => {
  const r = run([["s", 10], ["a"], ["s", 70], ["s", 75], ["s", 80], ["s", 85]]);
  assert.equal(balance(r), 3); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e4", "e6"]);
});
scenario("13 three passes give one bonus, the third starts a new count", () => {
  const r = run([["s", 10], ["a"], ["s", 70], ["s", 75], ["s", 80]]);
  assert.equal(balance(r), 2); assert.equal(r.student.bonusProgress, 1);
  assert.equal(bonusProgressLabel(r.student.bonusProgress), "نجاح 1 من 2 نحو فرصة مكافأة");
});
scenario("14 an exam that deducts two needs four passes", () => {
  const r = run([["a", null, { pen: 2 }], ["s", 70], ["s", 75], ["s", 80], ["s", 85]]);
  assert.equal(balance(r), 3); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e3", "e5"]);
});
scenario("15 at most two bonuses per chapter: the every-third-exam loophole is closed", () => {
  const pattern = []; for (let i = 1; i <= 16; i += 1) pattern.push([1, 4, 7, 10, 13, 16].includes(i) ? ["a"] : ["s", 70]);
  const r = run(pattern);
  assert.equal(balance(r), "مفصول"); assert.equal(r.bonuses.length, 2);
  assert.match(r.student.dismissalReason, /امتحان 16/);
});
scenario("16 an active student on zero earns one back", () => {
  const r = run([["a"], ["a"], ["a"], ["s", 70], ["s", 75]]);
  assert.equal(balance(r), 1);
});
scenario("17 on zero with one pass, an absence still dismisses", () => {
  const r = run([["a"], ["a"], ["a"], ["s", 70], ["a"]]);
  assert.equal(balance(r), "مفصول");
});
scenario("18 cheating ends everything", () => {
  const r = run([["s", 12], ["s", 77], ["cheat"]]);
  assert.equal(balance(r), "مفصول"); assert.equal(r.bonuses.length, 0);
});
const grant = (balanceAfter, n) => ({
  id: "grant", studentId: "student", action: "رصيد إعادة التفعيل", amount: balanceAfter, appliedAmount: balanceAfter,
  balanceBefore: 0, balanceAfter, ledgerVersion: 2, settledGradeIds: "[]", reason: "إرجاع الطالب",
  chapterId: "chapter", date: day(n).replace("T00:00", "T12:00"),
});
scenario("19 a returned student can reach the chapter limit by passing", () => {
  const r = run([["a"], ["a"], ["a"], ["a"], ["s", 70, { day: 6 }], ["s", 75, { day: 7 }]], { logs: [grant(2, 5)] });
  assert.equal(r.student.status, "نشط"); assert.equal(balance(r), 3); assert.equal(r.bonuses.length, 1);
});
scenario("20 a returned student who loses again", () => {
  const r = run([["s", 10, { day: 6 }], ["s", 70, { day: 7 }], ["s", 80, { day: 8 }], ["s", 75, { day: 9 }], ["s", 90, { day: 10 }]], { logs: [grant(2, 5)] });
  assert.equal(balance(r), 3); assert.equal(r.bonuses.length, 2);
});
scenario("21 a missing grade inside the streak holds the bonus", () => {
  const held = run([["s", 12], ["s", 77], ["missing"], ["s", 69]]);
  assert.equal(balance(held), 2); assert.equal(held.bonuses.length, 0);
  assert.equal(held.student.bonusProgress, 2); assert.equal(held.student.bonusWaitingExamName, "امتحان 3");
  assert.equal(bonusProgressLabel(2, "امتحان 3"), "فرصة مكافأة مستحقة، تنتظر درجة «امتحان 3»");
  const passed = run([["s", 12], ["s", 77], ["s", 70], ["s", 69]]);
  assert.equal(balance(passed), 3); assert.deepEqual(passed.bonuses.map((b) => b.examId), ["e3"]);
  const failed = run([["s", 12], ["s", 77], ["s", 45], ["s", 69]]);
  assert.equal(balance(failed), 2); assert.equal(failed.student.bonusProgress, 1);
});
scenario("22 an old loss entered late is replayed in exam order", () => {
  const r = run([["s", 12, { entered: day(9) }], ["s", 77], ["s", 69]]);
  assert.equal(balance(r), 3);
  assert.ok(r.logs.some((log) => log.action === "خصم تلقائي" && log.examId === "e1"));
  assert.deepEqual(r.bonuses.map((b) => b.examId), ["e3"]);
});
scenario("23 correcting a pass to a fail withdraws the bonus", () => {
  const r = run([["s", 12], ["s", 77], ["s", 45]]);
  assert.equal(balance(r), 2); assert.equal(r.bonuses.length, 0);
});
scenario("24 a correction that withdraws a bonus can dismiss (automatic, like any deduction)", () => {
  const before = run([["a"], ["a"], ["a"], ["s", 70], ["s", 66], ["a"]]);
  assert.equal(balance(before), 0); assert.equal(before.student.status, "نشط");
  const after = run([["a"], ["a"], ["a"], ["s", 70], ["s", 40], ["a"]]);
  assert.equal(balance(after), "مفصول");
});
const storedDismissal = {
  id: "auto_dismiss", studentId: "student", examId: "e6", action: "فصل تلقائي", amount: 0,
  reason: "تلقائي: مخالفة بعد انتهاء الفرص - غياب في امتحان يومي: امتحان 6", date: day(6), chapterId: "chapter",
};
scenario("25 a late pass that proves no dismissal returns the student automatically", () => {
  const r = run([["a"], ["a"], ["a"], ["s", 70], ["s", 80], ["a"]], {
    status: "مفصول", dismissalReason: "مخالفة بعد انتهاء الفرص - غياب في امتحان يومي: امتحان 6", logs: [storedDismissal],
  });
  assert.equal(r.student.status, "نشط"); assert.equal(r.student.bonusAutoReturned, true); assert.equal(balance(r), 0);
  const manual = run([["a"], ["a"], ["a"], ["s", 70], ["s", 80], ["a"]], {
    status: "مفصول", dismissalReason: "فصل الطالب: سلوك", logs: [storedDismissal],
  });
  assert.equal(manual.student.status, "مفصول");
  // A dismissal removed by correcting its own exam keeps today's rule.
  const corrected = run([["a"], ["a"], ["a"], ["s", 70], ["s", 40], ["s", 90]], {
    status: "مفصول", dismissalReason: "مخالفة بعد انتهاء الفرص - غياب في امتحان يومي: امتحان 6", logs: [storedDismissal],
  });
  assert.equal(corrected.student.status, "مفصول"); assert.equal(corrected.student.bonusAutoReturned, undefined);
});
scenario("26 lowering an exam's pass mark can create a bonus", () => {
  assert.equal(balance(run([["s", 12], ["s", 55], ["s", 70]])), 2);
  assert.equal(balance(run([["s", 12], ["s", 55, { pm: 50 }], ["s", 70]])), 3);
});
scenario("27 disabling an exam withdraws its pass", () => {
  const r = run([["s", 12], ["s", 77], ["off", 69]]);
  assert.equal(balance(r), 2); assert.equal(r.student.bonusProgress, 1);
});
const command = (id, action, amount, n, reason, extra = {}) => ({
  id, studentId: "student", action, amount, appliedAmount: amount, ledgerVersion: 2, settledGradeIds: null,
  reason, chapterId: "chapter", date: day(n).replace("T00:00", "T12:00"), ...extra,
});
scenario("28 a manual deduction is not earned back", () => {
  const r = run([["s", 70, { day: 2 }], ["s", 80, { day: 3 }]], { logs: [command("m", "خصم", 1, 1, "سلوك")] });
  assert.equal(balance(r), 2); assert.equal(r.bonuses.length, 0);
});
scenario("28b undoing a manual deduction restores it, exam losses stay recoverable", () => {
  const r = run([["a", null, { day: 1 }], ["s", 70, { day: 4 }], ["s", 80, { day: 5 }]], { logs: [
    command("m", "خصم", 1, 2, "سلوك"),
    command("u", "إضافة", 1, 3, "تراجع موثق عن خصم: سلوك [undo-ref:m]"),
  ] });
  assert.equal(balance(r), 3); assert.equal(r.bonuses.length, 1);
});
scenario("29 a manual addition during the count", () => {
  const r = run([["s", 10, { day: 1 }], ["a", null, { day: 2 }], ["s", 77, { day: 3 }], ["s", 69, { day: 5 }]], {
    logs: [command("add", "إضافة", 1, 4, "تعويض")],
  });
  assert.equal(balance(r), 3); assert.equal(r.bonuses.length, 1);
});
const settlement = (balanceAfter, n, reason, settled) => command("reset", "إعادة تعيين", balanceAfter, n, reason, {
  balanceAfter, settledGradeIds: JSON.stringify(settled),
});
scenario("30 a new chapter starts full and the count starts over", () => {
  const r = run([["s", 12, { day: 1 }], ["s", 77, { day: 2 }], ["s", 69, { day: 4 }]], {
    logs: [settlement(3, 3, CHAPTER_TRANSITION_SETTLEMENT_REASON, ["g1", "g2"])],
  });
  assert.equal(balance(r), 3); assert.equal(r.bonuses.length, 0); assert.equal(r.student.bonusProgress, 0);
});
scenario("31 raising the chapter limit: the extra opportunity is earned by passing", () => {
  const r = run([["s", 70, { day: 2 }], ["s", 80, { day: 3 }]], {
    cap: 4, logs: [settlement(3, 1, CHAPTER_TRANSITION_SETTLEMENT_REASON, [])],
  });
  assert.equal(balance(r), 4); assert.equal(r.bonuses.length, 1);
  const admin = run([["s", 70, { day: 2 }], ["s", 80, { day: 3 }]], {
    logs: [settlement(1, 1, "إعادة تعيين الفرص من إدارة الفرص [قبل: 3 → بعد: 1، فرق: -2]", [])],
  });
  assert.equal(balance(admin), 1); assert.equal(admin.bonuses.length, 0);
});
scenario("32 only exams from the start day count as passes", () => {
  const r = run([["s", 12, { day: -3 }], ["s", 77, { day: -1 }], ["s", 69, { day: 1 }], ["s", 70, { day: 2 }]]);
  assert.equal(balance(r), 3); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e4"]);
});
scenario("33 the chapter limit counts bonuses earned before a return", () => {
  const earlier = {
    id: "auto_bonus_old", studentId: "student", examId: "old", action: BONUS_OPPORTUNITY_ACTION, amount: 1,
    reason: "تلقائي: فرصة مكافأة: سابقة", date: day(1), chapterId: "chapter",
  };
  const r = run([["s", 10, { day: 6 }], ["s", 70, { day: 7 }], ["s", 80, { day: 8 }], ["s", 75, { day: 9 }], ["s", 90, { day: 10 }]], {
    logs: [{ ...earlier }, { ...earlier, id: "auto_bonus_old2", date: day(2) }, grant(2, 5)],
  });
  assert.equal(r.bonuses.length, 0); assert.equal(balance(r), 1);
});
scenario("34 a replay is deterministic: same input, same bonus log ids", () => {
  const a = run([["s", 12], ["s", 77], ["s", 69]]);
  const b = run([["s", 12], ["s", 77], ["s", 69]]);
  assert.deepEqual(a.bonuses.map((x) => x.id), b.bonuses.map((x) => x.id));
  const again = recalculateAcademicState({ ...a.state, opportunityLogs: a.logs }, new Set(["student"]));
  assert.equal(again.students[0].opportunities, 3);
  assert.equal(again.opportunityLogs.filter((log) => log.action === BONUS_OPPORTUNITY_ACTION).length, 1);
});
scenario("35 an administrator's reset in the chapter does not renew the limit of two", () => {
  const settledIds = ["g1", "g2", "g3", "g4", "g5", "g6"];
  const before = run([["s", 10], ["a"], ["s", 70], ["s", 75], ["s", 80], ["s", 85]]);
  assert.equal(before.bonuses.length, 2);
  const r = run([["s", 10, { day: 1 }], ["a", null, { day: 2 }], ["s", 70, { day: 3 }], ["s", 75, { day: 4 }], ["s", 80, { day: 5 }], ["s", 85, { day: 6 }],
    ["a", null, { day: 8 }], ["s", 90, { day: 9 }], ["s", 95, { day: 10 }]], {
    logs: [...before.bonuses, settlement(3, 7, "إعادة تعيين الفرص من إدارة الفرص [قبل: 3 → بعد: 3، فرق: +0]", settledIds)],
  });
  assert.equal(r.bonuses.filter((b) => b.examId === "e8" || b.examId === "e9").length, 0);
  assert.equal(balance(r), 2);
});
scenario("36 a held bonus is no longer shown once nothing is left to earn back", () => {
  const r = run([["s", 12, { day: 1 }], ["s", 77, { day: 2 }], ["missing", null, { day: 3 }], ["s", 69, { day: 4 }]], {
    logs: [command("add", "إضافة", 1, 5, "تعويض")],
  });
  assert.equal(balance(r), 3); assert.equal(r.student.bonusProgress, 0); assert.equal(r.student.bonusWaitingExamName, null);
});
scenario("37 an automatic return needs the student's own stored dismissal", () => {
  const r = run([["a"], ["a"], ["a"], ["s", 70], ["s", 80], ["a"]], {
    status: "مفصول", dismissalReason: "غش في امتحان: امتحان سابق", logs: [storedDismissal],
  });
  assert.equal(r.student.status, "مفصول"); assert.equal(r.student.bonusAutoReturned, undefined);
});
scenario("38 without an active chapter there is no progress to show", () => {
  const state = build([["s", 12], ["s", 77]]);
  state.courseChapters = [];
  state.students[0].bonusProgress = 1;
  const result = recalculateAcademicState(state, new Set(["student"]));
  assert.equal(result.students[0].bonusProgress, 0);
});
console.log(`bonus opportunity behavior: ${count} scenarios passed`);
