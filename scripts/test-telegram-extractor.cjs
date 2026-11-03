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
assert.equal(c.cleanSchool("اعدادية جمانه بنت أبي طالب(ع)."), "جمانه بنت أبي طالب(ع)");
// Only the school's name is kept: its kind (مدرسة، اعدادية، ثانوية، متوسطة) is dropped.
assert.equal(c.cleanSchool("مدرسة اعداديه الفردوس للبنات"), "الفردوس للبنات");
assert.equal(c.cleanSchool("الاعدادية المركزية"), "المركزية");
assert.equal(c.cleanSchool("متوسطه الرواد"), "الرواد");
assert.equal(c.cleanSchool("اعدادية"), "اعدادية", "a school written only as its kind keeps it");
assert.equal(c.cleanSchool("خارجي"), "خارجي");

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
  "حوراء منار صحو عبد", "العقيدة للبنات", "أنثى", "الدورة الصيفية", "منهج كامل", "", "إلكتروني",
  "بغداد", "بغداد - عموم بغداد", "نشط", "0", "0 يوم", "7701234567", "7801234567", "hawra_1",
]);
assert.equal(extractor.rowsToText(one.rows).split("\t").length, 15, "the desktop app's 15 columns");
const bulkSource = fs.readFileSync(path.join(root, "src/components/teacher-pro/student-bulk-text-import.tsx"), "utf8");
assert(bulkSource.includes("cells.length === EXPECTED_COLUMNS + 1") && bulkSource.includes("LEGACY_GRACE_COLUMN_INDEX = 11"),
  "the bulk add reads the 15 columns and leaves «السماح» out");

// Known links come from the server setting; anything malformed is dropped.
const { readExtractorLinks } = extractor;
const good = { course: "الدورة الشتوية الثالثة", program: "منهج كامل", term: "", studyType: "مدمج", baghdadRegion: "" };
assert.deepEqual(readExtractorLinks({ WinterLink1: good, "bad link!": good, NoCourse1: { ...good, course: "" }, Short1: { course: "x" } }), { WinterLink1: good });
assert.deepEqual(readExtractorLinks(null), {});
assert.deepEqual(readExtractorLinks([good]), {});
const linksRoute = fs.readFileSync(path.join(root, "src/app/api/telegram-extractor/links/route.ts"), "utf8");
assert(linksRoute.includes('requirePermissionPrincipal(req, "students.add")') && linksRoute.includes("TELEGRAM_EXTRACTOR_LINKS"),
  "the links reach only staff who add students");

// An unknown link is reported and its students wait for it to be set up.
const unknown = extractor.extractStudents(chat.replace("SummerLink1", "NewLink123"), withLinks());
assert.deepEqual(unknown.unknownLinks, ["NewLink123"]);
assert.equal(unknown.rows.length, 0);
assert.equal(unknown.skipped, 1);

// A name used for both genders is left empty, so the bulk add's check flags it.
const waad = extractor.extractStudents(`${head}${ADMIN}: https://t.me/+WinterLink1
${head}W: وعد كريم جاسم
بغداد
07701112233`, withLinks());
assert.equal(waad.rows[0].cells[2], "");

// The template's empty «المدرسة:» doesn't hide the school the student wrote, and «رقمي» beats a bare «رقم».
const reply = extractor.extractStudents([
  "[02-Nov-26 4:18 PM] اضافات الطلاب للاستاذ حسن فلاح: السلام عليكم ، إدارة الأستاذ حسن فلاح",
  "1️⃣ تأكد من معلوماتك المسجلة عدنا:", "الاسم الرباعي: سارة كريم جواد سالم", "رقم الطالب: 07811111111",
  "رقم ولي الأمر: 07811111111", "المحافظة: بغداد", "معرف التليكرام: @test_s", "2️⃣ اكتب المعلومات الناقصة جنب كل سطر:",
  "المدرسة:", "https://t.me/+WinterLink1",
  "[02-Nov-26 4:25 PM] سارة كريم: الاسم سارة كريم جواد سالم", "مدرسه الاصيل ", "رقم والي امري 07811111111",
  "رقمي 07722222222", "محافظه بغداد", "معرف تلي",
].join("\n"), withLinks());
assert.deepEqual(reply.rows.map((row) => row.cells), [[
  "سارة كريم جواد سالم", "الاصيل", "أنثى", "الدورة الشتوية الثالثة", "منهج كامل", "", "مدمج",
  "بغداد", "", "نشط", "0", "0 يوم", "7722222222", "7811111111", "test_s",
]]);

// The school is found wherever it is written; small talk is never taken for it.
const schoolOf = (text) => readBlock(text, GOVERNORATE_ALIASES).school;
assert.equal(schoolOf("زينب علي حسن\nاني طالبة بثانوية الرواد للبنات\n07701234567"), "ثانوية الرواد للبنات");
assert.equal(schoolOf("زينب علي حسن\nاسم المدرسة هي النخبة\n07701234567"), "النخبة");
assert.equal(schoolOf("زينب علي حسن\nمدرستي الفرات\n07701234567"), "الفرات");
assert.equal(schoolOf("زينب علي حسن\nشكرا\nالوفاق للبنات\n07701234567"), "الوفاق للبنات");
assert.equal(schoolOf("زينب علي حسن\nتمام\n07701234567"), "");
// «مدرسة / مدرستي / المدرسة / اداوم / دوامي» are caught anywhere in a line.
const cleanSchoolOf = (text) => c.cleanSchool(schoolOf(text));
assert.equal(cleanSchoolOf("زينب علي حسن\nانا اداوم بالاصيل\n07701234567"), "الاصيل");
assert.equal(cleanSchoolOf("زينب علي حسن\nاداوم بثانوية الرواد للبنات\n07701234567"), "الرواد للبنات");
assert.equal(cleanSchoolOf("زينب علي حسن\nاسمي زينب ومدرستي الفرات\n07701234567"), "الفرات");
assert.equal(cleanSchoolOf("زينب علي حسن\nالمدرسة اللي اداوم بيها النخبة\n07701234567"), "النخبة");
assert.equal(cleanSchoolOf("زينب علي حسن\nدوامي بمدرسة الكوثر\n07701234567"), "الكوثر");
assert.equal(cleanSchoolOf("زينب علي حسن\nانا بمدرسة اسمها الهدى\n07701234567"), "الهدى");

