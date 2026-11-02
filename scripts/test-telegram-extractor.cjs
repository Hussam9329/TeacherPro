// «استخراج من رسائل التليگرام» in «إضافة طلاب جماعية»: the same results as
// the desktop «مستخرج الطلاب» it was moved from.
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
  const dir = path.dirname(file);
  new Function("module", "exports", "require", output)(module, module.exports, (name) => {
    assert(name.startsWith("./"), `unexpected import ${name}`);
    return load(path.join(dir, `${name.slice(2)}.ts`));
  });
  return module.exports;
}

const extractor = load("src/lib/telegram-extractor/index.ts");
const c = load("src/lib/telegram-extractor/cleaning.ts");
const { genderOf } = load("src/lib/telegram-extractor/names.ts");
const { readBlock } = load("src/lib/telegram-extractor/rules.ts");
const { GOVERNORATES, GOVERNORATE_ALIASES, DEFAULT_EXTRACTOR_SETTINGS } = load("src/lib/telegram-extractor/config.ts");
const settings = () => JSON.parse(JSON.stringify(DEFAULT_EXTRACTOR_SETTINGS));
assert.deepEqual(DEFAULT_EXTRACTOR_SETTINGS.links, {}, "no group invite link is written in this public repo");
// Made-up links for the tests below.
const withLinks = () => ({
  ...settings(),
  links: {
    WinterLink1: { course: "الدورة الشتوية الثالثة", program: "منهج كامل", term: "", studyType: "مدمج", baghdadRegion: "" },
    SummerLink1: { course: "الدورة الصيفية", program: "منهج كامل", term: "", studyType: "إلكتروني", baghdadRegion: "بغداد - عموم بغداد" },
  },
});
const ADMIN = DEFAULT_EXTRACTOR_SETTINGS.adminSender;

// Phones.
for (const [raw, want] of Object.entries({
  "07712345678": "7712345678", "+964 771 234 5678": "7712345678", "00964 771 234 5678": "7712345678",
  "9647847299222+": "7847299222", "٠٧٧٣٨٩٠١٠٢٥": "7738901025", "0790 126 4732": "7901264732",
  "+07902564472": "7902564472", "075123": "75123", "+962 7 9625 3538": "962796253538",
})) assert.equal(c.cleanPhone(raw), want, raw);
assert.equal(c.phonesInText("07763213846\n07733888117\nzozo\n2657610").length, 2);

// Telegram handles.
for (const [raw, want] of Object.entries({
  "@lxolz": "lxolz", "HajerMA@": "HajerMA", "Spw _7": "Spw_7", "ha2008raaمعرف التلكلرام": "ha2008raa",
  "@M_1O9المعرف:": "M_1O9", "https://t.me/someone_1": "someone_1", "": "",
})) assert.equal(c.cleanTelegram(raw), want, raw);

// Governorates.
for (const [raw, want] of Object.entries({
  "ذي قار": "الناصرية", "الديوانيه": "الديوانية", "نجف": "النجف", "كربلاء المقدسه": "كربلاء",
  "الموصل": "نينوى", "ديالئ": "ديالى", "السماوة": "المثنى", "بغداد": "بغداد", "غماس": "",
})) assert.equal(c.normalizeGovernorate(raw, GOVERNORATES, GOVERNORATE_ALIASES), want, raw);

// Gender.
assert.equal(c.genderFromRules("نور الدين علي حسن", ""), "ذكر");
assert.equal(c.genderFromRules("نورالحسين علي حسن", ""), "ذكر");
assert.equal(c.genderFromRules("نور الهدى علي حسن", ""), "أنثى");
assert.equal(c.genderFromRules("علي حسن", "الانام للبنات"), "أنثى");
for (const [name, want] of Object.entries({
  "أزهار": "أنثى", "زهراء": "أنثى", "نوره": "أنثى", "البتول": "أنثى", "حمزة": "ذكر", "اسامه": "ذكر",
  "علاء": "ذكر", "طه": "ذكر", "البراء": "ذكر", "براء": "", "رضا": "", "عبدالله": "ذكر", "وعد": "", "صباح": "",
})) assert.equal(genderOf(name), want, name);
assert.equal(c.cleanSchool(""), "خارجي");
assert.equal(c.cleanSchool("اعدادية جمانه بنت أبي طالب(ع)."), "اعدادية جمانه بنت أبي طالب(ع)");

// A student's own message, tatweel used as a dash.
const got = readBlock("ـ أديان جعفر حاتم \nـ ثانويه الشمائل \nـ  07714328795\nـ-رقم ولي الامر: 07714417652\n- الكتروني من الفصل الثاني\nـ بغداد \nـ Sugadod", GOVERNORATE_ALIASES);
assert.equal(got.name, "أديان جعفر حاتم");
assert.equal(got.school, "ثانويه الشمائل");
assert.equal(got.governorate, "بغداد");
assert.equal(got.studentPhone, "7714328795");
assert.equal(got.guardianPhone, "7714417652");
assert.equal(got.telegram, "Sugadod");

