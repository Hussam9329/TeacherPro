/**
 * Finding a Mirmaz student by name, exactly as «أداة مرماز» (the team's
 * Tampermonkey script, section 20) finds a student for «اغلاق الكودات»:
 * the same spelling unification, the same word-by-word comparison of the
 * first four words, the same tolerance of «ال» and of one wrong letter in a
 * long word, and the same verdicts («مطابق» / «محتمل»).
 *
 * The tool has to go through the platform's own search, which tells رقية
 * from رقيه; here every student is compared directly, so nothing is missed
 * on the way.
 */

const NAME_MARKS = /[ً-ٰٟـ]/g; // التشكيل والتطويل

/** أ/إ/آ←ا، ة←ه، ى←ي، ؤ←و، ئ←ي، بدون ء، و«عبد الله» = «عبدالله». */
export function normalizeArabicName(value: unknown): string {
  return String(value ?? "")
    .replace(NAME_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/[^ء-يa-zA-Z0-9]+/g, " ")
    .replace(/(^| )عبد /g, "$1عبد")
    .trim()
    .toLowerCase();
}

export const nameWords = (value: unknown): string[] => normalizeArabicName(value).split(" ").filter(Boolean);

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** Two words are one after unification, or differ by «ال» at the start, or by one letter in a word of 4+ letters. */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b || a.replace(/^ال/, "") === b.replace(/^ال/, "")) return true;
  return Math.min(a.length, b.length) >= 4 && editDistance(a, b) <= 1;
}

export type NameMatch = {
  /** Words that match, in order (name, father, grandfather, …), among the first four. */
  matched: number;
  /** Words compared: the shorter of the two names, up to four. */
  of: number;
  /** «الاسم مطابق»: every compared word matches (at least two). */
  full: boolean;
  /** «محتمل»: the first name and another word, or three words. */
  likely: boolean;
};

export function compareNames(wanted: unknown, candidate: unknown): NameMatch {
  const a = nameWords(wanted).slice(0, 4);
  const b = nameWords(candidate).slice(0, 4);
  const of = Math.min(a.length, b.length);
  let matched = 0;
  for (let i = 0; i < of; i += 1) if (wordsMatch(a[i], b[i])) matched += 1;
  const first = of > 0 && wordsMatch(a[0], b[0]);
  return { matched, of, full: of >= 2 && matched === of, likely: (first && matched >= 2) || matched >= 3 };
}

/**
 * Every student whose name is «محتمل» or better, closest first (full matches,
 * then more words matched) — the order the tool lists them in.
 */
export function findStudentsByName<T extends { name: string }>(name: string, students: T[]): Array<T & { nameMatch: NameMatch }> {
  return students
    .map((student) => ({ ...student, nameMatch: compareNames(name, student.name) }))
    .filter((student) => student.nameMatch.likely)
    .sort((x, y) => Number(y.nameMatch.full) - Number(x.nameMatch.full) || y.nameMatch.matched - x.nameMatch.matched);
}
