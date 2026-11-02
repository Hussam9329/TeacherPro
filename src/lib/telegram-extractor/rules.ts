/**
 * Reader: pulls each student's fields from their block using labels, line
 * order and word lists. No internet. Weaker on unlabeled schools and rare
 * names; the review warnings catch most of it.
 */
import { cleanPhone, cleanTelegram, collapseSpaces, govKey, normalizeGovernorate, toAsciiDigits } from "./cleaning";
import { GOVERNORATES } from "./config";
import { genderOf } from "./names";
import type { StudentBlock } from "./parser";

export type ExtractedFields = {
  name: string;
  school: string;
  gender: string;
  governorate: string;
  baghdadArea: string;
  studentPhone: string;
  guardianPhone: string;
  telegram: string;
  note: string;
};

// "ـ" (tatweel) is used as a dash by many students.
const BULLET = /^[\s\-–—•*·①②③+ـ]+/;
const PHONE = /\+?\d[\d \-()]{7,}\d\+?/g;
const LATIN = /[A-Za-z][A-Za-z0-9_]{2,}/;
const ARABIC = /[ء-ي]/;

const NAME_LABEL = /^(?:الاسم\s*الرباعي|الاسم\s*الثلاثي|الاسم|لاسم)(?=[\s:：\-/.]|$)[\s:：\-/.]*/;
const SCHOOL_LABEL = /^(?:المدرسة|المدرسه)(?=[\s:：\-/.]|$)[\s:：\-/.]*/;
const GOV_LABEL = /^(?:المحافظة|المحافظه)(?=[\s:：\-/.]|$)[\s:：\-/.]*/;
const TG_LABEL = /^(?:معرف|يوزر)/;
const SUB_LABEL = /^(?:نوع|الاشتراك|اشتراك|السعر|صورة|صوره|وصل|الوصل)/;

const GUARDIAN_WORDS = ["ولي", "والد", "الاب", "الأب", "ابي", "أبي", "ابوي", "أبوي", "بابا", "الام", "الأم",
  "امي", "أمي", "ماما", "اهلي", "أهلي"];
const FATHER_WORDS = ["والد", "الاب", "الأب", "ابي", "أبي", "ابوي", "أبوي", "بابا"];
const STUDENT_LABEL = /(?:رقم\s*الطالب|رقم\s*طالب|رقمي|الشخصي|^رقم|^الرقم)/;

// "كامل" is left out on purpose: it is also a common name ("منهج كامل" is still caught by "منهج").
const NOISE_WORDS = new Set([
  "منهج", "المنهج", "حضوري", "مدمج", "دورة", "دوره", "الدورة", "الدوره", "اقساط", "احياء",
  "وصل", "الوصل", "صوره", "صورة", "ماستر", "مجاني", "التطبيق", "هسه", "ادز", "كورس", "دفعة", "دفعه",
  "جمعة", "جمعه", "الف", "السلام", "عليكم",
]);
const NOISE_STEMS = ["الكترون", "إلكترون", "الالكترون", "اكترون", "امتحان", "متحان", "اشتراك", "شتراك",
  "مرماز", "شتوي", "دفع", "تسجيل"];
const SCHOOL_WORDS = ["اعدادية", "اعداديه", "إعدادية", "ثانوية", "ثانويه", "مدرسة", "مدرسه", "للبنات", "للبنين",
  "اكاديمية", "أكاديمية", "متوسطة", "عدادية"];

const hasAny = (line: string, words: string[]) => words.some((word) => line.includes(word));
const words = (line: string) => line.split(/[\s_/\-.,،:()]+/).filter(Boolean);

function isNoise(line: string): boolean {
  if (line.includes("؟") || line.includes("?")) return true;
  return words(line).some((word) => {
    const bare = word.replace(/^\d+/, "");
    return NOISE_WORDS.has(word) || NOISE_WORDS.has(bare) || NOISE_STEMS.some((stem) => word.startsWith(stem));
  });
}

const looksLikeSchool = (line: string) => hasAny(line, SCHOOL_WORDS);

/** True when a and b differ by at most one letter (typo). */
function edit1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
    return diff <= 1;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i += 1) {
    if (short === long.slice(0, i) + long.slice(i + 1)) return true;
  }
  return false;
}

