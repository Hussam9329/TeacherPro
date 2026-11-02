/**
 * «استخراج من رسائل التليگرام»: turns registration messages copied from
 * Telegram into rows of «إضافة طلاب جماعية»: the desktop app's 15 tab-separated
 * columns («السماح» included; the bulk add reads it and leaves it out).
 *
 * 1. The text is split into one block per student (parser).
 * 2. Each block's fields are read from labels and line order (rules).
 * 3. The group link decides the course; fixed rules clean the rest, and
 *    duplicates inside the batch are dropped. The bulk add's own check then
 *    shows every row with its errors.
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
import { splitStudents, type StudentBlock } from "./parser";
import { extractBlocks, type ExtractedFields } from "./rules";

export { looksLikeRegistrationText } from "./parser";
export { DEFAULT_EXTRACTOR_SETTINGS, GOVERNORATES, readExtractorLinks, type ExtractorLink, type ExtractorSettings } from "./config";

const BAGHDAD = "بغداد";

export type ExtractedRow = {
  cells: string[];
  /** The reader's note for the reviewer (e.g. extra phone numbers in the message). */
  note: string;
};

export type ExtractionResult = {
  rows: ExtractedRow[];
  /** Group links found in the text that are not set up yet ("" = no link). */
  unknownLinks: string[];
  /** Students left out because their link is not set up. */
  skipped: number;
};

function buildRow(block: StudentBlock, fields: ExtractedFields, settings: ExtractorSettings): ExtractedRow {
  const link = settings.links[block.link];
  const name = cleanName(fields.name);
  const school = cleanSchool(fields.school);
  const gender = genderFromRules(name, school) || fields.gender;
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
  return { cells, note: collapseSpaces(fields.note) };
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
