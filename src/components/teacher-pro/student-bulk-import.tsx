"use client";

import React, { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Upload,
  UsersRound,
  XCircle,
} from "lucide-react";
import { useTeacherStore, type Course, type Student } from "@/lib/teacher-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  getPhoneValidationError,
  parseAppDateInput,
  sanitizePhoneInput,
  toLatinDigits,
} from "@/lib/format";
import {
  COURSE_PROGRAMS,
  COURSE_TERMS,
  OUT_OF_COUNTRY_LOCATION_SCOPE,
  STUDY_TYPES,
  resolveSubSite,
  validateStudentCourseChoices,
} from "@/lib/course-config";
import { IRAQI_PROVINCES } from "@/lib/iraq";
import {
  getStudentDuplicateMessage,
  sanitizeTelegramInput,
} from "@/lib/student-utils";

const REQUIRED_HEADERS = [
  "اسم الطالب",
  "المدرسة",
  "الجنس",
  "رقم هاتف الطالب",
  "رقم ولي الامر",
  "معرف التلكرام",
  "اسم الدورة",
  "نوع الدورة",
  "الكورس",
  "نوع الدراسة",
  "الموقع",
  "الموقع الفرعي",
  "تاريخ الاضافة",
  "ايام السماح",
] as const;

const HEADER_ALIASES: Record<string, keyof RawStudentRow> = {
  "اسم الطالب": "name",
  "الاسم": "name",
  "الطالب": "name",
  "المدرسة": "school",
  "اسم المدرسة": "school",
  "الجنس": "gender",
  "رقم هاتف الطالب": "phone",
  "هاتف الطالب": "phone",
  "رقم الطالب": "phone",
  "موبايل الطالب": "phone",
  "رقم ولي الامر": "parentPhone",
  "رقم ولي الأمر": "parentPhone",
  "هاتف ولي الامر": "parentPhone",
  "هاتف ولي الأمر": "parentPhone",
  "معرف التلكرام": "telegram",
  "معرف التليكرام": "telegram",
  "تلگرام": "telegram",
  "تلكرام": "telegram",
  "اسم الدورة": "courseName",
  "الدورة": "courseName",
  "معرف الدورة": "courseId",
  "course id": "courseId",
  "نوع الدورة": "courseProgram",
  "البرنامج": "courseProgram",
  "الكورس": "courseTerm",
  "نوع الدراسة": "studyType",
  "الدراسة": "studyType",
  "الموقع": "locationScope",
  "نطاق الموقع": "locationScope",
  "الموقع الفرعي": "subSite",
  "المحافظة": "subSite",
  "الدولة": "subSite",
  "تاريخ الاضافة": "createdAt",
  "تاريخ الإضافة": "createdAt",
  "تاريخ تسجيل الطالب": "createdAt",
  "ايام السماح": "accountingGraceDays",
  "أيام السماح": "accountingGraceDays",
};

type RawStudentRow = {
  name: string;
  school: string;
  gender: string;
  phone: string;
  parentPhone: string;
  telegram: string;
  courseName: string;
  courseId: string;
  courseProgram: string;
  courseTerm: string;
  studyType: string;
  locationScope: string;
  subSite: string;
  createdAt: string;
  accountingGraceDays: string;
};

type ParsedRow = {
  rowNumber: number;
  raw: RawStudentRow;
  normalized?: Omit<Student, "id" | "code">;
  courseName: string;
  errors: string[];
  warnings: string[];
};

function emptyRawRow(): RawStudentRow {
  return {
    name: "",
    school: "",
    gender: "",
    phone: "",
    parentPhone: "",
    telegram: "",
    courseName: "",
    courseId: "",
    courseProgram: "",
    courseTerm: "",
    studyType: "",
    locationScope: "",
    subSite: "",
    createdAt: "",
    accountingGraceDays: "",
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ar-IQ")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\s_\-]+/g, " ")
    .trim();
}

const NORMALIZED_HEADER_ALIASES = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([key, value]) => [normalizeHeader(key), value]),
) as Record<string, keyof RawStudentRow>;

