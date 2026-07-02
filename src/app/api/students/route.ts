export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getPhoneValidationError, sanitizePhoneInput } from "@/lib/format";
import {
  getStudentDuplicateMessage,
  getStudentUniqueKeys,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import { getRequiredTextError } from "@/lib/validation";
import { normalizeArabicText } from "@/lib/route-helpers";
import {
  validateStudentCourseChoices,
  resolveSubSite,
} from "@/lib/course-config";

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

const NON_WRITABLE_STUDENT_UPDATE_KEYS = new Set([
  // Primary/derived fields
  "code",
  "nameKey",
  "phoneKey",
  "telegramKey",
  // Prisma relation objects that may be present after GET /api/students include: { course: true }
  "course",
  "grades",
  "opportunityLogs",
  "studentLeaves",
  "studentCalls",
  "studentNotes",
  "correctionSheets",
  "telegramExamSubmissions",
  // Client-only / stale accounting fields from older builds
  "receiptNo",
  "codeSequence",
  "totalAmount",
  "paidAmount",
  "installments",
  "accountingStart",
  "groupId",
  // Any Prisma timestamps/unknown values that should never be updated from this route
  "updatedAt",
]);

function stripNonWritableStudentUpdateFields(data: Record<string, unknown>) {
  for (const key of NON_WRITABLE_STUDENT_UPDATE_KEYS) {
    delete data[key];
  }
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
        { error: "معرف التليكرام مسجل مسبقاً لطالب آخر" },
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

  if (prismaError.code === "P2003") {
    return NextResponse.json(
      {
        error:
          "لا يمكن حفظ الطالب لأن الدورة المحددة غير موجودة أو مرتبطة ببيانات غير صالحة",
      },
      { status: 400 },
    );
  }

  if (prismaError.code === "P2025") {
    return NextResponse.json(
      {
        error: "تعذر العثور على الطالب المطلوب. حدّث الصفحة ثم حاول مرة أخرى.",
      },
      { status: 404 },
    );
  }

  console.error("[API] /api/students error:", error);
  return NextResponse.json(
    {
      error: "تعذر حفظ بيانات الطالب حالياً. تحقق من الاتصال ثم حاول مرة أخرى.",
    },
    { status: 500 },
  );
}

function readPositiveIntegerParam(
  searchParams: URLSearchParams,
  key: string,
  fallback: number,
): number {
  const value = Number(searchParams.get(key) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

function clampPageSize(value: number): number {
  return Math.min(500, Math.max(1, value));
}

function buildLocationWhere(location: string): Prisma.StudentWhereInput | null {
  const normalized = normalizeArabicText(location);
  if (!normalized) return null;

  if (normalized === normalizeArabicText("بغداد")) {
    return { locationScope: "بغداد" };
  }

  if (normalized === normalizeArabicText("خارج القطر")) {
    return { locationScope: "خارج القطر" };
  }

  return {
    OR: [
      { subSite: { equals: location, mode: "insensitive" } },
      { mainSite: { equals: location, mode: "insensitive" } },
      { subSite: { contains: location, mode: "insensitive" } },
      { mainSite: { contains: location, mode: "insensitive" } },
    ],
  };
}

function looksLikeTelegramIdentifierQuery(rawQuery: string): boolean {
  const latinQuery = rawQuery.trim();
  const telegramQuery = sanitizeTelegramInput(latinQuery).replace(/\s+/g, "");
  if (telegramQuery.length < 3) return false;

  // A Telegram identifier is normally latin letters/digits/underscore, often pasted with @.
  // When this is true we should not use broad contains search across names/phones,
  // otherwise the exact student appears first and unrelated partial matches appear after it.
  return (
    /^@?[A-Za-z0-9_]+$/.test(latinQuery) &&
    (latinQuery.startsWith("@") || /[A-Za-z_]/.test(latinQuery))
  );
}

function buildExactIdentifierSearchWhere(rawQuery: string): Prisma.StudentWhereInput {
  const telegramQuery = sanitizeTelegramInput(rawQuery).replace(/\s+/g, "").toLowerCase();
  const codeQuery = rawQuery.trim();
  const or: Prisma.StudentWhereInput[] = [
    { telegramKey: { equals: telegramQuery, mode: "insensitive" } },
    { telegram: { equals: sanitizeTelegramInput(rawQuery), mode: "insensitive" } },
  ];

  if (!rawQuery.trim().startsWith("@")) {
    or.push({ code: { equals: codeQuery, mode: "insensitive" } });
  }

  return { OR: or };
}

function buildPrefixIdentifierSearchWhere(rawQuery: string): Prisma.StudentWhereInput {
  const telegramQuery = sanitizeTelegramInput(rawQuery).replace(/\s+/g, "").toLowerCase();
  const codeQuery = rawQuery.trim();
  const or: Prisma.StudentWhereInput[] = [
    { telegramKey: { startsWith: telegramQuery, mode: "insensitive" } },
    { telegram: { startsWith: sanitizeTelegramInput(rawQuery), mode: "insensitive" } },
  ];

  if (!rawQuery.trim().startsWith("@")) {
    or.push({ code: { startsWith: codeQuery, mode: "insensitive" } });
  }

  return { OR: or };
}

function buildRegularStudentSearchWhere(rawQuery: string): Prisma.StudentWhereInput {
  const normalizedQuery = normalizeArabicText(rawQuery);
  const numericQuery = sanitizePhoneInput(rawQuery);
  const telegramQuery = sanitizeTelegramInput(rawQuery).replace(/\s+/g, "").toLowerCase();

  const or: Prisma.StudentWhereInput[] = [
    { name: { contains: rawQuery, mode: "insensitive" } },
    { nameKey: { contains: normalizedQuery, mode: "insensitive" } },
    { code: { startsWith: rawQuery, mode: "insensitive" } },
  ];

  if (telegramQuery) {
    or.push(
      { telegramKey: { startsWith: telegramQuery, mode: "insensitive" } },
      { telegram: { startsWith: sanitizeTelegramInput(rawQuery), mode: "insensitive" } },
    );
  }

  if (numericQuery) {
    or.push(
      { phone: { startsWith: numericQuery, mode: "insensitive" } },
      { phoneKey: { startsWith: numericQuery, mode: "insensitive" } },
      { parentPhone: { startsWith: numericQuery, mode: "insensitive" } },
    );

    // For long phone searches, allow searching inside the number because users may paste
    // a trailing part of the phone. Short numeric fragments stay strict to avoid noise.
    if (numericQuery.length >= 7) {
      or.push(
        { phone: { contains: numericQuery, mode: "insensitive" } },
        { phoneKey: { contains: numericQuery, mode: "insensitive" } },
        { parentPhone: { contains: numericQuery, mode: "insensitive" } },
      );
    }
  }

  return { OR: or };
}

function buildStudentFilterWhere(
  searchParams: URLSearchParams,
): Prisma.StudentWhereInput[] {
  const and: Prisma.StudentWhereInput[] = [];

  const status = String(searchParams.get("status") ?? "").trim();
  if (status) and.push({ status });

  const courseId = String(searchParams.get("courseId") ?? "").trim();
  if (courseId) and.push({ courseId });

  const courseIds = String(searchParams.get("courseIds") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (courseIds.length > 0) and.push({ courseId: { in: courseIds } });

  const courseProgram = String(searchParams.get("courseProgram") ?? "").trim();
  if (courseProgram) and.push({ courseProgram });

  const courseTerm = String(searchParams.get("courseTerm") ?? "").trim();
  if (courseProgram === "كورسات" && courseTerm) and.push({ courseTerm });

  const studyType = String(searchParams.get("studyType") ?? "").trim();
  if (studyType) and.push({ studyType });

  const location = String(searchParams.get("location") ?? "").trim();
  const locationWhere = location ? buildLocationWhere(location) : null;
  if (locationWhere) and.push(locationWhere);

  return and;
}

function composeStudentWhere(
  filters: Prisma.StudentWhereInput[],
  searchWhere?: Prisma.StudentWhereInput | null,
): Prisma.StudentWhereInput {
  const and = [...filters];
  if (searchWhere) and.unshift(searchWhere);
  return and.length > 0 ? { AND: and } : {};
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  const searchParams = new URL(req.url).searchParams;
  // Always paginate list reads. The dedicated /api/backup route is the only
  // endpoint allowed to export the full student table. This prevents accidental
  // first-load downloads of thousands of students.
  const page = readPositiveIntegerParam(searchParams, "page", 1);
  const pageSize = clampPageSize(
    readPositiveIntegerParam(searchParams, "pageSize", 50),
  );
  const rawQuery = String(searchParams.get("q") ?? "").trim();
  const filters = buildStudentFilterWhere(searchParams);
  let searchWhere: Prisma.StudentWhereInput | null = null;

  if (rawQuery) {
    if (looksLikeTelegramIdentifierQuery(rawQuery)) {
      const exactSearchWhere = buildExactIdentifierSearchWhere(rawQuery);
      const exactWhere = composeStudentWhere(filters, exactSearchWhere);
      const exactCount = await db.student.count({ where: exactWhere });

      // If the complete identifier/code exists, return only it. This prevents
      // showing the correct result followed by unrelated prefix/partial matches.
      searchWhere = exactCount > 0
        ? exactSearchWhere
        : buildPrefixIdentifierSearchWhere(rawQuery);
    } else {
      searchWhere = buildRegularStudentSearchWhere(rawQuery);
    }
  }

  const where = composeStudentWhere(filters, searchWhere);

  const [totalCount, students] = await db.$transaction([
    db.student.count({ where }),
    db.student.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return NextResponse.json({
    students,
    totalCount,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  });
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "students.add");
  if (authError) return authError;

  const body = await req.json();

  const phoneError = getPhoneValidationError(
    String(body.phone ?? ""),
    "رقم الطالب",
    true,
  );
  if (phoneError)
    return NextResponse.json({ error: phoneError }, { status: 400 });

  const parentPhoneError = getPhoneValidationError(
    String(body.parentPhone ?? ""),
    "رقم ولي الأمر",
    true,
  );
  if (parentPhoneError)
    return NextResponse.json({ error: parentPhoneError }, { status: 400 });

  const requiredFields = [
    ["name", "اسم الطالب مطلوب"],
    ["school", "اسم المدرسة مطلوب"],
    ["gender", "الجنس مطلوب"],
    ["courseId", "الدورة مطلوبة"],
    ["createdAt", "تاريخ إضافة الطالب مطلوب"],
  ] as const;
  const missingField = requiredFields.find(
    ([key]) => !String(body[key] ?? "").trim(),
  );
  if (missingField)
    return NextResponse.json({ error: missingField[1] }, { status: 400 });

  const nameError = getRequiredTextError(String(body.name ?? ""), "اسم الطالب");
  if (nameError)
    return NextResponse.json({ error: nameError }, { status: 400 });

  const graceDaysError = validateGraceDays(body.accountingGraceDays);
  if (graceDaysError)
    return NextResponse.json({ error: graceDaysError }, { status: 400 });

  // Use targeted queries on indexed columns instead of loading all students
  const { nameKey, phoneKey, telegramKey } = getStudentUniqueKeys({
    name: body.name,
    phone: body.phone,
    telegram: body.telegram,
  });
  const duplicateConditions: Record<string, string>[] = [];
  if (nameKey) duplicateConditions.push({ nameKey });
  if (phoneKey) duplicateConditions.push({ phoneKey });
  if (telegramKey) duplicateConditions.push({ telegramKey });
  const duplicateSource = duplicateConditions.length
    ? await db.student.findMany({
        where: { OR: duplicateConditions },
        select: { id: true, name: true, phone: true, telegram: true },
        take: 10,
      })
    : [];
  const duplicateMessage = getStudentDuplicateMessage(duplicateSource, {
    name: body.name,
    phone: body.phone,
    telegram: body.telegram,
  });
  if (duplicateMessage)
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });

  const uniqueKeys = getStudentUniqueKeys({
    name: body.name,
    phone: body.phone,
    telegram: body.telegram,
  });

  // Validate student course choices against course settings
  const course = await db.course.findUnique({
    where: { id: String(body.courseId ?? "") },
  });
  if (!course) {
    return NextResponse.json(
      { error: "الدورة المحددة غير موجودة" },
      { status: 400 },
    );
  }

  const courseChoices = {
    courseProgram: body.courseProgram,
    courseTerm: body.courseProgram === "كورسات" ? body.courseTerm : null,
    studyType: body.studyType,
    locationScope: body.locationScope,
    baghdadMode: body.baghdadMode,
    subSite: body.subSite,
  };

  const choiceValidation = validateStudentCourseChoices(course, courseChoices);
  if (!choiceValidation.ok) {
    return NextResponse.json(
      { error: choiceValidation.error },
      { status: 400 },
    );
  }

  // Auto-resolve subSite based on course settings
  const resolvedSubSite = resolveSubSite(
    course,
    String(body.studyType ?? ""),
    String(body.locationScope ?? ""),
    String(body.baghdadMode ?? ""),
    String(body.subSite ?? ""),
  );

  try {
    const student = await db.student.create({
      data: {
        name: String(body.name ?? "").trim(),
        school: String(body.school ?? "").trim(),
        gender: body.gender,
        phone: sanitizePhoneInput(String(body.phone ?? "")),
        parentPhone: sanitizePhoneInput(String(body.parentPhone ?? "")),
        telegram: sanitizeTelegramInput(String(body.telegram ?? "")),
        courseProgram: body.courseProgram || null,
        courseTerm:
          body.courseProgram === "كورسات" ? body.courseTerm || null : null,
        studyType: body.studyType || null,
        locationScope: body.locationScope || null,
        baghdadMode: body.baghdadMode || null,
        mainSite: body.locationScope || body.mainSite,
        subSite: resolvedSubSite || body.subSite,
        code: body.code,
        status: body.status || "نشط",
        dismissalType: body.dismissalType,
        dismissalReason: body.dismissalReason,
        dismissalNotes: body.dismissalNotes
          ? String(body.dismissalNotes)
          : null,
        createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
        opportunities: Number(body.opportunities || 0),
        baseOpportunities: Number(body.baseOpportunities || 0),
        accountingGraceDays: normalizeGraceDays(body.accountingGraceDays),
        courseId: body.courseId,
        ...uniqueKeys,
      },
    });
    return NextResponse.json({ student }, { status: 201 });
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  const body = await req.json();
  const { id, ...data } = body;
  stripNonWritableStudentUpdateFields(data);
  if (!id)
    return NextResponse.json(
      { error: "تعذر تحديد الطالب المطلوب" },
      { status: 400 },
    );
  if (data.name !== undefined) {
    const nameError = getRequiredTextError(
      String(data.name ?? ""),
      "اسم الطالب",
    );
    if (nameError)
      return NextResponse.json({ error: nameError }, { status: 400 });
    data.name = String(data.name ?? "").trim();
  }
  if (data.phone !== undefined) {
    const phoneError = getPhoneValidationError(
      String(data.phone ?? ""),
      "رقم الطالب",
      true,
    );
    if (phoneError)
      return NextResponse.json({ error: phoneError }, { status: 400 });
    data.phone = sanitizePhoneInput(String(data.phone ?? ""));
  }
  if (data.parentPhone !== undefined) {
    const parentPhoneError = getPhoneValidationError(
      String(data.parentPhone ?? ""),
      "رقم ولي الأمر",
      true,
    );
    if (parentPhoneError)
      return NextResponse.json({ error: parentPhoneError }, { status: 400 });
    data.parentPhone = sanitizePhoneInput(String(data.parentPhone ?? ""));
  }
  if (data.telegram !== undefined)
    data.telegram = sanitizeTelegramInput(String(data.telegram ?? ""));
  if (data.accountingGraceDays !== undefined) {
    const graceDaysError = validateGraceDays(data.accountingGraceDays);
    if (graceDaysError)
      return NextResponse.json({ error: graceDaysError }, { status: 400 });
    data.accountingGraceDays = normalizeGraceDays(data.accountingGraceDays);
  }
  if (
    data.name !== undefined ||
    data.phone !== undefined ||
    data.telegram !== undefined
  ) {
    // Use targeted queries instead of loading all students
    const { nameKey: updateNameKey, phoneKey: updatePhoneKey, telegramKey: updateTelegramKey } = getStudentUniqueKeys({
      name: data.name ?? current?.name,
      phone: data.phone ?? current?.phone,
      telegram: data.telegram ?? current?.telegram,
    });
    const updateDuplicateConditions: Record<string, string>[] = [];
    if (updateNameKey) updateDuplicateConditions.push({ nameKey: updateNameKey });
    if (updatePhoneKey) updateDuplicateConditions.push({ phoneKey: updatePhoneKey });
    if (updateTelegramKey) updateDuplicateConditions.push({ telegramKey: updateTelegramKey });
    const duplicateSource = updateDuplicateConditions.length
      ? await db.student.findMany({
          where: { OR: updateDuplicateConditions },
          select: { id: true, name: true, phone: true, telegram: true },
          take: 10,
        })
      : [];
    const current = await db.student.findUnique({
      where: { id },
      select: { name: true, phone: true, telegram: true },
    });
    const duplicateMessage = getStudentDuplicateMessage(
      duplicateSource,
      {
        id,
        name: data.name ?? current?.name,
        phone: data.phone ?? current?.phone,
        telegram: data.telegram ?? current?.telegram,
      },
      id,
    );
    if (duplicateMessage)
      return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }
  const updateUniqueKeys = getStudentUniqueKeys({
    name: data.name ?? undefined,
    phone: data.phone ?? undefined,
    telegram: data.telegram ?? undefined,
  });
  if (data.name !== undefined) data.nameKey = updateUniqueKeys.nameKey;
  if (data.phone !== undefined) data.phoneKey = updateUniqueKeys.phoneKey;
  if (data.telegram !== undefined)
    data.telegramKey = updateUniqueKeys.telegramKey;

  if (data.createdAt !== undefined)
    data.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
  if (data.opportunities !== undefined)
    data.opportunities = Number(data.opportunities);
  if (data.baseOpportunities !== undefined)
    data.baseOpportunities = Number(data.baseOpportunities);

  // If course-related fields are being updated, validate against course settings
  if (
    data.courseProgram !== undefined ||
    data.courseTerm !== undefined ||
    data.studyType !== undefined ||
    data.locationScope !== undefined ||
    data.baghdadMode !== undefined ||
    data.subSite !== undefined ||
    data.courseId !== undefined
  ) {
    const targetCourseId =
      data.courseId !== undefined
        ? data.courseId
        : (
            await db.student.findUnique({
              where: { id },
              select: { courseId: true },
            })
          )?.courseId;

    if (targetCourseId) {
      const course = await db.course.findUnique({
        where: { id: String(targetCourseId) },
      });
      if (!course) {
        return NextResponse.json(
          { error: "الدورة المحددة غير موجودة" },
          { status: 400 },
        );
      }
      {
        const current = await db.student.findUnique({
          where: { id },
          select: {
            courseProgram: true,
            courseTerm: true,
            studyType: true,
            locationScope: true,
            baghdadMode: true,
            subSite: true,
          },
        });

        const courseChoices = {
          courseProgram: data.courseProgram ?? current?.courseProgram,
          courseTerm:
            data.courseProgram === "كورسات"
              ? (data.courseTerm ?? current?.courseTerm)
              : null,
          studyType: data.studyType ?? current?.studyType,
          locationScope: data.locationScope ?? current?.locationScope,
          baghdadMode: data.baghdadMode ?? current?.baghdadMode,
          subSite: data.subSite ?? current?.subSite,
        };

        const choiceValidation = validateStudentCourseChoices(
          course,
          courseChoices,
        );
        if (!choiceValidation.ok) {
          return NextResponse.json(
            { error: choiceValidation.error },
            { status: 400 },
          );
        }

        // Auto-resolve subSite
        const resolvedSubSite = resolveSubSite(
          course,
          String(courseChoices.studyType ?? ""),
          String(courseChoices.locationScope ?? ""),
          String(courseChoices.baghdadMode ?? ""),
          String(courseChoices.subSite ?? ""),
        );
        if (resolvedSubSite) data.subSite = resolvedSubSite;
      }
    }
  }

  try {
    const student = await db.student.update({ where: { id }, data });
    return NextResponse.json({ student });
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, "students.delete");
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id)
    return NextResponse.json(
      { error: "تعذر تحديد الطالب المطلوب" },
      { status: 400 },
    );
  try {
    await db.student.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}
