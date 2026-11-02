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
  /** «الحالة» and «الفرص» written for every student. */
  status: string;
  chances: string;
  /** First names whose gender was set by hand: name key -> «ذكر»/«أنثى». Beats every list. */
  learnedGenders: Record<string, string>;
  governorateAliases: Record<string, string>;
};

export const DEFAULT_EXTRACTOR_SETTINGS: ExtractorSettings = {
  adminSender: "اضافات الطلاب للاستاذ حسن فلاح",
  // Group invite links stay out of the code (this repository is public): each
  // one is set up the first time it shows up, and kept in the browser.
  links: {},
  status: "نشط",
  chances: "0",
  learnedGenders: {},
  governorateAliases: GOVERNORATE_ALIASES,
};
