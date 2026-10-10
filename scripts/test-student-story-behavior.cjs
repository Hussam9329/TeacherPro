// «ملف الطالب» as a story: one example student through every kind of event.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(root, "src", request.slice(2));
  return originalResolve.call(this, request, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  filename,
);
const RealDate = Date;
const NOW = new RealDate("2026-11-20T09:00:00.000Z").getTime();
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
};

const { buildStudentStory, storyEventText, storyDismissalReason } = require("../src/lib/student-story.ts");
const { buildStoryAuditFacts, STUDENT_EDIT_CHANGES_MARKER } = require("../src/lib/student-story-audit.ts");
const { storyDay, storyTime, storyParts, storyWhatsApp } = require("../src/lib/student-story-format.ts");

let count = 0;
function scenario(name, fn) { fn(); count++; console.log(`ok ${count} ${name}`); }

const CH = "ch1";
const exam = (id, day, extra = {}) => ({
  id, name: `امتحان يومي ${id.slice(1)}`, type: "يومي", date: `${day}T09:00:00.000Z`, fullMark: 100, passMark: 60, discountMark: 19,
  opportunitiesPenalty: "1", noDiscount: false, active: true, examCourses: [{ courseId: "c", chapterId: CH }], ...extra,
});
const exams = [
  exam("x1", "2026-10-07"), exam("x2", "2026-10-08"), exam("x3", "2026-10-11"), exam("x4", "2026-10-13"),
  exam("x5", "2026-10-17"), exam("x6", "2026-10-22"), exam("x7", "2026-10-24"), exam("x8", "2026-10-27"),
  exam("x9", "2026-10-29"), exam("x10", "2026-11-01"), exam("x11", "2026-11-04", { name: "امتحان أسبوعي 11", type: "أسبوعي" }),
  exam("x12", "2026-11-06"), exam("x13", "2026-11-13"),
];
const grade = (examId, status, score, createdAt) => ({ id: `g-${examId}`, examId, status, score, createdAt, updatedAt: createdAt });
const log = (id, action, amount, examId, date, balanceAfter, reason = "", extra = {}) => ({
  id, action, amount, examId, date, balanceAfter, reason, chapterId: CH, chapterNameSnapshot: "الفصل الأول", ...extra,
});
const auditRows = [
  { id: "a1", module: "المتابعة", action: "تسجيل إجازة وإعادة احتساب الطالب", details: JSON.stringify({ leaveId: "lv3", studentId: "st" }), time: "2026-10-11T08:00:00.000Z", userName: "علي" },
  { id: "a2", module: "المكالمات", action: "إضافة ملاحظة مكالمات", details: JSON.stringify({ source: "call-note-management", before: null, after: { id: "cn1", studentId: "st" } }), time: "2026-11-01T12:00:00.000Z", userName: "حيدر" },
  { id: "a3", module: "إدارة الفرص", action: "خصم فرصة يدوياً وإعادة احتساب", details: JSON.stringify({ actionType: "deduct", studentId: "st", createdLogId: "m1" }), time: "2026-11-11T06:45:00.000Z", userName: "أحمد" },
  { id: "a4", module: "سجل الطلاب", action: "تم تعهد الطالب - إعادة تفعيل بفرصتين", details: "مصطفى كريم جاسم - BIO-2045", time: "2026-11-08T08:20:00.000Z", userName: "أحمد" },
  { id: "a5", module: "سجل الطلاب", action: "اغلاق كود الطالب المفصول", details: JSON.stringify({ studentId: "st", after: { dismissedChecked: true } }), time: "2026-11-04T14:30:00.000Z", userName: "حسين" },
  { id: "a6", module: "سجل الطلاب", action: "تعديل بيانات طالب", details: `مصطفى كريم جاسم - BIO-2045 - بدون تصفير${STUDENT_EDIT_CHANGES_MARKER}رقم ولي الأمر: 07701112233 ← 07712345678`, time: "2026-11-12T07:32:00.000Z", userName: "زينب" },
  { id: "a7", module: "تسجيل الطلاب", action: "تسجيل طالب", details: "مصطفى كريم جاسم - BIO-2045 - السادس الإحيائي", time: "2026-10-05T07:15:00.000Z", userName: "زينب" },
  { id: "a8", module: "سجل الطلاب", action: "اغلاق كود الطالب المفصول", details: JSON.stringify({ studentId: "other", after: { dismissedChecked: true } }), time: "2026-11-04T14:31:00.000Z", userName: "غريب" },
];
const audit = buildStoryAuditFacts(auditRows, { id: "st", code: "BIO-2045" });

