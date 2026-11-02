/** Fixed cleanup rules. Nothing here guesses: it only normalises what is written. */
import { FEMALE, MALE, type ExtractedGender } from "./names";

export const OUTSIDE_SCHOOL = "خارجي";
// نور + one of these is a boy's name; any other نور is a girl.
const NOOR_MALE = ["الدين", "العباس", "الحسين"];
const EDGE_PUNCT = " \t.-–—ـ:/،,؛;|*•\"'";

const PHONE_RUN = /\+?\d[\d \-()]{7,}\d/g;
const USERNAME = /[A-Za-z][A-Za-z0-9_]{2,}/;
const TME = /(?:t\.me|telegram\.me)\/([A-Za-z0-9_]+)/i;

export function collapseSpaces(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

export function toAsciiDigits(text: string): string {
  return (text || "").replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Strips any of `chars` from both ends, like Python's str.strip(chars). */
export function stripChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start += 1;
  while (end > start && chars.includes(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

/** Digits only, the Iraqi prefix and the leading zero removed. Length is never "fixed". */
export function cleanPhone(raw: string): string {
  let digits = toAsciiDigits(raw).replace(/\D/g, "");
  if (digits.startsWith("00964")) digits = digits.slice(5);
  else if (digits.startsWith("964") && digits.length >= 12) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

/** Distinct phone numbers written in a block (runs of 9+ digits). */
export function phonesInText(text: string): string[] {
  const found: string[] = [];
  for (const run of toAsciiDigits(text).match(PHONE_RUN) || []) {
    const phone = cleanPhone(run);
    if (phone.length >= 9 && !found.includes(phone)) found.push(phone);
  }
  return found;
}

export function cleanTelegram(raw: string): string {
  let text = (raw || "").trim();
  const link = TME.exec(text);
  if (link) return link[1];
  text = text.replace(/@/g, " ").replace(/\s*_\s*/g, "_");
  return USERNAME.exec(text)?.[0] ?? "";
}

export function cleanName(raw: string): string {
  return stripChars(collapseSpaces(raw), EDGE_PUNCT);
}

export function cleanSchool(raw: string): string {
  const school = stripChars(collapseSpaces(raw), EDGE_PUNCT);
  if (!school || school.includes("خارج")) return OUTSIDE_SCHOOL;
  return school;
}

export function govKey(text: string): string {
  let key = collapseSpaces(text)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي");
  if (key.startsWith("ال")) key = key.slice(2);
  return key.replace(/ /g, "");
}

/** Maps to one of the agreed names, or "" when it is not one of them. */
export function normalizeGovernorate(
  raw: string,
  governorates: readonly string[],
  aliases: Record<string, string>,
): string {
  if (!raw) return "";
  const lookup = new Map(governorates.map((name) => [govKey(name), name]));
  for (const [alias, target] of Object.entries(aliases)) {
    if (governorates.includes(target)) lookup.set(govKey(alias), target);
  }
  return lookup.get(govKey(raw)) ?? "";
}

/** Fixed rules that beat any guess. Returns "" when no rule applies. */
export function genderFromRules(name: string, school: string): ExtractedGender {
  const words = collapseSpaces(name).split(" ");
  const first = words[0] ?? "";
  if (first === "نور" && words.length > 1 && NOOR_MALE.includes(words[1])) return MALE;
  if (first.startsWith("نور") && NOOR_MALE.includes(first.slice(3))) return MALE;
  if (first === "نور" || first === "أزل" || first === "ازل") return FEMALE;
  if (school.includes("للبنات")) return FEMALE;
  if (school.includes("للبنين")) return MALE;
  return "";
}
