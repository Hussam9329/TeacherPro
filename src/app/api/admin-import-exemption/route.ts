export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeArabicText } from '@/lib/route-helpers';
import { RAW_STUDENTS_TSV } from '@/lib/exemption-roster';

const TARGET_COURSE_NAME = process.env.EXEMPTION_COURSE_NAME || 'الاعفاء';
const TARGET_COURSE_ID = process.env.EXEMPTION_COURSE_ID || '';
const TARGET_PROGRAM = 'منهج كامل';
const TARGET_STUDY_TYPE = 'إلكتروني';
const TARGET_BAGHDAD_MODE = 'عموم بغداد';

type PhoneResult = { phone: string; warning: string | null };

function toLatinDigits(value: string): string {
  return value.replace(/[٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹]/g, (ch) => {
    const map: Record<string, string> = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
      '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
      '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    };
    return map[ch] ?? ch;
  });
}

function sanitizePhoneInput(value: string): string {
  return toLatinDigits(value).replace(/\D/g, '').slice(0, 11);
}

function normalizePhone(value: string): PhoneResult {
  const phone = sanitizePhoneInput(value);
  if (!phone) return { phone: '', warning: 'الرقم فارغ' };
  if (!phone.startsWith('07')) return { phone, warning: 'لا يبدأ بـ 07' };
  if (phone.length !== 11) return { phone, warning: `طوله ${phone.length} بدل 11` };
  return { phone, warning: null };
}

function normalizeTelegram(value: string): string {
  return toLatinDigits(value).replace(/@/g, '').trim().replace(/\s+/g, '').toLowerCase();
}

function normalizeArabic(value: string): string {
  return normalizeArabicText(value);
}

function normalizeForLooseCourseMatch(value: string): string {
  return normalizeArabic(value).replace(/[\s\-_]+/g, '').replace(/ال/g, '');
}

function parseJsonArray(value: unknown): string[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((v) => String(v ?? '').trim()).map((v) => String(v).trim())));
}

interface ParsedStudent {
  sourceLine: number;
  name: string;
  school: string;
  gender: string;
  phone: string;
  parentPhone: string;
  province: string;
  telegram: string;
  locationScope: string;
  baghdadMode: string | null;
  mainSite: string;
  subSite: string;
}

function parseRoster(): { students: ParsedStudent[]; warnings: string[]; rawCount: number } {
  const lines = RAW_STUDENTS_TSV.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('ملف الطلاب فارغ');
  const [header, ...dataLines] = lines;
  if (!header?.includes('اسم الطالب')) throw new Error('ملف الطلاب المرفق غير مفهوم: رأس الجدول غير موجود.');

  const warnings: string[] = [];
  const parsed: ParsedStudent[] = [];

  dataLines.forEach((line, index) => {
    const columns = line.split('\t').map((v) => v.trim());
    if (columns.length !== 7) {
      warnings.push(`السطر ${index + 2}: عدد الأعمدة ${columns.length} بدل 7، تم تجاهله.`);
      return;
    }
    const [name, school, gender, studentPhoneRaw, parentPhoneRaw, province, telegramRaw] = columns;
    const studentPhone = normalizePhone(studentPhoneRaw);
    const parentPhone = normalizePhone(parentPhoneRaw);
    if (studentPhone.warning) warnings.push(`${name}: رقم الطالب - ${studentPhone.warning}`);
    if (parentPhone.warning) warnings.push(`${name}: رقم ولي الأمر - ${parentPhone.warning}`);

    const telegram = normalizeTelegram(telegramRaw);
    const locationScope = province === 'بغداد' ? 'بغداد' : 'محافظات';
    const subSite = province === 'بغداد' ? TARGET_BAGHDAD_MODE : province;

    parsed.push({
      sourceLine: index + 2,
      name,
      school,
      gender,
      phone: studentPhone.phone,
      parentPhone: parentPhone.phone,
      province,
      telegram,
      locationScope,
      baghdadMode: locationScope === 'بغداد' ? TARGET_BAGHDAD_MODE : null,
      mainSite: locationScope,
      subSite,
    });
  });

  // Dedup within file (last wins)
  const byIdentity = new Map<string, ParsedStudent>();
  for (const s of parsed) {
    const nameKey = normalizeArabic(s.name);
    const phoneKey = s.phone;
    const telegramKey = s.telegram;
    const identity = [nameKey, phoneKey, telegramKey].filter(Boolean).join('|');
    const previous = byIdentity.get(identity);
    if (previous) warnings.push(`${s.name}: تكرار داخل الملف، اعتمدنا السطر ${s.sourceLine} بدل ${previous.sourceLine}.`);
    byIdentity.set(identity, s);
  }

  return { students: Array.from(byIdentity.values()), warnings, rawCount: parsed.length };
}