const input = {
  student: { id: "st", name: "مصطفى كريم جاسم", code: "BIO-2045", status: "نشط", courseId: "c", opportunities: 1, createdAt: "2026-10-05T07:15:00.000Z",
    gracePeriods: [{ id: "gp1", startDate: "2026-10-15", endDate: "2026-10-20" }], bonusProgress: 1, dismissedChecked: true },
  courseName: "السادس الإحيائي",
  activeChapter: { id: CH, name: "الفصل الأول", opportunities: 3 },
  opportunityLimit: 3,
  exams, courseExams: exams,
  grades: [
    grade("x1", "درجة", 72, "2026-10-07T10:05:00.000Z"),
    grade("x2", "غائب", null, "2026-10-08T09:40:00.000Z"),
    grade("x4", "درجة", 15, "2026-10-13T09:10:00.000Z"),
    grade("x5", "غائب", null, "2026-10-17T09:00:00.000Z"),
    grade("x6", "درجة", 81, "2026-10-22T09:20:00.000Z"),
    grade("x7", "درجة", 77, "2026-10-24T09:30:00.000Z"),
    grade("x8", "درجة", 45, "2026-10-27T09:15:00.000Z"),
    grade("x9", "غائب", null, "2026-11-03T07:50:00.000Z"),
    grade("x10", "غائب", null, "2026-11-01T09:25:00.000Z"),
    grade("x11", "درجة", 12, "2026-11-04T10:00:00.000Z"),
    grade("x13", "درجة", 70, "2026-11-13T09:20:00.000Z"),
  ],
  opportunityLogs: [
    log("o2", "خصم تلقائي", 1, "x2", "2026-10-08T09:00:00.000Z", 2, "تلقائي: غياب في امتحان يومي: امتحان يومي 2"),
    log("o4", "خصم تلقائي", 1, "x4", "2026-10-13T09:00:00.000Z", 1, "تلقائي: درجة 15 ضمن الخصم"),
    log("o7", "فرصة مكافأة", 1, "x7", "2026-10-24T09:00:00.000Z", 2, "تلقائي: فرصة مكافأة: نجاح متتالي في «امتحان يومي 6» (81) و«امتحان يومي 7» (77)"),
    log("o9", "خصم تلقائي", 1, "x9", "2026-10-29T09:00:00.000Z", 1, "تلقائي: غياب"),
    log("o10", "خصم تلقائي", 1, "x10", "2026-11-01T09:00:00.000Z", 0, "تلقائي: غياب"),
    log("o11", "فصل تلقائي", 0, "x11", "2026-11-04T09:00:00.000Z", 0, "تلقائي: مخالفة بعد انتهاء الفرص - درجة ضمن الخصم"),
    log("r1a", "إعادة تفعيل", 0, null, "2026-11-08T08:20:00.000Z", null, "تثبيت إعادة التفعيل بعد تعهد الطالب"),
    log("r1b", "رصيد بعد تعهد", 2, null, "2026-11-08T08:20:01.000Z", 2, "رصيد بعد تعهد"),
    log("m1", "خصم", 1, null, "2026-11-11T06:45:00.000Z", 1, "مخالفة سلوكية"),
  ],
  leaves: [{ id: "lv3", examId: "x3", leaveType: "exam", reason: "مراجعة مستشفى", createdAt: "2026-10-11T08:00:00.000Z" }],
  calls: [
    { id: "c1", examId: "x2", category: "absent", target: "student", status: "لم يرد", completedAt: "2026-10-08T11:20:00.000Z", createdAt: "2026-10-08T11:00:00.000Z" },
    { id: "cn1", examId: "", category: "call-student-note", notes: "ولي الأمر طلب نتصل بيه بعد أسبوع", noteResolved: false, createdAt: "2026-11-01T12:00:00.000Z" },
    { id: "c-empty", examId: "x13", category: "passed", status: "", createdAt: "2026-11-13T10:00:00.000Z" },
  ],
  notes: [
    { id: "n-pledge", kind: "إجراء", text: "تم تعهد الطالب: إعادة تفعيله بفرصتين بعد فصل سابق: مخالفة", date: "2026-11-08T08:20:00.000Z", sourceType: "student-status-action" },
    { id: "n-auto", kind: "إجراء", text: "رجع الطالب تلقائياً: «فرصة مكافأة» انحسبت قبل الامتحان اللي فصله، فوقت ذاك الامتحان كان عنده فرصة وما انفصل. الرصيد الحالي: 0.", date: "2026-10-30T08:00:00.000Z", dismissalReason: "غياب في امتحان يومي 9", dismissalDate: "2026-10-29T09:00:00.000Z" },
  ],
  gracePeriods: [{ id: "gp1", startDate: "2026-10-15", endDate: "2026-10-20", note: "سفر عائلي", createdByName: "سارة", createdAt: "2026-10-14T13:45:00.000Z", cancelledAt: null }],
  pendingGrades: [{ examId: "x12", score: 66, category: "DISMISSED_PENDING", attemptedAt: "2026-11-06T09:35:00.000Z" }],
  audit,
  todayKey: "2026-11-20",
};
const story = buildStudentStory(input);
const all = story.groups.flatMap((group) => group.days.flatMap((day) => day.events));
const byId = (id) => all.find((event) => event.id === id);
const text = (id) => storyEventText(byId(id));

