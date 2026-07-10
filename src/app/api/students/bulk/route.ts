export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import {
  getPhoneValidationError,
  sanitizePhoneInput,
  toLatinDigits,
} from "@/lib/format";
import {
  getStudentDuplicateMessage,
  getStudentUniqueKeys,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import { getRequiredTextError } from "@/lib/validation";
import {
  resolveSubSite,
  validateStudentCourseChoices,
} from "@/lib/course-config";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";

type BulkStudentPayload = {
  name?: unknown;
  school?: unknown;
  gender?: unknown;
  phone?: unknown;
  parentPhone?: unknown;
  telegram?: unknown;
  courseProgram?: unknown;
  courseTerm?: unknown;
  studyType?: unknown;
  locationScope?: unknown;
  baghdadMode?: unknown;
  courseId?: unknown;
  mainSite?: unknown;
  subSite?: unknown;
  status?: unknown;
  createdAt?: unknown;
  opportunities?: unknown;
  baseOpportunities?: unknown;
  accountingGraceDays?: unknown;
};

type BulkCourse = {
  id: string;
  active?: boolean;
  availablePrograms?: unknown;
  availableStudyTypes?: unknown;
  studyTypesByProgram?: unknown;
  locationConfig?: unknown;
  [key: string]: unknown;
};

type BulkActiveCourseChapter = {
  id: string;
  courseId: string;
  chapter: { id: string; name: string | null; opportunities: number | null };
};

function normalizeGraceDays(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(30, Math.max(0, Math.trunc(numeric)));
}

function validateGraceDays(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 30) {
    return "فترة السماح يجب أن تكون رقماً من 0 إلى 30 يوم";
  }
  return null;
}