async function resolveCourse() {
  if (TARGET_COURSE_ID.trim()) {
    const course = await db.course.findUnique({ where: { id: TARGET_COURSE_ID.trim() } });
    if (!course) throw new Error(`لم يتم العثور على دورة بالمعرّف EXEMPTION_COURSE_ID=${TARGET_COURSE_ID}`);
    return course;
  }
  const courses = await db.course.findMany();
  const exactTarget = normalizeArabic(TARGET_COURSE_NAME);
  const looseTarget = normalizeForLooseCourseMatch(TARGET_COURSE_NAME);
  const matches = courses.filter((c) => {
    return normalizeArabic(c.name) === exactTarget || normalizeForLooseCourseMatch(c.name) === looseTarget;
  });
  if (matches.length === 0) {
    const names = courses.map((c) => `- ${c.name}`).join('\n');
    throw new Error(`لم يتم العثور على دورة باسم "${TARGET_COURSE_NAME}".\nالدورات الموجودة:\n${names || 'لا توجد دورات'}`);
  }
  if (matches.length > 1) {
    throw new Error(`وجدت أكثر من دورة تطابق "${TARGET_COURSE_NAME}". استخدم EXEMPTION_COURSE_ID لتحديد الدورة بدقة.`);
  }
  return matches[0];
}

async function ensureCourseSettings(courseId: string, provinces: string[]) {
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) throw new Error('الدورة غير موجودة');

  const availablePrograms = unique([...parseJsonArray(course.availablePrograms), TARGET_PROGRAM]);
  const availableStudyTypes = unique([...parseJsonArray(course.availableStudyTypes), TARGET_STUDY_TYPE]);
  const studyTypesByProgram = parseJsonRecord(course.studyTypesByProgram) as Record<string, string[]>;
  studyTypesByProgram[TARGET_PROGRAM] = unique([...(parseJsonArray(studyTypesByProgram[TARGET_PROGRAM])), TARGET_STUDY_TYPE]);

  const locationConfig = parseJsonRecord(course.locationConfig) as Record<string, any>;
  const electronicConfig = (locationConfig[TARGET_STUDY_TYPE] && typeof locationConfig[TARGET_STUDY_TYPE] === 'object')
    ? locationConfig[TARGET_STUDY_TYPE]
    : {};
  locationConfig[TARGET_STUDY_TYPE] = {
    ...electronicConfig,
    scopes: unique([...(Array.isArray(electronicConfig.scopes) ? electronicConfig.scopes : []), 'بغداد', 'محافظات']),
    baghdadMode: electronicConfig.baghdadMode || TARGET_BAGHDAD_MODE,
    baghdadSites: unique([...(Array.isArray(electronicConfig.baghdadSites) ? electronicConfig.baghdadSites : []), TARGET_BAGHDAD_MODE]),
    provinces: unique([...(Array.isArray(electronicConfig.provinces) ? electronicConfig.provinces : []), ...provinces]),
  };

  await db.course.update({
    where: { id: courseId },
    data: {
      availablePrograms: JSON.stringify(availablePrograms),
      availableStudyTypes: JSON.stringify(availableStudyTypes),
      studyTypesByProgram: JSON.stringify(studyTypesByProgram),
      locationConfig: JSON.stringify(locationConfig),
    },
  });
}

