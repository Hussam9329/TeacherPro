/** The extractor's fixed lists and its default settings. */

// The agreed governorate names. Nothing outside this list is ever written.
export const GOVERNORATES = [
  "بغداد", "البصرة", "نينوى", "أربيل", "السليمانية", "دهوك", "حلبجة", "كركوك",
  "ديالى", "الأنبار", "صلاح الدين", "بابل", "كربلاء", "النجف", "واسط", "ميسان",
  "الناصرية", "الديوانية", "المثنى",
] as const;

// Spelling variants -> agreed name. Matching ignores ة/ه, ى/ي, أ/إ/آ and a leading "ال".
export const GOVERNORATE_ALIASES: Record<string, string> = {
  "ذي قار": "الناصرية", "ذيقار": "الناصرية", "الناصريه": "الناصرية",
  "القادسية": "الديوانية", "الدوانية": "الديوانية",
  "نجف": "النجف", "النجف الأشرف": "النجف",
  "كربلاء المقدسة": "كربلاء",
  "الانبار": "الأنبار",
  "اربيل": "أربيل",
  "سليمانية": "السليمانية",
  "الموصل": "نينوى", "نينوي": "نينوى",
  "ديالئ": "ديالى",
  "السماوة": "المثنى",
  "البصره": "البصرة",
};

/** What a Telegram group link means: the course every student who joined it is registered in. */
export type ExtractorLink = {
  course: string;
  /** «نظام الاشتراك»: منهج كامل / كورسات. */
  program: string;
  /** «الكورس المطلوب», for كورسات only. */
  term: string;
  /** «نظام الدراسة»; «حضوري» is always written as «مدمج». */
  studyType: string;
  /** «الموقع الفرعي» for Baghdad students; empty leaves it to the course's default. */
  baghdadRegion: string;
};

export type ExtractorSettings = {
  /** The management account's name as Telegram shows it on its messages. */
  adminSender: string;
  links: Record<string, ExtractorLink>;
  /** «الحالة»، «الفرص» and «السماح» written for every student. */
  status: string;
  chances: string;
  grace: string;
  governorateAliases: Record<string, string>;
};

export const DEFAULT_EXTRACTOR_SETTINGS: ExtractorSettings = {
  adminSender: "اضافات الطلاب للاستاذ حسن فلاح",
  // Group invite links stay out of the code (this repository is public): the
  // known ones come from the server (TELEGRAM_EXTRACTOR_LINKS), a new one is
  // set up the first time it shows up and kept in the browser.
  links: {},
  status: "نشط",
  chances: "0",
  grace: "0 يوم",
  governorateAliases: GOVERNORATE_ALIASES,
};

const LINK_ID = /^[A-Za-z0-9_-]{4,64}$/;
const LINK_FIELDS = ["course", "program", "term", "studyType", "baghdadRegion"] as const;

/** Keeps only well-formed links ({ id: { course, program, term, studyType, baghdadRegion } }). */
export function readExtractorLinks(value: unknown): Record<string, ExtractorLink> {
  const links: Record<string, ExtractorLink> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return links;
  for (const [id, raw] of Object.entries(value)) {
    if (!LINK_ID.test(id) || !raw || typeof raw !== "object") continue;
    const config = raw as Record<string, unknown>;
    if (!LINK_FIELDS.every((field) => typeof config[field] === "string") || !config.course) continue;
    links[id] = Object.fromEntries(LINK_FIELDS.map((field) => [field, (config[field] as string).trim()])) as ExtractorLink;
  }
  return links;
}