function normalizeBulkPhone(value: unknown): string {
  const digits = toLatinDigits(String(value ?? "")).replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("7")) return `0${digits}`;
  if (digits.startsWith("9647") && digits.length >= 13)
    return `0${digits.slice(3, 13)}`;
  if (digits.startsWith("009647") && digits.length >= 15)
    return `0${digits.slice(5, 15)}`;
  return digits.slice(0, 11);
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function getPrismaStudentErrorResponse(error: unknown) {
  const prismaError = error as { code?: string; meta?: { target?: unknown } };
  if (prismaError.code === "P2002") {
    const targetValue = prismaError.meta?.target;
    const target = Array.isArray(targetValue)
      ? targetValue.join(",")
      : String(targetValue ?? "");
    if (target.includes("telegramKey")) {
      return NextResponse.json(
        { error: "معرف التيليجرام مسجل مسبقاً لطالب آخر" },
        { status: 409 },
      );
    }
    if (target.includes("phoneKey")) {
      return NextResponse.json(
        { error: "رقم الهاتف مسجل مسبقاً لطالب آخر" },
        { status: 409 },
      );
    }
    if (target.includes("nameKey")) {
      return NextResponse.json(
        { error: "اسم الطالب مسجل مسبقاً لطالب آخر" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "توجد بيانات فريدة مسجلة مسبقاً" },
      { status: 409 },
    );
  }

  console.error("[API] /api/students/bulk error:", error);
  return NextResponse.json(
    {
      error:
        "تعذر حفظ الإضافة الجماعية حالياً. تحقق من الاتصال ثم حاول مرة أخرى.",
    },
    { status: 500 },
  );
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "students.add");
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(
    req,
    API_RATE_LIMITS.bulkStudents,
  );
  if (rateLimitError) return rateLimitError;

  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body.students)
    ? (body.students as BulkStudentPayload[])
    : [];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "لا توجد سجلات طلاب للإضافة" },
      { status: 400 },
    );
  }
  if (rows.length > 1000) {
    return NextResponse.json(
      { error: "الحد الأعلى للإضافة الجماعية هو 1000 طالب في كل عملية" },
      { status: 400 },
    );
  }

  const courseIds = Array.from(
    new Set(rows.map((row) => asText(row.courseId)).filter(Boolean)),
  );
  const courses = (await db.course.findMany({
    where: { id: { in: courseIds } },
  })) as BulkCourse[];
  const courseById = new Map(courses.map((course) => [course.id, course]));

  // حمّل روابط الفصول النشطة مرة واحدة لكل الدورات المتضمنة في الاستيراد.
  // النظام هو صاحب القرار النهائي للفرص: لا نعتمد على opportunities/baseOpportunities
  // القادمة من العميل نهائياً، بل نحسبها حصراً من الفصل النشط للدورة.
  const activeCourseChapters = (
    courseIds.length
      ? await db.courseChapter.findMany({
          where: { courseId: { in: courseIds }, active: true, archived: false },
          include: {
            chapter: { select: { id: true, name: true, opportunities: true } },
          },
          orderBy: { id: "asc" },
        })
      : []
  ) as BulkActiveCourseChapter[];
  const activeCourseChaptersByCourseId = new Map<
    string,
    typeof activeCourseChapters
  >();
  for (const link of activeCourseChapters) {
    const bucket = activeCourseChaptersByCourseId.get(link.courseId) || [];
    bucket.push(link);
    activeCourseChaptersByCourseId.set(link.courseId, bucket);
  }

  const seenNames = new Map<string, number>();
  const seenPhones = new Map<string, number>();
  const seenTelegrams = new Map<string, number>();
  const warnings: string[] = [];
  const normalizedRows = [] as Array<{
    payload: BulkStudentPayload;
    phone: string;
    parentPhone: string;
    telegram: string;
    opportunities: number;
    graceDays: number;
    resolvedSubSite: string;
    rowNo: number;
    uniqueKeys: ReturnType<typeof getStudentUniqueKeys>;
  }>;

  for (const [index, row] of rows.entries()) {
    const rowNo = index + 1;
    const name = asText(row.name);
    const school = asText(row.school);
    const gender = asText(row.gender);
    const phone = normalizeBulkPhone(row.phone);
    const parentPhone = normalizeBulkPhone(row.parentPhone);
    const telegram = sanitizeTelegramInput(asText(row.telegram));
    const courseId = asText(row.courseId);
    const course = courseById.get(courseId);
    const courseProgram = asText(row.courseProgram);
    const courseTerm = courseProgram === "كورسات" ? asText(row.courseTerm) : "";
    const studyType = asText(row.studyType);
    const locationScope = asText(row.locationScope);
    const baghdadMode = asText(row.baghdadMode);
    const subSite = asText(row.subSite);
    const status = asText(row.status) || "نشط";
    const graceDays = normalizeGraceDays(row.accountingGraceDays);
    const activeLinks = activeCourseChaptersByCourseId.get(courseId) || [];
    const activeChapter =
      activeLinks.length === 1 ? activeLinks[0].chapter : null;
    const opportunities = activeChapter
      ? Math.max(0, Math.trunc(Number(activeChapter.opportunities || 0)))
      : 0;

    const requiredChecks: Array<[boolean, string]> = [
      [Boolean(name), `السطر ${rowNo}: اسم الطالب مطلوب`],
      [Boolean(school), `السطر ${rowNo}: اسم المدرسة مطلوب`],
      [
        gender === "ذكر" || gender === "أنثى",
        `السطر ${rowNo}: الجنس يجب أن يكون ذكر أو أنثى`,
      ],
      [Boolean(courseId), `السطر ${rowNo}: الدورة مطلوبة`],
      [Boolean(course), `السطر ${rowNo}: الدورة المحددة غير موجودة`],
      [
        status === "نشط" || status === "مفصول",
        `السطر ${rowNo}: الحالة يجب أن تكون نشط أو مفصول`,
      ],
    ];
    const missing = requiredChecks.find(([ok]) => !ok);
    if (missing) {
      return NextResponse.json({ error: missing[1] }, { status: 400 });
    }

    if (course?.active === false) {
      return NextResponse.json(
        { error: `السطر ${rowNo}: هذه الدورة موقوفة عن التسجيل حالياً` },
        { status: 400 },
      );
    }

    if (activeLinks.length > 1) {
      return NextResponse.json(
        {
          error: `السطر ${rowNo}: لا يمكن التسجيل لأن هذه الدورة تحتوي أكثر من فصل نشط. أصلح الفصول والفرص أولاً.`,
        },
        { status: 409 },
      );
    }

    if (activeLinks.length === 0) {
      warnings.push(
        `السطر ${rowNo}: هذه الدورة لا تحتوي على فصل نشط، الطالب سيُسجل بدون فرص.`,
      );
    } else if (opportunities <= 0) {
      warnings.push(
        `السطر ${rowNo}: الفصل النشط "${activeChapter?.name || "—"}" فرصه 0، الطالب سيبدأ بدون فرص.`,
      );
    }

    const nameError = getRequiredTextError(
      name,
      `اسم الطالب في السطر ${rowNo}`,
    );
    if (nameError)
      return NextResponse.json({ error: nameError }, { status: 400 });

    const phoneError = getPhoneValidationError(
      phone,
      `رقم الطالب في السطر ${rowNo}`,
      true,
    );
    if (phoneError)
      return NextResponse.json({ error: phoneError }, { status: 400 });

    const parentPhoneError = getPhoneValidationError(
      parentPhone,
      `رقم ولي الأمر في السطر ${rowNo}`,
      true,
    );
    if (parentPhoneError)
      return NextResponse.json({ error: parentPhoneError }, { status: 400 });

    const graceDaysError = validateGraceDays(graceDays);
    if (graceDaysError)
      return NextResponse.json(
        { error: `السطر ${rowNo}: ${graceDaysError}` },
        { status: 400 },
      );

    if (course) {
      const choiceValidation = validateStudentCourseChoices(course, {
        courseProgram,
        courseTerm,
        studyType,
        locationScope,
        baghdadMode,
        subSite,
      });
      if (!choiceValidation.ok) {
        return NextResponse.json(
          { error: `السطر ${rowNo}: ${choiceValidation.error}` },
          { status: 400 },
        );
      }
    }

    const uniqueKeys = getStudentUniqueKeys({ name, phone, telegram });
    if (uniqueKeys.nameKey) {
      const previous = seenNames.get(uniqueKeys.nameKey);
      if (previous)
        return NextResponse.json(
          {
            error: `السطر ${rowNo}: الاسم مكرر داخل النص مع السطر ${previous}`,
          },
          { status: 400 },
        );
      seenNames.set(uniqueKeys.nameKey, rowNo);
    }
    if (uniqueKeys.phoneKey) {
      const previous = seenPhones.get(uniqueKeys.phoneKey);
      if (previous)
        return NextResponse.json(
          {
            error: `السطر ${rowNo}: رقم الطالب مكرر داخل النص مع السطر ${previous}`,
          },
          { status: 400 },
        );
      seenPhones.set(uniqueKeys.phoneKey, rowNo);
    }
    if (uniqueKeys.telegramKey) {
      const previous = seenTelegrams.get(uniqueKeys.telegramKey);
      if (previous)
        return NextResponse.json(
          {
            error: `السطر ${rowNo}: معرف التيليجرام مكرر داخل النص مع السطر ${previous}`,
          },
          { status: 400 },
        );
      seenTelegrams.set(uniqueKeys.telegramKey, rowNo);
    }

    const resolvedSubSite = course
      ? resolveSubSite(course, studyType, locationScope, baghdadMode, subSite)
      : subSite;

    normalizedRows.push({
      payload: row,
      phone,
      parentPhone,
      telegram,
      opportunities,
      graceDays,
      resolvedSubSite,
      rowNo,
      uniqueKeys,
    });
  }

  const duplicateConditions: Record<string, string>[] = [];
  for (const row of normalizedRows) {
    if (row.uniqueKeys.nameKey)
      duplicateConditions.push({ nameKey: row.uniqueKeys.nameKey });
    if (row.uniqueKeys.phoneKey)
      duplicateConditions.push({ phoneKey: row.uniqueKeys.phoneKey });
    if (row.uniqueKeys.telegramKey)
      duplicateConditions.push({ telegramKey: row.uniqueKeys.telegramKey });
  }
  const duplicateSource = duplicateConditions.length
    ? await db.student.findMany({
        where: { OR: duplicateConditions },
        select: { id: true, name: true, phone: true, telegram: true },
        take: 50,
      })
    : [];
  for (const row of normalizedRows) {
    const duplicateMessage = getStudentDuplicateMessage(duplicateSource, {
      name: asText(row.payload.name),
      phone: row.phone,
      telegram: row.telegram,
    });
    if (duplicateMessage) {
      return NextResponse.json(
        { error: `السطر ${row.rowNo}: ${duplicateMessage}` },
        { status: 409 },
      );
    }
  }

  try {
    const students = await db.$transaction(async (tx) => {
      const existingCodes = await tx.student.findMany({
        select: { code: true },
        where: { code: { startsWith: "BIO-" } },
      });
      let nextCodeNumber =
        existingCodes.reduce((max, student) => {
          const match = student.code?.match(/^BIO-(\d+)$/);
          return match ? Math.max(max, Number(match[1])) : max;
        }, 0) + 1;
      const createdStudents: unknown[] = [];
      for (const {
        payload,
        phone,
        parentPhone,
        telegram,
        opportunities,
        graceDays,
        resolvedSubSite,
        uniqueKeys,
      } of normalizedRows) {
        const code = `BIO-${String(nextCodeNumber).padStart(3, "0")}`;
        nextCodeNumber += 1;
        const createdStudent = await tx.student.create({
          data: {
            name: asText(payload.name),
            school: asText(payload.school),
            gender: asText(payload.gender),
            phone: sanitizePhoneInput(phone),
            parentPhone: sanitizePhoneInput(parentPhone),
            telegram,
            courseProgram: asText(payload.courseProgram) || null,
            courseTerm:
              asText(payload.courseProgram) === "كورسات"
                ? asText(payload.courseTerm) || null
                : null,
            studyType: asText(payload.studyType) || null,
            locationScope: asText(payload.locationScope) || null,
            baghdadMode: asText(payload.baghdadMode) || null,
            mainSite: asText(payload.mainSite || payload.locationScope),
            subSite: resolvedSubSite || asText(payload.subSite),
            code,
            status: asText(payload.status) || "نشط",
            dismissalType: "",
            dismissalReason: "",
            dismissalNotes: null,
            createdAt: payload.createdAt
              ? new Date(asText(payload.createdAt))
              : new Date(),
            opportunities,
            baseOpportunities: opportunities,
            accountingGraceDays: graceDays,
            courseId: asText(payload.courseId),
            ...uniqueKeys,
          },
        });
        createdStudents.push(createdStudent);
      }
      return createdStudents;
    });

    return NextResponse.json(
      { students, count: students.length, warnings, source: "database" },
      { status: 201 },
    );
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}