// A whole chat: the admin's link decides the course, the reply is the student.
const head = "[02-Nov-26 01:00 AM] ";
const chat = [
  `${head}${ADMIN}: السلام عليكم\nيرجى إرسال المعلومات\nhttps://t.me/+SummerLink1`,
  `${head}Moon light: حوراء منار صحو عبد\nاعدادية العقيدة للبنات\n07701234567\nرقم ولي الامر 07801234567\nبغداد\n@hawra_1`,
  `${head}Moon light: [ Photo ]`,
].join("\n");
const one = extractor.extractStudents(chat, withLinks());
assert.equal(one.rows.length, 1);
assert.deepEqual(one.rows[0].cells, [
  "حوراء منار صحو عبد", "اعدادية العقيدة للبنات", "أنثى", "الدورة الصيفية", "منهج كامل", "", "إلكتروني",
  "بغداد", "بغداد - عموم بغداد", "نشط", "0", "7701234567", "7801234567", "hawra_1",
]);
assert.deepEqual(one.rows[0].warnings, {});
assert.equal(extractor.rowsToText(one.rows).split("\t").length, 14, "14 columns, as the bulk add reads them");

// An unknown link is reported and its students wait for it to be set up.
const unknown = extractor.extractStudents(chat.replace("SummerLink1", "NewLink123"), withLinks());
assert.deepEqual(unknown.unknownLinks, ["NewLink123"]);
assert.equal(unknown.rows.length, 0);
assert.equal(unknown.skipped, 1);

// A gender set by hand is remembered for the first name.
const learned = withLinks();
assert(extractor.learnGender(learned, "وعد علي حسن", "أنثى"));
const waad = extractor.extractStudents(`${head}${ADMIN}: https://t.me/+WinterLink1\n${head}W: وعد كريم جاسم\nبغداد\n07701112233`, learned);
assert.equal(waad.rows[0].cells[2], "أنثى");
assert.equal(extractor.learnGender(learned, "علي", "غلط"), "");

// The full sample of the desktop app (kept outside this public repo: it holds
// real students). Every student must come out exactly as the app did.
const sample = process.env.STUDENT_EXTRACTOR_FIXTURES
  || path.join(process.env.USERPROFILE || process.env.HOME || "", "Documents", "Hussam-Automation", "student-extractor", "tests", "fixtures");
const desktopConfig = path.join(sample, "..", "..", "src", "extractor", "config.py");
if (fs.existsSync(path.join(sample, "input.txt")) && fs.existsSync(desktopConfig)) {
  // The desktop app's links, read from its own settings file.
  const real = settings();
  const linkPattern = /"([A-Za-z0-9_-]{8,})": \{"course": "([^"]*)", "main": "([^"]*)", "sub": "([^"]*)",\s*"exam": "([^"]*)", "region_mode": "([^"]*)", "region_value": "([^"]*)"\}/g;
  for (const [, link, course, program, term, studyType, mode, region] of fs.readFileSync(desktopConfig, "utf8").matchAll(linkPattern)) {
    real.links[link] = { course, program, term, studyType, baghdadRegion: mode === "fixed" ? region : "" };
  }
  assert.equal(Object.keys(real.links).length, 4, "the desktop app's four links");
  const result = extractor.extractStudents(fs.readFileSync(path.join(sample, "input.txt"), "utf8"), real);
  const expected = fs.readFileSync(path.join(sample, "expected.tsv"), "utf8").split(/\r?\n/).filter(Boolean)
    .map((line) => { const cells = line.split("\t"); cells.splice(11, 1); return cells; }); // no «السماح» column here
  assert.equal(result.rows.length, expected.length);
  result.rows.forEach((row, index) => assert.deepEqual(row.cells, expected[index], `row ${index + 1}`));
  const template = fs.readFileSync(path.join(sample, "template_filled.txt"), "utf8");
  assert.deepEqual(extractor.extractStudents(template, real).rows.map((row) => row.cells), [[
    "حسين علي هادي كاظم", "خارجي", "ذكر", "الدورة الشتوية الثالثة", "منهج كامل", "", "مدمج",
    "بغداد", "", "نشط", "0", "7708497299", "7700011656", "Hoidv",
  ]]);
  console.log(`  full sample: ${expected.length} students match the desktop app`);
}

// Wiring into «إضافة طلاب جماعية».
const bulk = fs.readFileSync(path.join(root, "src/components/teacher-pro/student-bulk-text-import.tsx"), "utf8");
assert(bulk.includes("<TelegramExtractDialog"), "the bulk add page opens the extractor");

console.log("PASS: Telegram registration messages become bulk-add rows, as in «مستخرج الطلاب»");