scenario("format: Gregorian months, 12-hour time and bold parts", () => {
  assert.equal(storyDay("2026-10-08"), "8 أكتوبر 2026");
  assert.equal(storyTime("14:20"), "2:20 م");
  assert.equal(storyTime("09:05"), "9:05 ص");
  assert.deepEqual(storyParts("**امتحان**: غاب"), [{ t: "امتحان", b: true }, { t: ": غاب" }]);
  assert.equal(storyWhatsApp(storyParts("**أ** و~~ب~~")), "*أ* و~ب~");
});

scenario("audit facts: actors by record id, events for this student only", () => {
  assert.equal(audit.leaveActors.lv3, "علي");
  assert.equal(audit.callNoteActors.cn1, "حيدر");
  assert.equal(audit.opportunityLogActors.m1, "أحمد");
  assert.deepEqual(audit.events.filter((event) => event.kind === "code-closed").map((event) => event.by), ["حسين"]);
  assert.deepEqual(audit.events.find((event) => event.kind === "edited").changes, ["رقم ولي الأمر: 07701112233 ← 07712345678"]);
});

scenario("an absence, its deduction and the call about it are one event", () => {
  assert.equal(text("exam-x2"), "امتحان يومي 2: غاب، فانخصمت فرصة.");
  assert.deepEqual(byId("exam-x2").balance, { after: 2, limit: 3, dismissed: false });
  assert.equal(byId("exam-x2").subs.length, 1);
  assert.equal(storyEventText(byId("exam-x2").subs[0]), "اتصلنا بالطالب وما رد.");
  assert.equal(all.filter((event) => event.id === "log-o2").length, 0, "the deduction is not repeated on its own");
  assert.equal(all.some((event) => event.id === "call-c-empty"), false, "a call not made yet is not an event");
  assert.deepEqual(byId("exam-x2").cats, ["grades", "decisions", "follow"], "the call keeps the exam under «المتابعة» too");
});