function normalizeText(value: unknown): string {
  return toLatinDigits(String(value ?? "")).replace(/\s+/g, " ").trim();
}

const PROVINCE_BY_KEY = new Map(
  IRAQI_PROVINCES.map((province) => [normalizeHeader(province), province] as const),
);

function normalizeSiteName(value: string): string {
  const text = normalizeText(value);
  if (!text) return "";
  const key = normalizeHeader(text);
  if (key === normalizeHeader("القادسية")) return "الديوانية";
  if (key === normalizeHeader("ذي قار")) return "الناصرية";
  return PROVINCE_BY_KEY.get(key) || text;
}

function normalizeGender(value: string): "ذكر" | "أنثى" | "" {
  const normalized = normalizeHeader(value);
  if (normalized.includes("ذكر")) return "ذكر";
  if (normalized.includes("انث")) return "أنثى";
  return "";
}

function normalizeCourseProgram(value: string): "منهج كامل" | "كورسات" | "" {
  const normalized = normalizeHeader(value);
  if (normalized.includes("منهج") || normalized.includes("كامل")) return "منهج كامل";
  if (normalized.includes("كورس")) return "كورسات";
  return COURSE_PROGRAMS.includes(value as any) ? (value as "منهج كامل" | "كورسات") : "";
}

function normalizeCourseTerm(value: string): "الكورس الأول" | "الكورس الثاني" | "" {
  const normalized = normalizeHeader(value);
  if (!normalized) return "";
  if (normalized.includes("اول") || normalized.includes("الاول") || normalized === "1") return "الكورس الأول";
  if (normalized.includes("ثاني") || normalized.includes("الثاني") || normalized === "2") return "الكورس الثاني";
  return COURSE_TERMS.includes(value as any) ? (value as "الكورس الأول" | "الكورس الثاني") : "";
}

function normalizeStudyType(value: string): "إلكتروني" | "حضوري" | "مدمج" | "" {
  const normalized = normalizeHeader(value);
  if (normalized.includes("الكتروني") || normalized.includes("اونلاين") || normalized.includes("online")) return "إلكتروني";
  if (normalized.includes("حضوري")) return "حضوري";
  if (normalized.includes("مدمج")) return "مدمج";
  return STUDY_TYPES.includes(value as any) ? (value as "إلكتروني" | "حضوري" | "مدمج") : "";
}

function normalizeLocationScope(value: string): "بغداد" | "محافظات" | "خارج القطر" | "" {
  const normalized = normalizeHeader(value);
  if (normalized.includes("بغداد")) return "بغداد";
  if (normalized.includes("خارج") || normalized.includes("دوله") || normalized.includes("دولة")) return OUT_OF_COUNTRY_LOCATION_SCOPE;
  if (normalized.includes("محافظ") || normalized.includes("ناصري") || normalized.includes("ديواني") || normalized.includes("اربيل")) return "محافظات";
  return "";
}

function normalizeGraceDays(value: string): number {
  const digits = toLatinDigits(value).replace(/\D/g, "");
  if (!digits) return 0;
  return Math.min(30, Math.max(0, Number(digits)));
}

function normalizeDate(value: string): string {
  const text = normalizeText(value);
  if (!text) return todayISO();

  // Excel serial date support
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 30000 && serial < 80000) {
      const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
    }
  }

  return parseAppDateInput(text, text.match(/^\d{4}-\d{1,2}-\d{1,2}$/) ? text : todayISO());
}

function normalizePhoneForImport(value: string): string {
  let text = toLatinDigits(String(value ?? "")).trim();
  if (/^\d+(?:\.\d+)?e\+?\d+$/i.test(text.replace(/\s/g, ""))) {
    const numeric = Number(text.replace(/\s/g, ""));
    if (Number.isFinite(numeric)) text = String(Math.trunc(numeric));
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("7")) return `0${digits}`;
  if (digits.length === 12 && digits.startsWith("9647")) return `0${digits.slice(3)}`;
  if (digits.length === 13 && digits.startsWith("9647")) return `0${digits.slice(3)}`;
  return sanitizePhoneInput(digits);
}

