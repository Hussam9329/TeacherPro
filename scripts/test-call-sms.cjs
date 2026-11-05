// «إرسال رسالة نصية» in «المكالمات»: the follow-up text and its sms: link.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const cache = new Map();
function load(file) {
  const full = path.join(root, file);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const output = ts.transpileModule(fs.readFileSync(full, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("module", "exports", "require", output)(module, module.exports, (name) => {
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
    if (name.startsWith("./")) return load(path.join(path.dirname(file), `${name.slice(2)}.ts`));
    return require(name);
  });
  return module.exports;
}
const { callSmsHref, callSmsMessage } = load("src/lib/call-sms.ts");

const base = {
  studentName: "سارة كريم جواد",
  examName: "الفصل الثالث - نبات 4",
  examDate: "31 تشرين الأول 2026",
  chapterName: "الفصل الثالث",
  score: "22/50",
  absent: false,
  action: "",
};

// A grade, no deduction: the «الإجراء المتخذ» line is left out.
assert.equal(callSmsMessage(base), [
  "السلام عليكم ورحمة الله وبركاته",
  "نود إعلام حضرتكم بأنه قد تم الاتصال على رقمكم الخاص بخصوص الطالب سارة كريم جواد، وذلك لإبلاغكم بنتيجة امتحان الفصل الثالث - نبات 4 الذي أُجري بتاريخ 31 تشرين الأول 2026، والخاص بـالفصل الثالث.",
  "حيث حصل الطالب على درجة 22/50.",
  "نرجو من حضرتكم متابعة المستوى الدراسي للطالب والاهتمام بأدائه في الامتحانات القادمة.",
  "مع خالص الشكر والتقدير لتعاونكم واهتمامكم.",
  "قسم المتابعة – الأستاذ حسن فلاح لمادة الأحياء",
].join("\n"));

// Absent with a deduction: the absence sentence and the action line.
const absent = callSmsMessage({ ...base, absent: true, score: "غائب", action: "غائب وتم الخصم" }).split("\n");
assert.equal(absent[2], "حيث كان الطالب غائباً عن الامتحان.");
assert.equal(absent[3], "الإجراء المتخذ: غائب وتم الخصم.");

// No date or chapter: those parts are left out, not printed empty.
assert.equal(
  callSmsMessage({ ...base, examDate: "", chapterName: "" }).split("\n")[1],
  "نود إعلام حضرتكم بأنه قد تم الاتصال على رقمكم الخاص بخصوص الطالب سارة كريم جواد، وذلك لإبلاغكم بنتيجة امتحان الفصل الثالث - نبات 4.",
);

// The link: the local dialling form, the message encoded; no number, no link.
const href = callSmsHref("+9647701234567", "مرحبا\nسطر");
assert.equal(href, `sms:07701234567?body=${encodeURIComponent("مرحبا\nسطر")}`);
assert.equal(decodeURIComponent(href.split("?body=")[1]), "مرحبا\nسطر");
assert.equal(callSmsHref("", "x"), "");

// The card shows it under «اتصال من اللابتوب», only for a card with an exam.
const card = fs.readFileSync(path.join(root, "src/components/teacher-pro/follow-up.tsx"), "utf8");
assert(/اتصال من اللابتوب[\s\S]{0,400}row\.focusItem && \([\s\S]{0,200}callSmsHref\(phone, callSmsText\(row\)\)/.test(card));
assert(card.includes('badge.tone === "deducted"'), "only a deduction or dismissal is reported");

console.log("PASS: «إرسال رسالة نصية» fills the follow-up text and opens «ارتباط الهاتف»");