scenario("every result says why it did or did not cost an opportunity", () => {
  assert.equal(text("exam-x4"), "امتحان يومي 4: جاب 15 من 100، وهاي ضمن درجات الخصم (0 إلى 19)، فانخصمت فرصة.");
  assert.equal(text("exam-x8"), "امتحان يومي 8: راسب بـ45 من 100، بس ما ينخصم عليها لأنها فوق درجة الخصم (19).");
  assert.equal(text("exam-x5"), "امتحان يومي 5: غاب، بس ما انحسب عليه لأن عنده فترة سماح (من 15 أكتوبر 2026 لغاية 20 أكتوبر 2026).");
  assert.equal(text("exam-x3"), "امتحان يومي 3: عنده إجازة (مراجعة مستشفى)، فما انحسب عليه.");
  assert.equal(byId("exam-x3").by, "علي");
  assert.equal(text("exam-x10"), "امتحان يومي 10: غاب، فانخصمت فرصة وصار على صفر. ما انفصل، بس أي خصم بعد يفصله.");
});

scenario("bonus, dismissal and a pending grade", () => {
  assert.equal(text("exam-x7"), "امتحان يومي 7: نجح بـ77 من 100. نجح مرتين ورا بعض (امتحان يومي 6 بـ81 وامتحان يومي 7 بـ77)، فرجعتله «فرصة مكافأة».");
  assert.equal(byId("exam-x7").tone, "good");
  assert.equal(text("exam-x11"), "امتحان أسبوعي 11: جاب 12 من 100 وهو على صفر، فانفصل تلقائياً.");
  assert.equal(byId("exam-x11").balance.dismissed, true);
  assert.equal(text("exam-x12"), "امتحان يومي 12: انكتبتله 66 وهو مفصول، فانحفظت معلّقة وما انحسبت عليه.");
  assert.equal(text("exam-x13"), "امتحان يومي 13: نجح بـ70 من 100. نجاح 1 من 2 نحو «فرصة مكافأة».");
});

scenario("a pledge return is one event with the employee's name", () => {
  const returns = all.filter((event) => event.role === "return" && event.id.startsWith("log-"));
  assert.equal(returns.length, 1);
  assert.equal(storyEventText(returns[0]), "رجع بتعهّد وانعطى فرصتين.");
  assert.equal(returns[0].by, "أحمد");
  assert.equal(all.some((event) => event.id === "note-n-pledge"), false, "the pledge note is part of the return");
  assert.equal(all.some((event) => event.id === "audit-a4"), false, "the pledge audit row is part of the return");
});

scenario("manual deduction, data edit, code closing and registration name the employee", () => {
  assert.equal(text("log-m1"), "انخصمت فرصة يدوياً: مخالفة سلوكية.");
  assert.equal(byId("log-m1").by, "أحمد");
  assert.equal(text("audit-a6"), "تعدّلت بياناته: رقم ولي الأمر: 07701112233 ← 07712345678.");
  assert.equal(byId("audit-a5").by, "حسين");
  assert.equal(all.some((event) => event.id === "audit-a8"), false);
  assert.equal(text("audit-a7"), "انسجل بدورة السادس الإحيائي بكود BIO-2045.");
  assert.equal(byId("audit-a7").by, "زينب");
});

scenario("a dismissal cancelled later stays, struck, with why it was cancelled", () => {
  const event = byId("note-n-auto");
  assert.deepEqual(event.parts[0], { t: "انفصل يوم 29 أكتوبر 2026: غياب في امتحان يومي 9", s: true });
  assert.match(storyEventText(event), /انلغى الفصل ورجع تلقائياً: «فرصة مكافأة» انحسبت قبل الامتحان اللي فصله/);
  assert.equal(event.role, "return");
});

scenario("newest entry first, grouped by chapter then day", () => {
  assert.equal(story.groups.length, 1);
  assert.equal(story.groups[0].title, "الفصل الأول");
  const days = story.groups[0].days.map((day) => day.dayKey);
  assert.deepEqual(days, [...days].sort().reverse());
  // Exam 9 was entered on 3 November: it sits there, after exam 10.
  assert.equal(story.groups[0].days.find((day) => day.events.some((event) => event.id === "exam-x9")).dayKey, "2026-11-03");
  assert.equal(story.groups[0].days[0].dayKey, "2026-11-13");
  assert.equal(story.groups[0].days[0].title, "13 نوفمبر 2026");
});