function findCourse(courses: Course[], raw: RawStudentRow): Course | null {
  const id = normalizeText(raw.courseId);
  if (id) {
    const byId = courses.find((course) => course.id === id);
    if (byId) return byId;
  }
  const nameKey = normalizeHeader(raw.courseName);
  if (!nameKey) return null;
  return courses.find((course) => normalizeHeader(course.name) === nameKey) || null;
}

function mapRowsToRaw(rows: string[][]): RawStudentRow[] {
  const [headerRow, ...dataRows] = rows.filter((row) => row.some((cell) => normalizeText(cell)));
  if (!headerRow) return [];

  const columnMap = headerRow.map((header) => NORMALIZED_HEADER_ALIASES[normalizeHeader(header)] || null);
  return dataRows.map((row) => {
    const raw = emptyRawRow();
    row.forEach((value, index) => {
      const key = columnMap[index];
      if (key) raw[key] = normalizeText(value);
    });
    return raw;
  }).filter((row) => Object.values(row).some(Boolean));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;
  const sampleLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const delimiter = sampleLine.includes("\t")
    ? "\t"
    : sampleLine.split(";").length > sampleLine.split(",").length
      ? ";"
      : ",";

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      if (row.some((cell) => normalizeText(cell))) rows.push(row);
      row = [];
      current = "";
      continue;
    }
    current += char;
  }
  row.push(current);
  if (row.some((cell) => normalizeText(cell))) rows.push(row);
  return rows;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const SupportedDecompressionStream = (globalThis as typeof globalThis & {
    DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
  }).DecompressionStream;
  if (!SupportedDecompressionStream) {
    throw new Error("المتصفح الحالي لا يدعم قراءة ملفات Excel. احفظ الملف بصيغة CSV ثم أعد رفعه.");
  }
  const sliced = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const stream = new Blob([sliced]).stream().pipeThrough(new SupportedDecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readUInt16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUInt32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function readZipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 70000); offset -= 1) {
    if (readUInt32(view, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("تعذر قراءة ملف Excel: بنية الملف غير صالحة.");

  const entryCount = readUInt16(view, eocdOffset + 10);
  const centralDirOffset = readUInt32(view, eocdOffset + 16);
  const entries = new Map<string, Uint8Array>();
  let offset = centralDirOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(view, offset) !== 0x02014b50) break;
    const method = readUInt16(view, offset + 10);
    const compressedSize = readUInt32(view, offset + 20);
    const fileNameLength = readUInt16(view, offset + 28);
    const extraLength = readUInt16(view, offset + 30);
    const commentLength = readUInt16(view, offset + 32);
    const localHeaderOffset = readUInt32(view, offset + 42);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    const localNameLength = readUInt16(view, localHeaderOffset + 26);
    const localExtraLength = readUInt16(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);

    if (method === 0) entries.set(name, compressed);
    else if (method === 8) entries.set(name, await inflateRaw(compressed));

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function xmlText(entries: Map<string, Uint8Array>, path: string): string {
  const entry = entries.get(path);
  if (!entry) return "";
  return new TextDecoder("utf-8").decode(entry);
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const entries = await readZipEntries(buffer);
  const parser = new DOMParser();
  const sharedStringsXml = xmlText(entries, "xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml
    ? Array.from(parser.parseFromString(sharedStringsXml, "application/xml").getElementsByTagName("si"))
        .map((item) => Array.from(item.getElementsByTagName("t")).map((text) => text.textContent || "").join(""))
    : [];

  const workbookXml = parser.parseFromString(xmlText(entries, "xl/workbook.xml"), "application/xml");
  const firstSheet = workbookXml.getElementsByTagName("sheet")[0];
  const relationId = firstSheet?.getAttribute("r:id") || firstSheet?.getAttribute("id") || "";
  const relsXml = parser.parseFromString(xmlText(entries, "xl/_rels/workbook.xml.rels"), "application/xml");
  const relation = Array.from(relsXml.getElementsByTagName("Relationship"))
    .find((item) => item.getAttribute("Id") === relationId);
  const target = relation?.getAttribute("Target") || "worksheets/sheet1.xml";
  const worksheetPath = target.startsWith("xl/") ? target : `xl/${target.replace(/^\//, "")}`;
  const worksheetXml = xmlText(entries, worksheetPath);
  if (!worksheetXml) throw new Error("تعذر العثور على ورقة العمل الأولى داخل ملف Excel.");

  const worksheet = parser.parseFromString(worksheetXml, "application/xml");
  return Array.from(worksheet.getElementsByTagName("row")).map((rowElement) => {
    const values: string[] = [];
    Array.from(rowElement.getElementsByTagName("c")).forEach((cell) => {
      const ref = cell.getAttribute("r") || "";
      const index = ref ? columnIndex(ref) : values.length;
      const type = cell.getAttribute("t") || "";
      let value = "";
      if (type === "inlineStr") {
        value = Array.from(cell.getElementsByTagName("t")).map((item) => item.textContent || "").join("");
      } else {
        const raw = cell.getElementsByTagName("v")[0]?.textContent || "";
        value = type === "s" ? (sharedStrings[Number(raw)] || "") : raw;
      }
      values[index] = value;
    });
    return values.map((value) => value || "");
  });
}

function downloadTemplate() {
  const sampleRows = [
    REQUIRED_HEADERS,
    [
      "محمد احمد علي",
      "ثانوية المثال",
      "ذكر",
      "07700000000",
      "07711111111",
      "student_user",
      "الاعفاء",
      "منهج كامل",
      "",
      "إلكتروني",
      "محافظات",
      "الناصرية",
      todayISO(),
      "0",
    ],
    [
      "زهراء علي حسين",
      "ثانوية المثال للبنات",
      "أنثى",
      "07722222222",
      "07733333333",
      "zahraa_user",
      "الاعفاء",
      "منهج كامل",
      "",
      "إلكتروني",
      "خارج القطر",
      "تركيا",
      todayISO(),
      "0",
    ],
  ];
  const csv = `\uFEFF${sampleRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "teacherpro-bulk-students-template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildRawRows(rows: string[][]): RawStudentRow[] {
  const rawRows = mapRowsToRaw(rows);
  if (rawRows.length === 0) return [];
  return rawRows;
}

function validateRows(rawRows: RawStudentRow[], courses: Course[], existingStudents: Student[]): ParsedRow[] {
  const seenStudents: Student[] = [];

  return rawRows.map((raw, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const course = findCourse(courses, raw);
    const gender = normalizeGender(raw.gender);
    const courseProgram = normalizeCourseProgram(raw.courseProgram);
    const courseTerm = normalizeCourseTerm(raw.courseTerm);
    const studyType = normalizeStudyType(raw.studyType);
    const rawLocationText = normalizeSiteName(raw.locationScope);
    let locationScope = normalizeLocationScope(raw.locationScope);
    const phone = normalizePhoneForImport(raw.phone);
    const parentPhone = normalizePhoneForImport(raw.parentPhone);
    const telegram = sanitizeTelegramInput(raw.telegram);
    const createdAt = normalizeDate(raw.createdAt);
    const accountingGraceDays = normalizeGraceDays(raw.accountingGraceDays);
    const name = normalizeText(raw.name);
    const school = normalizeText(raw.school);
    let subSite = normalizeSiteName(raw.subSite);
    if (!locationScope && rawLocationText && !subSite) {
      locationScope = "محافظات";
      subSite = rawLocationText;
      warnings.push("تم اعتبار قيمة الموقع كمحافظة لأن حقل الموقع الفرعي فارغ");
    }
    if (!locationScope && subSite) locationScope = "محافظات";

    if (!name) errors.push("اسم الطالب مطلوب");
    if (!school) errors.push("اسم المدرسة مطلوب");
    if (!gender) errors.push("الجنس يجب أن يكون ذكر أو أنثى");
    const phoneError = getPhoneValidationError(phone, "رقم الطالب", true);
    if (phoneError) errors.push(phoneError);
    const parentPhoneError = getPhoneValidationError(parentPhone, "رقم ولي الأمر", true);
    if (parentPhoneError) errors.push(parentPhoneError);
    if (!course) errors.push("تعذر العثور على الدورة من اسم الدورة أو معرفها");
    if (!courseProgram) errors.push("نوع الدورة يجب أن يكون منهج كامل أو كورسات");
    if (courseProgram === "كورسات" && !courseTerm) errors.push("الكورس مطلوب عند اختيار كورسات");
    if (!studyType) errors.push("نوع الدراسة يجب أن يكون إلكتروني أو حضوري أو مدمج");
    if (!locationScope) errors.push("الموقع يجب أن يكون بغداد أو محافظات أو خارج القطر");
    if (!subSite && locationScope !== "بغداد") errors.push(locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE ? "الدولة مطلوبة لخارج القطر" : "المحافظة مطلوبة");

    if (course) {
      const choices = {
        courseProgram,
        courseTerm: courseProgram === "كورسات" ? courseTerm : "",
        studyType,
        locationScope,
        baghdadMode: locationScope === "بغداد" ? raw.locationScope : "",
        subSite,
      };
      const validation = validateStudentCourseChoices(course, choices);
      if (!validation.ok) errors.push(validation.error);
    }

    const candidate = { name, phone, telegram };
    const existingDuplicate = getStudentDuplicateMessage(existingStudents, candidate);
    if (existingDuplicate) errors.push(existingDuplicate.replace("لا يمكن إضافة الطالب: ", ""));
    const fileDuplicate = getStudentDuplicateMessage(seenStudents, candidate);
    if (fileDuplicate) errors.push(`مكرر داخل الملف: ${fileDuplicate.replace("لا يمكن إضافة الطالب: ", "")}`);

    if (raw.phone && phone !== normalizeText(raw.phone)) warnings.push("تم تنظيف رقم الطالب تلقائياً");
    if (raw.parentPhone && parentPhone !== normalizeText(raw.parentPhone)) warnings.push("تم تنظيف رقم ولي الأمر تلقائياً");
    if (telegram && !telegram.startsWith("@") && raw.telegram.trim().startsWith("@")) warnings.push("تم حذف @ من معرف التلكرام للحفظ الموحد");

    const normalized: Omit<Student, "id" | "code"> | undefined = course && !errors.length ? {
      name,
      school,
      gender: gender as "ذكر" | "أنثى",
      phone,
      parentPhone,
      telegram,
      courseProgram: courseProgram as "منهج كامل" | "كورسات" | "",
      courseTerm: courseProgram === "كورسات" ? (courseTerm as "الكورس الأول" | "الكورس الثاني") : "",
      studyType: studyType as "إلكتروني" | "حضوري" | "مدمج" | "",
      locationScope: locationScope as "بغداد" | "محافظات" | "خارج القطر" | "",
      baghdadMode: locationScope === "بغداد" ? "" : "",
      courseId: course.id,
      mainSite: locationScope,
      subSite: resolveSubSite(course, studyType, locationScope, "", subSite),
      status: "نشط",
      dismissalType: "",
      dismissalReason: "",
      dismissalNotes: "",
      createdAt,
      opportunities: 0,
      baseOpportunities: 0,
      accountingGraceDays,
    } : undefined;

    if (normalized) {
      seenStudents.push({ ...normalized, id: `preview-${index}`, code: "" });
    }

    return {
      rowNumber,
      raw,
      normalized,
      courseName: course?.name || raw.courseName || raw.courseId || "—",
      errors,
      warnings,
    };
  });
}

export function StudentBulkImportView() {
  const { courses, students, addStudent } = useTeacherStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const stats = useMemo(() => {
    const valid = rows.filter((row) => row.normalized && row.errors.length === 0).length;
    const invalid = rows.filter((row) => row.errors.length > 0).length;
    const warnings = rows.filter((row) => row.warnings.length > 0).length;
    return { valid, invalid, warnings, total: rows.length };
  }, [rows]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setFileName(file.name);
    try {
      const lowerName = file.name.toLowerCase();
      let matrix: string[][];
      if (lowerName.endsWith(".xlsx")) {
        matrix = await parseXlsx(await file.arrayBuffer());
      } else {
        matrix = parseCsv(await file.text());
      }
      const rawRows = buildRawRows(matrix);
      if (!rawRows.length) {
        setRows([]);
        toast.error("لم يتم العثور على سجلات طلاب داخل الملف. تأكد من وجود صف العناوين والبيانات.");
        return;
      }
      const parsed = validateRows(rawRows, courses, students);
      setRows(parsed);
      toast.success(`تمت قراءة ${parsed.length} سجل للمعاينة`);
    } catch (error) {
      setRows([]);
      toast.error(error instanceof Error ? error.message : "تعذر قراءة الملف");
    } finally {
      setLoading(false);
      if (event.target) event.target.value = "";
    }
  };

  const handleImport = async () => {
    const validRows = rows.filter((row) => row.normalized && row.errors.length === 0);
    if (!validRows.length) {
      toast.error("لا توجد سجلات صالحة للإضافة");
      return;
    }
    setImporting(true);
    let added = 0;
    let skipped = 0;
    const nextRows = [...rows];

    for (const row of validRows) {
      if (!row.normalized) continue;
      const result = addStudent(row.normalized);
      if (result.ok) {
        added += 1;
        const index = nextRows.findIndex((item) => item.rowNumber === row.rowNumber);
        if (index >= 0) nextRows[index] = { ...nextRows[index], errors: [], warnings: ["تمت الإضافة"] };
      } else {
        skipped += 1;
        const index = nextRows.findIndex((item) => item.rowNumber === row.rowNumber);
        if (index >= 0) nextRows[index] = { ...nextRows[index], errors: [result.message], normalized: undefined };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }

    setRows(nextRows);
    setImporting(false);
    if (added > 0) toast.success(`تمت إضافة ${added} طالب${skipped ? `، وتجاوز ${skipped}` : ""}`);
    else toast.error("لم تتم إضافة أي طالب");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-primary/20 bg-gradient-to-l from-primary/10 via-background to-background p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-14 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
              <UsersRound className="size-7" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">الإضافة الجماعية للطلاب</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
                ارفع ملف Excel أو CSV، راجع المعاينة والأخطاء أولاً، ثم أضف السجلات الصالحة دفعة واحدة بدون تكرار.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="rounded-2xl" onClick={downloadTemplate}>
              <Download className="ml-2 size-4" />
              تحميل العينة
            </Button>
            <Button type="button" className="rounded-2xl" onClick={() => fileInputRef.current?.click()} disabled={loading}>
              <Upload className="ml-2 size-4" />
              {loading ? "جاري القراءة..." : "اختيار ملف"}
            </Button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="rounded-3xl">
          <CardHeader className="pb-2">
            <CardDescription>إجمالي السجلات</CardDescription>
            <CardTitle className="text-3xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-3xl border-green-200/70 bg-green-50/40 dark:bg-green-950/10">
          <CardHeader className="pb-2">
            <CardDescription>صالحة للإضافة</CardDescription>
            <CardTitle className="text-3xl text-green-700 dark:text-green-400">{stats.valid}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-3xl border-red-200/70 bg-red-50/40 dark:bg-red-950/10">
          <CardHeader className="pb-2">
            <CardDescription>تحتاج تصحيح</CardDescription>
            <CardTitle className="text-3xl text-red-700 dark:text-red-400">{stats.invalid}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-3xl border-amber-200/70 bg-amber-50/40 dark:bg-amber-950/10">
          <CardHeader className="pb-2">
            <CardDescription>ملاحظات تنظيف</CardDescription>
            <CardTitle className="text-3xl text-amber-700 dark:text-amber-400">{stats.warnings}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="rounded-[2rem]">
        <CardHeader className="gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Eye className="size-5 text-primary" />
              معاينة قبل الإضافة
            </CardTitle>
            <CardDescription>
              {fileName ? `الملف الحالي: ${fileName}` : "حمّل العينة ثم ارفع ملف الطلاب لعرض المعاينة هنا."}
            </CardDescription>
          </div>
          <Button
            type="button"
            className="rounded-2xl"
            onClick={handleImport}
            disabled={importing || stats.valid === 0}
          >
            <CheckCircle2 className="ml-2 size-4" />
            {importing ? "جاري الإضافة..." : `إضافة ${stats.valid} طالب صالح`}
          </Button>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-3xl border border-dashed bg-muted/20 p-8 text-center">
              <FileSpreadsheet className="mb-4 size-12 text-muted-foreground" />
              <h3 className="text-lg font-black">لا توجد معاينة بعد</h3>
              <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
                استخدم زر تحميل العينة لمعرفة الأعمدة المطلوبة، ثم ارفع ملف CSV أو XLSX يحتوي على صف العناوين والطلاب.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border">
              <div className="max-h-[36rem] overflow-auto">
                <table className="w-full min-w-[1200px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <tr className="text-right">
                      <th className="border-b px-4 py-3 font-black">الحالة</th>
                      <th className="border-b px-4 py-3 font-black">السطر</th>
                      <th className="border-b px-4 py-3 font-black">اسم الطالب</th>
                      <th className="border-b px-4 py-3 font-black">الدورة</th>
                      <th className="border-b px-4 py-3 font-black">نوع الدورة</th>
                      <th className="border-b px-4 py-3 font-black">نوع الدراسة</th>
                      <th className="border-b px-4 py-3 font-black">الموقع</th>
                      <th className="border-b px-4 py-3 font-black">رقم الطالب</th>
                      <th className="border-b px-4 py-3 font-black">الملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const ok = row.errors.length === 0 && row.normalized;
                      return (
                        <tr key={row.rowNumber} className="align-top odd:bg-muted/20">
                          <td className="border-b px-4 py-3">
                            {ok ? (
                              <Badge className="gap-1 rounded-full bg-green-600 hover:bg-green-600">
                                <CheckCircle2 className="size-3" /> صالح
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1 rounded-full">
                                <XCircle className="size-3" /> خطأ
                              </Badge>
                            )}
                          </td>
                          <td className="border-b px-4 py-3 font-mono text-xs">{row.rowNumber}</td>
                          <td className="border-b px-4 py-3 font-bold">{row.raw.name || "—"}</td>
                          <td className="border-b px-4 py-3">{row.courseName}</td>
                          <td className="border-b px-4 py-3">{row.normalized?.courseProgram || row.raw.courseProgram || "—"}</td>
                          <td className="border-b px-4 py-3">{row.normalized?.studyType || row.raw.studyType || "—"}</td>
                          <td className="border-b px-4 py-3">
                            {row.normalized ? `${row.normalized.locationScope}${row.normalized.subSite ? ` - ${row.normalized.subSite}` : ""}` : row.raw.locationScope || "—"}
                          </td>
                          <td className="border-b px-4 py-3 font-mono text-xs">{row.normalized?.phone || row.raw.phone || "—"}</td>
                          <td className="border-b px-4 py-3">
                            <div className="space-y-1">
                              {row.errors.map((error, index) => (
                                <div key={`error-${index}`} className="flex items-start gap-2 text-xs font-semibold text-red-600 dark:text-red-400">
                                  <XCircle className="mt-0.5 size-3 shrink-0" />
                                  <span>{error}</span>
                                </div>
                              ))}
                              {row.warnings.map((warning, index) => (
                                <div key={`warning-${index}`} className="flex items-start gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                                  <span>{warning}</span>
                                </div>
                              ))}
                              {!row.errors.length && !row.warnings.length ? <span className="text-xs text-muted-foreground">جاهز للإضافة</span> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[2rem] border-primary/15 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base">الأعمدة المطلوبة في الملف</CardTitle>
          <CardDescription>يمكن استخدام نفس أسماء الأعمدة في العينة، ويجب أن يكون أول صف هو صف العناوين.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {REQUIRED_HEADERS.map((header) => (
              <Label key={header} className="rounded-2xl border bg-background/70 px-3 py-2 text-xs font-bold">
                {header}
              </Label>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
