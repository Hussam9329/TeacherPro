/**
 * «استخراج من رسائل التليگرام»: turns registration messages copied from
 * Telegram into rows of «إضافة طلاب جماعية»: the desktop app's 15 tab-separated
 * columns («السماح» included; the bulk add reads it and leaves it out).
 *
 * 1. The text is split into one block per student (parser).
 * 2. Each block's fields are read from labels and line order (rules).
 * 3. The group link decides the course; fixed rules clean the rest; every row
 *    gets review warnings, and duplicates inside the batch are dropped.
 */
import {
  cleanName,
  cleanPhone,
  cleanSchool,
  cleanTelegram,
  collapseSpaces,
  genderFromRules,
  normalizeGovernorate,
  phonesInText,
} from "./cleaning";
import { GOVERNORATES, type ExtractorSettings } from "./config";
import { FEMALE, MALE, nameKey } from "./names";
import { splitStudents, type StudentBlock } from "./parser";
import { extractBlocks, type ExtractedFields } from "./rules";

export { DEFAULT_EXTRACTOR_SETTINGS, GOVERNORATES, readExtractorLinks, type ExtractorLink, type ExtractorSettings } from "./config";
export { FEMALE, MALE } from "./names";
export { genderFromRules } from "./cleaning";

const BAGHDAD = "بغداد";

/** The 15 columns, in order. */
export const COL = {
  name: 0,
  school: 1,
  gender: 2,
  course: 3,
  program: 4,
  term: 5,
  studyType: 6,
  mainSite: 7,
  subSite: 8,
  status: 9,
  chances: 10,
  grace: 11,
  phone: 12,
  parentPhone: 13,
  telegram: 14,
} as const;

export type ExtractedRow = {
  cells: string[];
  /** The student's own messages, for checking a row by eye. */
  source: string;
  sender: string;
  /** The reader's note for the reviewer (cleared once the name is edited). */
  note: string;
  /** Column index -> why it needs a look. */
  warnings: Record<number, string>;
};

export type ExtractionResult = {
  rows: ExtractedRow[];
  /** Group links found in the text that are not set up yet ("" = no link). */
  unknownLinks: string[];
  /** Students left out because their link is not set up. */
  skipped: number;
};

const firstName = (name: string) => collapseSpaces(name).split(" ")[0] ?? "";

/** Remembers a gender typed by hand for this first name. Returns the key, or "" when nothing was learned. */
export function learnGender(settings: ExtractorSettings, name: string, gender: string): string {
  const key = nameKey(firstName(name));
  if (!key || (gender !== FEMALE && gender !== MALE)) return "";
  settings.learnedGenders[key] = gender;
  return key;
}

/** Recomputes a row's review warnings; called again after a cell is edited. */
export function checkRow(row: ExtractedRow): void {
  const warnings: Record<number, string> = {};
  const cells = row.cells;
  if (cells[COL.name].split(" ").filter(Boolean).length < 3) warnings[COL.name] = "الاسم أقل من ثلاثي";
  if (!cells[COL.gender]) warnings[COL.gender] = "الجنس مو واضح";
  if (!cells[COL.mainSite]) warnings[COL.mainSite] = "المحافظة مو مذكورة";
  for (const [col, label] of [[COL.phone, "رقم الطالب"], [COL.parentPhone, "رقم ولي الأمر"]] as const) {
    const phone = cells[col];
    if (!phone) warnings[col] = `${label} فارغ`;
    else if (phone.length !== 10 || !phone.startsWith("7")) warnings[col] = `${label} طوله أو بدايته غير طبيعية`;
  }
  if (!cells[COL.telegram]) warnings[COL.telegram] = "ماكو معرف تليگرام";
  if (row.note) warnings[COL.name] = [warnings[COL.name], row.note].filter(Boolean).join(" • ");
  row.warnings = warnings;
}

function buildRow(block: StudentBlock, fields: ExtractedFields, settings: ExtractorSettings): ExtractedRow {
  const link = settings.links[block.link];
  const name = cleanName(fields.name);
  const school = cleanSchool(fields.school);
  const learned = settings.learnedGenders[nameKey(firstName(name))] ?? "";
  const gender = genderFromRules(name, school) || learned || fields.gender;
  const governorate = normalizeGovernorate(fields.governorate, GOVERNORATES, settings.governorateAliases);
  const region = governorate === BAGHDAD ? link.baghdadRegion : "";

  let phone = cleanPhone(fields.studentPhone);
  let parentPhone = cleanPhone(fields.guardianPhone);
  if (phone && !parentPhone) parentPhone = phone;
  else if (parentPhone && !phone && phonesInText(block.text).length <= 1) phone = parentPhone; // one number only -> both

  const cells = [
    name,
    school,
    gender,
    link.course,
    link.program,
    link.term,
    link.studyType.includes("حضوري") ? "مدمج" : link.studyType,
    governorate,
    region,
    settings.status,
    settings.chances,
    settings.grace,
    phone,
    parentPhone,
    cleanTelegram(fields.telegram),
  ];
  const row: ExtractedRow = { cells, source: block.text, sender: block.sender, note: collapseSpaces(fields.note), warnings: {} };
  checkRow(row);
  return row;
}

export function extractStudents(text: string, settings: ExtractorSettings): ExtractionResult {
  const blocks = splitStudents(text, settings.adminSender);
  const unknownLinks = [...new Set(blocks.map((block) => block.link).filter((link) => !settings.links[link]))];
  const known = blocks.filter((block) => settings.links[block.link]);
  const fields = extractBlocks(known, settings.governorateAliases);
  const rows: ExtractedRow[] = [];
  const seen = new Set<string>();
  for (const block of known) {
    const row = buildRow(block, fields.get(block.blockId)!, settings);
    const key = row.cells.join("\t");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return { rows, unknownLinks, skipped: blocks.length - known.length };
}

/** Rows as the text «إضافة طلاب جماعية» reads: one student per line, tab-separated. */
export function rowsToText(rows: ExtractedRow[]): string {
  return rows.map((row) => row.cells.map((cell) => cell.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}