scenario("summary, strip and open items", () => {
  const summary = story.summary.map((parts) => parts.map((part) => part.t).join(""));
  assert.equal(summary[0], "مصطفى كريم جاسم هسه نشط بالفصل الأول، وعنده فرصة وحدة من 3.");
  assert.match(summary.join(" "), /انفصل مرة وحدة بهالفصل، آخرها يوم 4 نوفمبر 2026، ورجع يوم 8 نوفمبر 2026\./);
  assert.match(summary.join(" "), /انخصمت عليه 5 فرص بهالفصل، ورجعتله «فرصة مكافأة»\./);
  assert.match(summary.join(" "), /13 امتحان بهالفصل: 4 نجاح، 1 راسب بدون خصم، 2 درجة خصم، 3 غياب، 2 ما انحسب/);
  assert.match(summary.join(" "), /باقي نجاح واحد ويرجعله «فرصة مكافأة»\./);
  assert.equal(story.strip.length, 13);
  assert.deepEqual(story.strip.map((item) => item.kind), ["pass", "loss", "neutral", "loss", "neutral", "pass", "pass", "fail", "loss", "loss", "loss", "pending", "pass"]);
  // The pieces a page lays out on its own are the summary's own lines.
  const plain = (parts) => parts.map((part) => part.t).join("");
  assert.equal(plain(story.lead), summary[0]);
  assert.deepEqual(story.highlights.map(plain), [
    "انفصل مرة وحدة بهالفصل، آخرها يوم 4 نوفمبر 2026، ورجع يوم 8 نوفمبر 2026.",
    "باقي نجاح واحد ويرجعله «فرصة مكافأة».",
  ]);
  assert.equal(plain(story.deducted), "انخصمت عليه 5 فرص بهالفصل، ورجعتله «فرصة مكافأة».");
  assert.deepEqual(story.counts, { total: 13, pass: 4, fail: 1, loss: 2, absent: 3, neutral: 2, pending: 1, missing: 0 });
  assert.equal(story.latest, story.groups[0].days[0].events[0]);
  // The newest follow-up is the unanswered call note of 1 November.
  assert.equal(story.latestFollowUp.dayKey, "2026-11-01");
  // A later call about an exam wins, at its own time and with the exam's name.
  const laterCall = buildStudentStory({ ...input, calls: [...input.calls,
    { id: "c9", examId: "x9", category: "absent", target: "parent", status: "تم الرد", completedAt: "2026-11-15T10:00:00.000Z", createdAt: "2026-11-15T09:50:00.000Z" }] });
  assert.equal(laterCall.latestFollowUp.dayKey, "2026-11-15");
  assert.match(plain(laterCall.latestFollowUp.parts), /^امتحان يومي 9: /);
  const open = story.openItems.map((parts) => parts.map((part) => part.t).join(""));
  assert.deepEqual(open, [
    "درجة امتحان يومي 12 (66) معلّقة تنتظر قرار.",
    "ملاحظة مكالمة 1 نوفمبر 2026 ما انتهت: ولي الأمر طلب نتصل بيه بعد أسبوع",
  ]);
});

scenario("the parent and student messages use WhatsApp bold and standard Arabic", () => {
  assert.match(story.parentMessage, /^السلام عليكم، ولي أمر الطالب \*مصطفى كريم جاسم\* المحترم\./);
  assert.match(story.parentMessage, /الطالب مستمر، ولديه \*فرصة واحدة\* من \*3\*\./);
  assert.match(story.parentMessage, /\*امتحان يومي 13\* \(\*13 نوفمبر 2026\*\): نجح بدرجة \*70\* من 100\./);
  assert.match(story.studentMessage, /^مرحباً \*مصطفى كريم جاسم\*،/);
  assert.match(story.studentMessage, /\*8 أكتوبر 2026\* — \*امتحان يومي 2\*: غبت، فخُصمت فرصة \(بقي لك \*2\*\)\./);
  assert.match(story.studentMessage, /\*8 نوفمبر 2026\* — أُعيد تفعيلك بتعهّد برصيد فرصتين\./);
  assert.match(story.studentMessage, /\*11 نوفمبر 2026\* — خُصمت فرصة بقرار الإدارة: مخالفة سلوكية\./);
  assert.doesNotMatch(story.studentMessage, /اتصلنا|ملاحظة مكالمة|حسين/, "internal follow-up never reaches the student");
});