// The newer template («أول شي: أرسل اسم مدرستك»): «واسم المدرسه» only announces it, «ثانوية …» names it;
// «رقم الولد» (the father) replaces the guardian's number.
const announced = extractor.extractStudents([
  "[03-Nov-26 5:32 PM] اضافات الطلاب للاستاذ حسن فلاح: السلام عليكم ، إدارة الأستاذ حسن فلاح",
  "1️⃣ ✍️ أول شي: أرسل اسم مدرستك هنا.", "2️⃣ تأكد من معلوماتك المسجلة عدنا:",
  "الاسم الرباعي: سراج كريم جواد سالم", "رقم الطالب: 07700000033", "رقم ولي الأمر: 07700000033",
  "المحافظة: نينوى", "معرف التليكرام: @test_s3", "https://t.me/+WinterLink1",
  "[03-Nov-26 5:35 PM] سراج: رقم الولد 07700000044",
  "[03-Nov-26 5:35 PM] سراج: واسم المدرسه",
  "[03-Nov-26 5:35 PM] سراج: ثانوية اسيا",
].join("\n"), withLinks());
assert.deepEqual(announced.rows.map((row) => row.cells), [[
  "سراج كريم جواد سالم", "اسيا", "ذكر", "الدورة الشتوية الثالثة", "منهج كامل", "", "مدمج",
  "نينوى", "", "نشط", "0", "0 يوم", "7700000033", "7700000044", "test_s3",
]]);

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
    .map((line) => line.split("\t"))
    // The desktop app kept the school's kind («ثانوية …»); here only the name is kept.
    .map((cells) => cells.map((cell, column) => (column === 1 ? c.cleanSchool(cell) : cell)));
  assert.equal(result.rows.length, expected.length);
  result.rows.forEach((row, index) => assert.deepEqual(row.cells, expected[index], `row ${index + 1}`));
  const template = fs.readFileSync(path.join(sample, "template_filled.txt"), "utf8");
  assert.deepEqual(extractor.extractStudents(template, real).rows.map((row) => row.cells), [[
    "حسين علي هادي كاظم", "خارجي", "ذكر", "الدورة الشتوية الثالثة", "منهج كامل", "", "مدمج",
    "بغداد", "", "نشط", "0", "0 يوم", "7708497299", "7700011656", "Hoidv",
  ]]);
  console.log(`  full sample: ${expected.length} students match the desktop app`);
}

// What counts as registration messages when pasted into the bulk add box.
const template = [
  "السلام عليكم ، إدارة الأستاذ حسن فلاح", "1️⃣ تأكد من معلوماتك المسجلة عدنا:", "الاسم الرباعي: مصطفى كريم جواد سالم",
  "رقم الطالب: 07700000011", "رقم ولي الأمر: 07800000022", "المحافظة: بغداد", "معرف التليكرام: @test_user7",
  "المدرسة: ثانوية النموذج للبنين", "https://t.me/+WinterLink1",
].join("\n");
assert(extractor.looksLikeRegistrationText("[02-Nov-26 9:43 AM] احمد: مرحبا"), "a Telegram chat");
assert(extractor.looksLikeRegistrationText(template), "the template pasted on its own");
assert(!extractor.looksLikeRegistrationText("مراد سلمان سرحان\tالياسمين للبنين\tذكر"), "bulk add rows");
assert.deepEqual(extractor.extractStudents(template, withLinks()).rows.map((row) => row.cells), [[
  "مصطفى كريم جواد سالم", "النموذج للبنين", "ذكر", "الدورة الشتوية الثالثة", "منهج كامل", "", "مدمج",
  "بغداد", "", "نشط", "0", "0 يوم", "7700000011", "7800000022", "test_user7",
]]);

// Wiring into «إضافة طلاب جماعية».
const bulk = fs.readFileSync(path.join(root, "src/components/teacher-pro/student-bulk-text-import.tsx"), "utf8");
assert(bulk.includes("useTelegramExtractor(") && bulk.includes("{telegram.dialog}"), "the bulk add page runs the extractor");
assert(/onPaste=\{[\s\S]*?looksLikeRegistrationText\(pasted\)[\s\S]*?telegram\.extract\(/.test(bulk), "a pasted Telegram chat turns into rows by itself");
// toast.error always reads «تعذر الحفظ», so the extractor's guidance must not use it.
const extractDialog = fs.readFileSync(path.join(root, "src/components/teacher-pro/telegram-extract-dialog.tsx"), "utf8");
assert.deepEqual([...extractDialog.matchAll(/toast\.error\("([^"]+)"/g)].map((match) => match[1]),
  ["ما انحفظت الإعدادات بهذا المتصفح."], "only a real save failure is shown as «تعذر الحفظ»");
// The server's links win: a stale copy in one browser can't give another course or study type.
assert(extractDialog.includes("links: { ...local.links, ...server }"), "server links beat this browser's");
assert(/if \(!config\.course \|\| id in server\) continue;/.test(extractDialog), "server links are never saved over in a browser");

console.log("PASS: Telegram registration messages become bulk-add rows, as in «مستخرج الطلاب»");
