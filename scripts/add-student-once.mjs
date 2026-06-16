#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, unlinkSync, writeFileSync, rmdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const packageJsonPath = resolve(projectRoot, 'package.json');

const ARABIC_MARKS = /[\u064B-\u065F\u0670]/g;
const HAMZA_MAP = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ؤ: 'و',
  ئ: 'ي',
  ة: 'ه',
  ى: 'ي',
};

function toLatinDigits(value) {
  const digits = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, (digit) => {
    const index = digits.indexOf(digit);
    return String(index % 10);
  });
}

function normalizeText(value) {
  return toLatinDigits(value)
    .toLocaleLowerCase('ar-IQ')
    .normalize('NFKD')
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱؤئىة]/g, (char) => HAMZA_MAP[char] ?? char)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(value) {
  return toLatinDigits(value).replace(/[^0-9+]/g, '').trim();
}

function normalizeTelegram(value) {
  return toLatinDigits(value).replace(/@/g, '').replace(/\s+/g, '').trim().toLowerCase();
}

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function required(name, label) {
  const value = env(name);
  if (!value) throw new Error(`المتغير ${name} مطلوب (${label}).`);
  return value;
}

function optionalNumber(name, fallback = 0) {
  const raw = env(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

function cleanupSelf() {
  try {
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (pkg.scripts && pkg.scripts['student:add-once']) {
        delete pkg.scripts['student:add-once'];
        writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
      }
    }
  } catch (error) {
    console.warn('تمت الإضافة، لكن تعذر حذف أمر npm من package.json:', error.message);
  }

  try {
    if (existsSync(scriptPath)) unlinkSync(scriptPath);
  } catch (error) {
    console.warn('تمت الإضافة، لكن تعذر حذف ملف السكريبت:', error.message);
  }

  try {
    rmdirSync(dirname(scriptPath));
  } catch {
    // لا نحذف مجلد scripts إذا يحتوي ملفات أخرى.
  }
}

async function resolveCourse() {
  const courseId = env('ONE_TIME_STUDENT_COURSE_ID');
  if (courseId) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new Error(`لم يتم العثور على دورة بالمعرّف: ${courseId}`);
    return course;
  }

  const courseName = required('ONE_TIME_STUDENT_COURSE_NAME', 'اسم الدورة');
  const courses = await prisma.course.findMany();
  const normalizedCourseName = normalizeText(courseName);
  const matches = courses.filter((course) => normalizeText(course.name) === normalizedCourseName);
  if (matches.length === 0) throw new Error(`لم يتم العثور على دورة باسم: ${courseName}`);
  if (matches.length > 1) throw new Error(`يوجد أكثر من دورة بنفس الاسم: ${courseName}. استخدم ONE_TIME_STUDENT_COURSE_ID بدل الاسم.`);
  return matches[0];
}

async function nextStudentCode() {
  const students = await prisma.student.findMany({ select: { code: true } });
  const maxCodeNumber = students.reduce((max, student) => {
    const match = String(student.code ?? '').match(/^BIO-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `BIO-${String(maxCodeNumber + 1).padStart(3, '0')}`;
}

async function resolveBaseOpportunities(courseId) {
  const activeLink = await prisma.courseChapter.findFirst({
    where: { courseId, active: true, archived: false },
    include: { chapter: true },
  });
  return Number(activeLink?.chapter?.opportunities ?? 0);
}

async function main() {
  const name = required('ONE_TIME_STUDENT_NAME', 'اسم الطالب');
  const school = required('ONE_TIME_STUDENT_SCHOOL', 'المدرسة');
  const gender = required('ONE_TIME_STUDENT_GENDER', 'الجنس');
  const phone = normalizePhone(required('ONE_TIME_STUDENT_PHONE', 'رقم الطالب'));
  const parentPhone = normalizePhone(required('ONE_TIME_STUDENT_PARENT_PHONE', 'رقم ولي الأمر'));
  const telegram = normalizeTelegram(env('ONE_TIME_STUDENT_TELEGRAM'));
  const createdAt = env('ONE_TIME_STUDENT_CREATED_AT') ? new Date(env('ONE_TIME_STUDENT_CREATED_AT')) : new Date();
  if (Number.isNaN(createdAt.getTime())) throw new Error('تاريخ التسجيل غير صحيح. استخدم صيغة YYYY-MM-DD.');

  const course = await resolveCourse();
  const nameKey = normalizeText(name) || null;
  const phoneKey = phone || null;
  const telegramKey = telegram || null;

  const existing = await prisma.student.findFirst({
    where: {
      OR: [
        ...(nameKey ? [{ nameKey }] : []),
        ...(phoneKey ? [{ phoneKey }] : []),
        ...(telegramKey ? [{ telegramKey }] : []),
      ],
    },
    select: { id: true, name: true, code: true },
  });

  if (existing) {
    console.log(`الطالب موجود مسبقاً، لم تتم إضافته مرة ثانية: ${existing.name} - ${existing.code}`);
    cleanupSelf();
    return;
  }

  const baseOpportunities = await resolveBaseOpportunities(course.id);
  const code = env('ONE_TIME_STUDENT_CODE') || await nextStudentCode();

  const student = await prisma.student.create({
    data: {
      name: name.trim(),
      nameKey,
      school: school.trim(),
      gender,
      phone,
      phoneKey,
      parentPhone,
      telegram,
      telegramKey,
      courseProgram: env('ONE_TIME_STUDENT_COURSE_PROGRAM') || null,
      courseTerm: env('ONE_TIME_STUDENT_COURSE_TERM') || null,
      studyType: env('ONE_TIME_STUDENT_STUDY_TYPE') || null,
      locationScope: env('ONE_TIME_STUDENT_LOCATION_SCOPE') || null,
      baghdadMode: env('ONE_TIME_STUDENT_BAGHDAD_MODE') || null,
      mainSite: env('ONE_TIME_STUDENT_MAIN_SITE') || env('ONE_TIME_STUDENT_LOCATION_SCOPE') || null,
      subSite: env('ONE_TIME_STUDENT_SUB_SITE') || null,
      code,
      status: 'نشط',
      opportunities: optionalNumber('ONE_TIME_STUDENT_OPPORTUNITIES', baseOpportunities),
      baseOpportunities: optionalNumber('ONE_TIME_STUDENT_BASE_OPPORTUNITIES', baseOpportunities),
      accountingGraceDays: Math.min(30, Math.max(0, optionalNumber('ONE_TIME_STUDENT_GRACE_DAYS', 0))),
      createdAt,
      courseId: course.id,
    },
  });

  console.log(`تمت إضافة الطالب مرة واحدة: ${student.name} - ${student.code}`);
  cleanupSelf();
}

main()
  .catch((error) => {
    console.error('فشل سكريبت إضافة الطالب مرة واحدة:');
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