scenario("stored dismissal reasons read as one plain sentence", () => {
  const plain = (raw) => storyDismissalReason(raw).replace(/\*\*/g, "");
  assert.equal(plain("تلقائي: مخالفة بعد انتهاء الفرص - غياب في امتحان يومي: امتحان يومي 10"), "غاب بامتحان يومي 10 وهو بدون فرص");
  assert.equal(plain("مخالفة بعد انتهاء الفرص - درجة خصم (12) في امتحان: الامتحان الشامل"), "جاب 12 بالامتحان الشامل وهو بدون فرص");
  assert.equal(plain("غش أول في امتحان: امتحان 4 - خصم جميع الفرص"), "غش بامتحان 4");
  assert.equal(plain("مخالفة بعد انتهاء الفرص - خصم يدوي: مخالفة سلوكية"), "انخصمت عليه فرصة يدوياً وهو بدون فرص: مخالفة سلوكية");
  assert.equal(plain("فصل الطالب: غياب متكرر بدون عذر"), "غياب متكرر بدون عذر");
  const zero = buildStudentStory({ ...input, student: { ...input.student, opportunities: 0 } });
  assert.equal(zero.summary[0].map((part) => part.t).join(""), "مصطفى كريم جاسم هسه نشط بالفصل الأول، وما باقي عنده فرص (0 من 3). أي خصم ثاني يفصله.");
  const dismissed = buildStudentStory({ ...input, student: { ...input.student, status: "مفصول", opportunities: 0,
    dismissalReason: "مخالفة بعد انتهاء الفرص - درجة خصم (12) في امتحان: امتحان أسبوعي 11", dismissedChecked: false } });
  assert.equal(dismissed.summary[0].map((part) => part.t).join(""), "مصطفى كريم جاسم مفصول من 4 نوفمبر 2026: جاب 12 بامتحان أسبوعي 11 وهو بدون فرص.");
  assert.equal(dismissed.openItems[0].map((part) => part.t).join(""), "مفصول وكوده ما انقفل لهسه.");
  assert.match(dismissed.parentMessage, /الطالب مفصول منذ \*4 نوفمبر 2026\*\./);
});

scenario("a student edit records what changed, and the story reads it back", () => {
  const { studentEditChanges, studentEditChangesSuffix } = require("../src/lib/student-edit-changes.ts");
  const changes = studentEditChanges(
    { name: "مصطفى", parentPhone: "07701112233", phone: "", school: "إعدادية | الكرادة", createdAt: "2026-10-05T07:15:00.000Z" },
    { name: "مصطفى", parentPhone: "07712345678", phone: "07801112233", school: "إعدادية | الكرادة", createdAt: "2026-10-06T07:15:00.000Z" },
  );
  assert.deepEqual(changes, [
    "رقم الطالب: فارغ ← 07801112233",
    "رقم ولي الأمر: 07701112233 ← 07712345678",
    "تاريخ التسجيل: 5 أكتوبر 2026 ← 6 أكتوبر 2026",
  ]);
  const facts = buildStoryAuditFacts([{ id: "e1", action: "تعديل بيانات طالب", userName: "زينب", time: "2026-11-12T07:32:00.000Z",
    details: `مصطفى - BIO-2045 - بدون تصفير${studentEditChangesSuffix(changes)}` }], { id: "st", code: "BIO-2045" });
  assert.deepEqual(facts.events[0].changes, changes);
  assert.equal(studentEditChangesSuffix([]), "", "an edit that changed nothing visible adds nothing");
});

console.log(`student story behavior: ${count} scenarios passed`);