function getStudentUniqueKeys(student: { name: string; phone: string; telegram: string }) {
  return {
    nameKey: normalizeArabic(student.name) || null,
    phoneKey: student.phone || null,
    telegramKey: student.telegram || null,
  };
}

interface ExistingStudent {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  phoneKey: string | null;
  telegram: string | null;
  telegramKey: string | null;
  nameKey: string | null;
}

function buildExistingIndexes(students: ExistingStudent[]) {
  const byName = new Map<string, ExistingStudent>();
  const byPhone = new Map<string, ExistingStudent>();
  const byTelegram = new Map<string, ExistingStudent>();
  for (const s of students) {
    const nameKey = s.nameKey || normalizeArabic(s.name);
    const phoneKey = s.phoneKey || s.phone || '';
    const telegramKey = s.telegramKey || normalizeTelegram(s.telegram || '');
    if (nameKey) byName.set(nameKey, s);
    if (phoneKey) byPhone.set(phoneKey, s);
    if (telegramKey) byTelegram.set(telegramKey, s);
  }
  return { byName, byPhone, byTelegram };
}

function findDuplicate(indexes: ReturnType<typeof buildExistingIndexes>, keys: ReturnType<typeof getStudentUniqueKeys>) {
  if (keys.nameKey && indexes.byName.has(keys.nameKey)) return { reason: 'الاسم موجود مسبقاً', student: indexes.byName.get(keys.nameKey)! };
  if (keys.phoneKey && indexes.byPhone.has(keys.phoneKey)) return { reason: 'رقم الطالب موجود مسبقاً', student: indexes.byPhone.get(keys.phoneKey)! };
  if (keys.telegramKey && indexes.byTelegram.has(keys.telegramKey)) return { reason: 'معرف التلكرام موجود مسبقاً', student: indexes.byTelegram.get(keys.telegramKey)! };
  return null;
}