/** Governorate written at the start of text: exact, alias, or a one-letter typo. */
function governorate(text: string, aliases: Record<string, string>): string {
  const parts = words(text);
  for (const n of [3, 2, 1]) {
    if (parts.length >= n) {
      const found = normalizeGovernorate(parts.slice(0, n).join(" "), GOVERNORATES, aliases);
      if (found) return found;
    }
  }
  if (parts.length && parts[0].length >= 4) {
    const first = govKey(parts[0]);
    const typo = GOVERNORATES.find((name) => edit1(first, govKey(name)));
    if (typo) return typo;
  }
  return "";
}

const phonesOf = (line: string) =>
  (toAsciiDigits(line).match(PHONE) || []).map(cleanPhone).filter((phone) => phone.length >= 9);

export function readBlock(text: string, aliases: Record<string, string>): ExtractedFields {
  let name = "";
  let school = "";
  let gov = "";
  let telegram = "";
  let weakTelegram = "";
  const students: string[] = [];
  const guardians: string[] = [];
  const fathers: string[] = [];
  const unlabeled: string[] = [];
  const free: string[] = [];
  let note = "";
  let schoolLabeled = false;

  for (const raw of text.split("\n")) {
    const line = toAsciiDigits(raw).replace(BULLET, "").trim();
    if (!line) continue;
    const phones = phonesOf(line);

    let match = NAME_LABEL.exec(line);
    if (match && !phones.length) {
      name = name || line.slice(match[0].length);
      continue;
    }
    match = SCHOOL_LABEL.exec(line);
    if (match) {
      school = school || line.slice(match[0].length);
      schoolLabeled = true; // "المدرسة:" left empty means no school, not "take the next line"
      continue;
    }
    match = GOV_LABEL.exec(line);
    if (match) {
      gov = gov || governorate(line.slice(match[0].length), aliases);
      continue;
    }
    if (TG_LABEL.test(line)) {
      telegram = telegram || cleanTelegram(line);
      continue;
    }

    const guardianLine = hasAny(line, GUARDIAN_WORDS);
    if (phones.length || STUDENT_LABEL.test(line) || guardianLine) {
      if (guardianLine && (phones.length || line.includes("رقم"))) {
        if (line.includes("نفسه")) students.push(...phones);
        guardians.push(...phones);
        if (hasAny(line, FATHER_WORDS)) fathers.push(...phones);
        continue;
      }
      if (STUDENT_LABEL.test(line) && line.includes("رقم")) {
        students.push(...phones);
        continue;
      }
      if (phones.length) {
        unlabeled.push(...phones);
        const rest = toAsciiDigits(line).replace(PHONE, "").trim();
        if (rest.includes("خارج")) school = school || "خارجي";
        continue;
      }
    }

    if (SUB_LABEL.test(line) || isNoise(line)) {
      gov = gov || (looksLikeSchool(line) ? "" : governorate(line, aliases));
      weakTelegram = weakTelegram || cleanTelegram(line);
      continue;
    }

    if (LATIN.test(line)) {
      if (!guardianLine) telegram = telegram || cleanTelegram(line);
      continue;
    }

    if (!ARABIC.test(line)) continue;
    if (!looksLikeSchool(line)) {
      const found = governorate(line, aliases);
      if (found && words(line).length <= 3) {
        gov = gov || found;
        continue;
      }
    }
    free.push(line);
  }

  if (free.length && !name) name = free.shift() ?? "";
  if (free.length && !school && !schoolLabeled) school = free.shift() ?? "";

  // Phones: explicit labels first, then the written order.
  const order = [...new Set(unlabeled)].filter((phone) => !students.includes(phone) && !guardians.includes(phone));
  const student = students[0] ?? order.shift() ?? "";
  let guardian = (fathers.length ? fathers : guardians)[0] ?? "";
  if (!guardian && order.length) guardian = order.shift() ?? "";
  if (order.length) note = "أكو أرقام زايدة بالرسالة، راجع توزيع الأرقام";

  const firstWord = collapseSpaces(name).split(" ")[0] ?? "";
  return {
    name,
    school,
    gender: firstWord ? genderOf(firstWord) : "",
    governorate: gov,
    baghdadArea: "",
    studentPhone: student,
    guardianPhone: guardian,
    telegram: telegram || weakTelegram,
    note,
  };
}

export function extractBlocks(blocks: StudentBlock[], aliases: Record<string, string>): Map<number, ExtractedFields> {
  return new Map(blocks.map((block) => [block.blockId, readBlock(block.text, aliases)]));
}
