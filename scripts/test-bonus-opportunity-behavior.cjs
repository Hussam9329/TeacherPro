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
// Exams before the return whose grades the return settled, each with the
// bonus it earned then.
const settledBefore = (n) => ({
  exams: Array.from({ length: n }, (_, i) => ({
    id: `old${i + 1}`, name: `سابق ${i + 1}`, type: "يومي", date: day(i + 1), fullMark: 100, passMark: 60, discountMark: 19,
    opportunitiesPenalty: 1, dismissalGrade: null, noDiscount: false, active: true, courseIds: ["course"],
    examCourses: [{ courseId: "course", chapterId: "chapter" }],
  })),
  grades: Array.from({ length: n }, (_, i) => ({
    id: `gold${i + 1}`, studentId: "student", examId: `old${i + 1}`, status: "درجة", score: 80,
    createdAt: day(i + 1).replace("T00:00", "T10:00"), updatedAt: day(i + 1).replace("T00:00", "T10:00"),
  })),
  bonuses: Array.from({ length: n }, (_, i) => ({
    id: `auto_bonus_old${i + 1}`, studentId: "student", examId: `old${i + 1}`, action: BONUS_OPPORTUNITY_ACTION, amount: 1,
    reason: "تلقائي: فرصة مكافأة: سابقة", date: day(i + 1), chapterId: "chapter",
  })),
  ids: Array.from({ length: n }, (_, i) => `gold${i + 1}`),
});
scenario("33 the chapter limit counts bonuses earned before a return", () => {
  const before = settledBefore(2);
  const r = run([["s", 10, { day: 6 }], ["s", 70, { day: 7 }], ["s", 80, { day: 8 }], ["s", 75, { day: 9 }], ["s", 90, { day: 10 }]], {
    exams: before.exams, grades: before.grades,
    logs: [...before.bonuses, { ...grant(2, 5), settledGradeIds: JSON.stringify(before.ids) }],
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
// The six findings of the trial check (all fixed).
const replay = (state, logs, students) => recalculateAcademicState({ ...state, students: students || state.students, opportunityLogs: logs }, new Set(["student"]));
const bonusIds = (result) => result.opportunityLogs.filter((log) => log.action === BONUS_OPPORTUNITY_ACTION).map((log) => log.examId);
scenario("39 deleting a grade that earned a bonus: one recalculation gives the final answer", () => {
  const before = run([["s", 12], ["s", 70], ["s", 80], ["s", 10], ["s", 70], ["s", 80], ["s", 10], ["s", 70], ["s", 80]]);
  assert.deepEqual(before.bonuses.map((b) => b.examId), ["e3", "e6"]);
  const state = { ...before.state, grades: before.state.grades.filter((grade) => grade.id !== "g3") };
  const first = replay(state, before.logs);
  const second = replay(state, first.opportunityLogs, first.students);
  const third = replay(state, second.opportunityLogs, second.students);
  assert.deepEqual(bonusIds(first), ["e6", "e9"]);
  assert.deepEqual([first, second, third].map((r) => [r.students[0].opportunities, bonusIds(r)]),
    [[2, ["e6", "e9"]], [2, ["e6", "e9"]], [2, ["e6", "e9"]]]);
});
scenario("40 a pass counts on its exam's day, however late it is entered", () => {
  const add = command("add", "إضافة", 1, 3, "تعويض");
  const later = [["s", 10, { day: 5 }], ["s", 70, { day: 6 }], ["s", 80, { day: 7 }], ["s", 10, { day: 8 }], ["s", 70, { day: 9 }], ["s", 80, { day: 10 }]];
  const at = (entered) => run([["s", 12, { day: 1 }], ["s", 70, { day: 2 }], ["s", 80, { day: 3, entered }], ...later], { logs: [add] });
  const quick = at(day(3).replace("T00:00", "T10:00"));
  const late = at(day(4));
  assert.deepEqual([balance(late), late.bonuses.map((b) => b.examId)], [balance(quick), quick.bonuses.map((b) => b.examId)]);
  assert.deepEqual(quick.bonuses.map((b) => b.examId), ["e3", "e6"]);
  // A late loss still spends only the balance it knew about.
  const lateLoss = run([["a", null, { day: 1 }], ["a", null, { day: 2 }], ["a", null, { day: 3, entered: day(4) }]], { logs: [add] });
  assert.equal(balance(lateLoss), 1);
  // A fail above the discount mark keeps its exam's place too: typed after
  // the credit it neither pushes the day's passes behind it (bonus at e4)
  // nor lets a later pass of its day pair across it (no bonus).
  const at3 = (h) => day(3).replace("T00:00", `T${h}:00`);
  const failFirst = (h) => run([["s", 12, { day: 1 }], ["s", 45, { day: 3, entered: at3(h) }], ["s", 70, { day: 3, entered: at3("09") }], ["s", 80, { day: 3, entered: at3("09") }]], { logs: [add] });
  for (const h of ["09", "15"]) assert.deepEqual(failFirst(h).bonuses.map((b) => b.examId), ["e4"]);
  const failBetween = (h) => run([["s", 12, { day: 1 }], ["s", 70, { day: 2 }], ["s", 45, { day: 3, entered: at3(h) }], ["s", 80, { day: 3, entered: at3("09") }]], { logs: [add] });
  for (const h of ["09", "15"]) assert.equal(failBetween(h).bonuses.length, 0);
});
scenario("40b a pass never jumps ahead of an earlier exam of its day", () => {
  const at = (h) => day(3).replace("T00:00", `T${h}:00`);
  const credit = command("add", "إضافة", 1, 3, "تعويض");
  // Two absences then a pass on one day, all typed after the noon credit:
  // the pass comes after them, so it never pairs with yesterday's pass and
  // the second absence at zero dismisses.
  const a = run([["a", null, { day: 1 }], ["a", null, { day: 1 }], ["a", null, { day: 1 }], ["s", 70, { day: 2 }],
    ["a", null, { day: 3, entered: at(13) }], ["a", null, { day: 3, entered: at(13).replace(":00:", ":30:") }], ["s", 80, { day: 3, entered: at(14) }]], { logs: [credit] });
  assert.equal(balance(a), "مفصول"); assert.equal(a.bonuses.length, 0);
  // Cheating first that day, then a pass: no bonus is written for the dismissed student.
  const c = run([["s", 12, { day: 1 }], ["s", 70, { day: 2 }], ["cheat", null, { day: 3, entered: at(13) }], ["s", 80, { day: 3, entered: at(14) }]], { logs: [credit] });
  assert.equal(balance(c), "مفصول"); assert.equal(c.bonuses.length, 0);
  // A same-day loss before the pass, then a pass the next day: the pair is
  // the two passes after the loss, whenever the loss was typed.
  const early = command("add", "إضافة", 1, 2, "تعويض", { date: day(2).replace("T00:00", "T08:00") });
  const lossAt = (entered) => run([["a", null, { day: 1 }], ["s", 10, { day: 2, entered }], ["s", 70, { day: 2, entered: day(2).replace("T00:00", "T14:00") }],
    ["s", 80, { day: 3 }], ["a", null, { day: 4 }], ["a", null, { day: 5 }], ["a", null, { day: 6 }]], { logs: [early] });
  for (const entered of [day(2).replace("T00:00", "T07:00"), day(2).replace("T00:00", "T13:00")]) {
    const r = lossAt(entered);
    assert.equal(r.student.status, "نشط"); assert.equal(balance(r), 0); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e4"]);
  }
  // Losses before and after two passes of one day, one typed after the noon
  // credit and one before it: the passes still pair (bonus at the second),
  // and the later loss breaks the streak only after them.
  const around = (first, last, after = []) => run([["a", null, { day: 1 }], ["a", null, { day: 1 }],
    ["a", null, { day: 3, entered: at(first) }], ["s", 70, { day: 3, entered: at("09") }], ["s", 80, { day: 3, entered: at("09") }],
    ["a", null, { day: 3, entered: at(last) }], ...after], { logs: [credit] });
  for (const [first, last] of [["09", "09"], ["13", "13"], ["09", "13"], ["13", "09"]]) {
    const r = around(first, last);
    assert.equal(balance(r), 1, `${first}/${last}`); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e5"], `${first}/${last}`);
    assert.equal(r.student.bonusProgress, 0);
    const next = around(first, last, [["a", null, { day: 4 }]]);
    assert.equal(next.student.status, "نشط", `${first}/${last}`); assert.equal(balance(next), 0);
  }
});
scenario("40c a result with no effect never moves a pass, however late it is typed", () => {
  const at = (h) => day(3).replace("T00:00", `T${h}:00`);
  const credit = command("add", "إضافة", 1, 3, "تعويض");
  for (const neutral of [["leave", null], ["nd", 5], ["off", 5]]) {
    const outcome = (h) => {
      const r = run([["s", 12, { day: 1 }], ["s", 70, { day: 2 }], [neutral[0], neutral[1], { day: 3, entered: at(h) }],
        ["s", 80, { day: 3, entered: at("09") }], ["a", null, { day: 4 }], ["a", null, { day: 5 }],
        ["s", 70, { day: 6 }], ["s", 75, { day: 7 }], ["s", 80, { day: 8 }], ["s", 90, { day: 9 }]], { logs: [credit] });
      return [balance(r), r.bonuses.map((b) => b.examId)];
    };
    assert.deepEqual(outcome("13"), outcome("09"), neutral[0]);
    assert.deepEqual(outcome("09")[1][0], "e4", neutral[0]);
  }
});
const returnedAt = (n, settled) => ({ ...grant(2, n), settledGradeIds: JSON.stringify(settled) });
scenario("41 an exam on the return day graded after the return counts, as a pass exactly as a loss", () => {
  const losses = [["a", null, { day: 1 }], ["a", null, { day: 2 }], ["a", null, { day: 3 }], ["a", null, { day: 4 }]];
  const settled = ["g1", "g2", "g3", "g4"];
  const afterReturn = { entered: day(5).replace("T00:00", "T15:00") };
  const pass = run([...losses, ["s", 70, { day: 5, ...afterReturn }], ["s", 80, { day: 6 }]], { logs: [returnedAt(5, settled)] });
  assert.equal(balance(pass), 3); assert.deepEqual(pass.bonuses.map((b) => b.examId), ["e6"]);
  const loss = run([...losses, ["a", null, { day: 5, ...afterReturn }]], { logs: [returnedAt(5, settled)] });
  assert.equal(balance(loss), 1);
  // A same-day grade the return settled stays out, for passes as for losses.
  const known = run([...losses, ["s", 70, { day: 5 }], ["s", 80, { day: 6 }]], { logs: [returnedAt(5, [...settled, "g5"])] });
  assert.equal(balance(known), 2); assert.equal(known.bonuses.length, 0); assert.equal(known.student.bonusProgress, 1);
});
scenario("42 a missing grade before the two passes does not hold the bonus", () => {
  const r = run([["s", 12], ["missing"], ["s", 70], ["s", 80]]);
  assert.equal(balance(r), 3); assert.deepEqual(r.bonuses.map((b) => b.examId), ["e4"]);
  assert.equal(r.student.bonusProgress, 0); assert.equal(r.student.bonusWaitingExamName, null);
  // Whatever the missing grade turns out to be, the bonus stays.
  assert.equal(balance(run([["s", 12], ["s", 75], ["s", 70], ["s", 80]])), 3);
  assert.equal(balance(run([["s", 12], ["s", 45], ["s", 70], ["s", 80]])), 3);
  assert.equal(balance(run([["s", 12], ["a"], ["s", 70], ["s", 80]])), 2);
  // Between the two passes it still holds.
  const between = run([["s", 12], ["s", 70], ["missing"], ["s", 80]]);
  assert.equal(balance(between), 2); assert.equal(between.student.bonusProgress, 2);
  assert.equal(between.student.bonusWaitingExamName, "امتحان 3");
  // A later pair with nothing missing between its passes earns it.
  const later = run([["s", 12], ["s", 70], ["missing"], ["s", 80], ["s", 90]]);
  assert.equal(balance(later), 3); assert.deepEqual(later.bonuses.map((b) => b.examId), ["e5"]);
  assert.match(later.bonuses[0].reason, /«امتحان 4» \(80\) و«امتحان 5» \(90\)/);
  const stillHeld = run([["s", 12], ["s", 70], ["missing"], ["s", 80], ["missing"], ["s", 90]]);
  assert.equal(balance(stillHeld), 2); assert.equal(stillHeld.student.bonusWaitingExamName, "امتحان 3");
});
const adminReset = (from, to, n) => command("reset", "إعادة تعيين", to, n,
  `إعادة تعيين الفرص من إدارة الفرص [قبل: ${from} → بعد: ${to}، فرق: ${to - from}]`,
  { balanceBefore: from, balanceAfter: to, settledGradeIds: "[]" });
scenario("43 a reset holds only what it removed", () => {
  // Reset to the full 3, then the limit raised to 4: the 4th is earned by passing.
  const raised = run([["s", 70, { day: 2 }], ["s", 80, { day: 3 }]], { cap: 4, logs: [adminReset(1, 3, 1)] });
  assert.equal(balance(raised), 4); assert.equal(raised.bonuses.length, 1);
  // A reset that lowered the balance is still a deduction passes cannot undo.
  const lowered = run([["s", 70, { day: 2 }], ["s", 80, { day: 3 }]], { logs: [adminReset(3, 1, 1)] });
  assert.equal(balance(lowered), 1); assert.equal(lowered.bonuses.length, 0);
  // A reset that raised the balance short of the limit removed nothing.
  const partial = run([["s", 70, { day: 2 }], ["s", 80, { day: 3 }]], { logs: [adminReset(1, 2, 1)] });
  assert.equal(balance(partial), 3); assert.equal(partial.bonuses.length, 1);
  // A manual deduction before a reset stays held: confirming the balance
  // (before = after) frees nothing, and a lowering reset adds to it.
  const deduct = command("m", "خصم", 1, 1, "سلوك", { date: day(1).replace("T00:00", "T09:00") });
  const confirm = command("reset", "إعادة تعيين", 2, 1, "حماية P2: تثبيت الرصيد الموجود دون تغيير",
    { balanceBefore: 2, balanceAfter: 2, appliedAmount: 0, settledGradeIds: "[]" });
  const confirmed = run([["s", 70, { day: 3 }], ["s", 80, { day: 4 }]], { logs: [deduct, confirm] });
  assert.equal(balance(confirmed), 2); assert.equal(confirmed.bonuses.length, 0);
  const deeper = run([["s", 70, { day: 3 }], ["s", 80, { day: 4 }], ["s", 75, { day: 5 }], ["s", 90, { day: 6 }]],
    { logs: [deduct, adminReset(2, 1, 1)] });
  assert.equal(balance(deeper), 1); assert.equal(deeper.bonuses.length, 0);
  // An undone deduction is not carried.
  const undo = command("u", "إضافة", 1, 1, "تراجع موثق عن خصم: سلوك [undo-ref:m]", { date: day(1).replace("T00:00", "T10:00") });
  const undone = run([["s", 70, { day: 3 }], ["s", 80, { day: 4 }]], { logs: [deduct, undo, adminReset(3, 2, 1)] });
  assert.equal(balance(undone), 2); assert.equal(undone.bonuses.length, 0);
  // A reset to the full limit gives back an earlier deduction: raising the
  // limit later leaves only a gap passes can earn back.
  const restored = run([["s", 70, { day: 3 }], ["s", 80, { day: 4 }]], { cap: 4, logs: [deduct, adminReset(2, 3, 1)] });
  assert.equal(balance(restored), 4); assert.equal(restored.bonuses.length, 1);
  // A second reset that changes nothing keeps what an earlier one held.
  const twice = run([["s", 70, { day: 3 }], ["s", 75, { day: 4 }], ["s", 80, { day: 5 }], ["s", 90, { day: 6 }]],
    { logs: [{ ...adminReset(3, 1, 1), id: "reset-a", date: day(1).replace("T00:00", "T11:00") }, adminReset(1, 1, 2)] });
  assert.equal(balance(twice), 1); assert.equal(twice.bonuses.length, 0);
  const confirmedTwice = run([["s", 70, { day: 3 }], ["s", 80, { day: 4 }]],
    { logs: [deduct, { ...confirm, id: "confirm-a" }, { ...confirm, id: "confirm-b", date: day(2).replace("T00:00", "T12:00") }] });
  assert.equal(balance(confirmedTwice), 2); assert.equal(confirmedTwice.bonuses.length, 0);
  // A deduction a later plain credit refilled is not carried into a reset:
  // the exam loss after it stays recoverable.
  const refill = command("credit", "إضافة", 1, 1, "تعويض", { date: day(1).replace("T00:00", "T12:00"), balanceBefore: 2, balanceAfter: 3 });
  const p2 = command("p2", "إعادة تعيين", 2, 2, "حماية P2: تثبيت الرصيد الموجود دون تغيير",
    { date: day(2).replace("T00:00", "T12:00"), balanceBefore: 2, balanceAfter: 2, appliedAmount: 0, settledGradeIds: '["g1"]' });
  const refilled = run([["a", null, { day: 2 }], ["s", 80, { day: 4 }], ["s", 90, { day: 5 }]],
    { logs: [{ ...deduct, balanceBefore: 3, balanceAfter: 2 }, refill, p2] });
  assert.equal(balance(refilled), 3); assert.deepEqual(refilled.bonuses.map((b) => b.examId), ["e3"]);
  // Lowered from 3 to 2 under a raised limit of 4: only the one it removed is held.
  const both = run([["s", 70, { day: 2 }], ["s", 80, { day: 3 }], ["s", 75, { day: 4 }], ["s", 90, { day: 5 }]], { cap: 4, logs: [adminReset(3, 2, 1)] });
  assert.equal(balance(both), 3); assert.equal(both.bonuses.length, 1);
});
console.log(`bonus opportunity behavior: ${count} scenarios passed`);