async function getNextCodeNumber(): Promise<number> {
  const students = await db.student.findMany({ select: { code: true } });
  let max = 0;
  for (const s of students) {
    const m = s.code?.match(/^BIO-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}

async function resolveBaseOpportunities(courseId: string): Promise<number> {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return 0;
  // Try to read from existing students in this course — take the mode/base value
  const existing = await db.student.findFirst({
    where: { courseId, baseOpportunities: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
    select: { baseOpportunities: true },
  });
  return existing?.baseOpportunities ?? 0;
}

async function runImport() {
  const { students, warnings, rawCount } = parseRoster();
  const course = await resolveCourse();
  const nonBaghdadProvinces = unique(students.filter((s) => s.locationScope === 'محافظات').map((s) => s.province));
  await ensureCourseSettings(course.id, nonBaghdadProvinces);

  const baseOpportunities = await resolveBaseOpportunities(course.id);
  const createdAt = new Date();
  const existingStudents = await db.student.findMany({
    select: { id: true, name: true, code: true, phone: true, phoneKey: true, telegram: true, telegramKey: true, nameKey: true },
  });
  const indexes = buildExistingIndexes(existingStudents as ExistingStudent[]);
  let nextCodeNumber = await getNextCodeNumber();
  let added = 0;
  const skipped: string[] = [];

  for (const student of students) {
    if (!student.name || !student.school || !student.gender) {
      skipped.push(`${student.name || `السطر ${student.sourceLine}`}: بيانات أساسية ناقصة`);
      continue;
    }
    const keys = getStudentUniqueKeys(student);
    const duplicate = findDuplicate(indexes, keys);
    if (duplicate) {
      skipped.push(`${student.name}: تم التجاوز لأن ${duplicate.reason} (${duplicate.student.name} - ${duplicate.student.code})`);
      continue;
    }
    const code = `BIO-${String(nextCodeNumber).padStart(3, '0')}`;
    nextCodeNumber += 1;

    const created = await db.student.create({
      data: {
        name: student.name.trim(),
        nameKey: keys.nameKey,
        school: student.school.trim(),
        gender: student.gender.trim(),
        phone: student.phone,
        phoneKey: keys.phoneKey,
        parentPhone: student.parentPhone,
        telegram: student.telegram,
        telegramKey: keys.telegramKey,
        courseProgram: TARGET_PROGRAM,
        courseTerm: null,
        studyType: TARGET_STUDY_TYPE,
        locationScope: student.locationScope,
        baghdadMode: student.baghdadMode,
        mainSite: student.mainSite,
        subSite: student.subSite,
        code,
        status: 'نشط',
        opportunities: baseOpportunities,
        baseOpportunities,
        accountingGraceDays: 0,
        createdAt,
        courseId: course.id,
      },
      select: { id: true, name: true, code: true, phone: true, phoneKey: true, telegram: true, telegramKey: true, nameKey: true },
    });

    added += 1;
    if (created.nameKey) indexes.byName.set(created.nameKey, created as ExistingStudent);
    if (created.phoneKey) indexes.byPhone.set(created.phoneKey, created as ExistingStudent);
    if (created.telegramKey) indexes.byTelegram.set(created.telegramKey, created as ExistingStudent);
  }

  return {
    course: { id: course.id, name: course.name },
    rawCount,
    afterDedup: students.length,
    added,
    skipped: skipped.length,
    skippedDetails: skipped,
    warnings,
    baseOpportunities,
  };
}

async function normalizePhonesForCourse() {
  // Find exemption course
  const courses = await db.course.findMany();
  const course = courses.find((c) => normalizeArabic(c.name) === normalizeArabic(TARGET_COURSE_NAME));
  if (!course) throw new Error(`لم يتم العثور على دورة "${TARGET_COURSE_NAME}"`);

  // Find all students with malformed phones (10 digits starting with 7, missing leading 0)
  const students = await db.student.findMany({
    where: { courseId: course.id },
    select: { id: true, name: true, code: true, phone: true, phoneKey: true, parentPhone: true },
  });

  let fixed = 0;
  const fixedDetails: string[] = [];
  for (const s of students) {
    const updates: { phone?: string; phoneKey?: string | null; parentPhone?: string } = {};
    if (s.phone && s.phone.length === 10 && s.phone.startsWith('7')) {
      updates.phone = '0' + s.phone;
      updates.phoneKey = updates.phone;
    }
    if (s.parentPhone && s.parentPhone.length === 10 && s.parentPhone.startsWith('7')) {
      updates.parentPhone = '0' + s.parentPhone;
    }
    if (Object.keys(updates).length > 0) {
      await db.student.update({ where: { id: s.id }, data: updates });
      fixed += 1;
      fixedDetails.push(`${s.code} ${s.name}: phone ${s.phone}→${updates.phone ?? s.phone} parent ${s.parentPhone}→${updates.parentPhone ?? s.parentPhone}`);
    }
  }

  return { courseId: course.id, courseName: course.name, totalStudents: students.length, fixed, fixedDetails };
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('x-admin-token');
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  const mode = url.searchParams.get('mode');
  const expectedToken = process.env.ADMIN_IMPORT_TOKEN;

  if (!expectedToken) {
    return NextResponse.json({ error: 'ADMIN_IMPORT_TOKEN غير مضبوط على الخادم' }, { status: 500 });
  }
  if (authHeader !== expectedToken && queryToken !== expectedToken) {
    return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 });
  }

  try {
    if (mode === 'normalize-phones') {
      const result = await normalizePhonesForCourse();
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await runImport();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[admin-import-exemption] failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'استخدم POST مع x-admin-token' }, { status: 405 });
}
