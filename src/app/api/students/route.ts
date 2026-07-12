export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  requireAnyPermission,
  requirePermission,
  requirePermissionPrincipal,
} from "@/lib/server-auth";
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
import { normalizeListFilter } from "@/lib/all-filter";
import {
  ARCHIVED_STUDENT_STATUS,
  buildStudentArchiveSummary,
  getStudentDeleteImpact,
} from "@/lib/student-delete-impact";
import {
  validateStudentCourseChoices,
  resolveSubSite,
} from "@/lib/course-config";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import {
  allocateStudentCodes,
  ensureStudentCodeSequenceReady,
  retryStudentCodeConflict,
} from "@/lib/student-code-sequence";

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

type CourseTransferPolicy = "reset" | "keep";

function normalizeCourseTransferPolicy(
  value: unknown,
): CourseTransferPolicy | "" {
  return value === "reset" || value === "keep" ? value : "";
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

class StudentIntegrityError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "StudentIntegrityError";
    this.status = status;
  }
}

function getPrismaStudentErrorResponse(error: unknown) {
  if (error instanceof StudentIntegrityError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
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

function buildExactIdentifierSearchWhere(
  rawQuery: string,
): Prisma.StudentWhereInput {
  const telegramQuery = sanitizeTelegramInput(rawQuery)
    .replace(/\s+/g, "")
    .toLowerCase();
  const codeQuery = rawQuery.trim();
  const or: Prisma.StudentWhereInput[] = [
    { telegramKey: { equals: telegramQuery, mode: "insensitive" } },
    {
      telegram: {
        equals: sanitizeTelegramInput(rawQuery),
        mode: "insensitive",
      },
    },
  ];

  if (!rawQuery.trim().startsWith("@")) {
    or.push({ code: { equals: codeQuery, mode: "insensitive" } });
  }

  return { OR: or };
}

function buildPrefixIdentifierSearchWhere(
  rawQuery: string,
): Prisma.StudentWhereInput {
  const telegramQuery = sanitizeTelegramInput(rawQuery)
    .replace(/\s+/g, "")
    .toLowerCase();
  const codeQuery = rawQuery.trim();
  const or: Prisma.StudentWhereInput[] = [
    { telegramKey: { startsWith: telegramQuery, mode: "insensitive" } },
    {
      telegram: {
        startsWith: sanitizeTelegramInput(rawQuery),
        mode: "insensitive",
      },
    },
  ];

  if (!rawQuery.trim().startsWith("@")) {
    or.push({ code: { startsWith: codeQuery, mode: "insensitive" } });
  }

  return { OR: or };
}

function buildRegularStudentSearchWhere(
  rawQuery: string,
): Prisma.StudentWhereInput {
  const normalizedQuery = normalizeArabicText(rawQuery);
  const numericQuery = sanitizePhoneInput(rawQuery);
  const telegramQuery = sanitizeTelegramInput(rawQuery)
    .replace(/\s+/g, "")
    .toLowerCase();

  const or: Prisma.StudentWhereInput[] = [
    { name: { contains: rawQuery, mode: "insensitive" } },
    { nameKey: { contains: normalizedQuery, mode: "insensitive" } },
    { code: { startsWith: rawQuery, mode: "insensitive" } },
  ];

  if (telegramQuery) {
    or.push(
      { telegramKey: { startsWith: telegramQuery, mode: "insensitive" } },
      {
        telegram: {
          startsWith: sanitizeTelegramInput(rawQuery),
          mode: "insensitive",
        },
      },
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

  const status = normalizeListFilter(searchParams.get("status"));
  if (status) {
    and.push({ status });
  } else {
    // الطلاب المؤرشفون محفوظون للسجلات والتقارير، لكن لا يظهرون في القوائم اليومية
    // إلا عند اختيار فلتر "مؤرشف" صراحةً.
    and.push({ status: { not: ARCHIVED_STUDENT_STATUS } });
  }

  const courseId = normalizeListFilter(searchParams.get("courseId"));
  if (courseId) and.push({ courseId });

  const courseIds = String(searchParams.get("courseIds") ?? "")
    .split(",")
    .map((item) => normalizeListFilter(item))
    .filter(Boolean);
  if (courseIds.length > 0) and.push({ courseId: { in: courseIds } });

  const courseProgram = normalizeListFilter(searchParams.get("courseProgram"));
  if (courseProgram) and.push({ courseProgram });

  const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
  if (courseProgram === "كورسات" && courseTerm) and.push({ courseTerm });

  const studyType = normalizeListFilter(searchParams.get("studyType"));
  if (studyType) and.push({ studyType });

  const location = normalizeListFilter(searchParams.get("location"));
  const locationWhere = location ? buildLocationWhere(location) : null;
  if (locationWhere) and.push(locationWhere);

  // Database-side filters used by إدارة الفرص. Keep them under explicit
  // names so normal student status filtering remains the literal Arabic value.
  const opportunityStatus = normalizeListFilter(
    searchParams.get("opportunityStatus"),
  );
  if (opportunityStatus === "active") and.push({ status: "نشط" });
  else if (opportunityStatus === "dismissed") and.push({ status: "مفصول" });
  else if (opportunityStatus === "has-opportunities")
    and.push({ status: "نشط", opportunities: { gt: 0 } });
  else if (opportunityStatus === "no-opportunities")
    and.push({ status: "نشط", opportunities: 0 });
  else if (opportunityStatus === "temporary-dismissal")
    and.push({ status: "مفصول", dismissalType: "فصل مؤقت" });
  else if (opportunityStatus === "final-dismissal")
    and.push({ status: "مفصول", dismissalType: "فصل نهائي" });

  const opportunityCount = normalizeListFilter(
    searchParams.get("opportunityCount"),
  );
  if (opportunityCount !== "") {
    const count = Number(opportunityCount);
    if (Number.isFinite(count) && count >= 0)
      and.push({ opportunities: Math.trunc(count) });
  }

  return and;
}

async function buildRegistryIssueWhere(
  searchParams: URLSearchParams,
): Promise<Prisma.StudentWhereInput | null> {
  const registryIssue = normalizeListFilter(searchParams.get("registryIssue"));
  if (!registryIssue) return null;

  if (registryIssue === "missing-contact") {
    return {
      OR: [
        { phone: null },
        { phone: "" },
        { parentPhone: null },
        { parentPhone: "" },
      ],
    };
  }

  if (registryIssue === "no-telegram") {
    return {
      OR: [{ telegram: null }, { telegram: "" }, { telegramKey: null }],
    };
  }

  if (registryIssue === "zero-opportunities") {
    return { status: "نشط", opportunities: 0 };
  }

  const activeLinks = await db.courseChapter.findMany({
    where: { active: true, archived: false },
    select: {
      courseId: true,
      chapter: { select: { opportunities: true } },
    },
  });
  const grouped = new Map<string, typeof activeLinks>();
  for (const link of activeLinks) {
    const list = grouped.get(link.courseId) || [];
    list.push(link);
    grouped.set(link.courseId, list);
  }

  if (registryIssue === "active-chapter-conflict") {
    const conflictCourseIds = Array.from(grouped.entries())
      .filter(([, links]) => links.length > 1)
      .map(([courseId]) => courseId);
    return conflictCourseIds.length
      ? { courseId: { in: conflictCourseIds } }
      : { id: "__none__" };
  }

  if (registryIssue === "no-active-chapter") {
    const allCourses = await db.course.findMany({ select: { id: true } });
    const noActiveCourseIds = allCourses
      .map((course) => course.id)
      .filter((courseId) => {
        const links = grouped.get(courseId) || [];
        const cap =
          links.length === 1 ? Number(links[0].chapter.opportunities || 0) : 0;
        return links.length !== 1 || cap <= 0;
      });
    return noActiveCourseIds.length
      ? { courseId: { in: noActiveCourseIds } }
      : { id: "__none__" };
  }

  if (
    registryIssue === "opportunity-full" ||
    registryIssue === "opportunity-over-limit"
  ) {
    const courseCaps = Array.from(grouped.entries())
      .map(([courseId, links]) => ({
        courseId,
        cap:
          links.length === 1
            ? Math.max(
                0,
                Math.trunc(Number(links[0].chapter.opportunities || 0)),
              )
            : 0,
      }))
      .filter((item) => item.cap > 0);
    const or = courseCaps.map(({ courseId, cap }) => ({
      courseId,
      opportunities:
        registryIssue === "opportunity-full" ? { gte: cap } : { gt: cap },
    }));
    return or.length ? { OR: or } : { id: "__none__" };
  }

  return null;
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
  const authError = await requireAnyPermission(req, [
    "students.view",
    "grades.add",
    "grades.view",
    "grades.edit",
    "opportunities.view",
  ]);
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
  const registryIssueWhere = await buildRegistryIssueWhere(searchParams);
  if (registryIssueWhere) filters.push(registryIssueWhere);
  let searchWhere: Prisma.StudentWhereInput | null = null;

  if (rawQuery) {
    if (looksLikeTelegramIdentifierQuery(rawQuery)) {
      const exactSearchWhere = buildExactIdentifierSearchWhere(rawQuery);
      const exactWhere = composeStudentWhere(filters, exactSearchWhere);
      const exactCount = await db.student.count({ where: exactWhere });

      // If the complete identifier/code exists, return only it. This prevents
      // showing the correct result followed by unrelated prefix/partial matches.
      searchWhere =
        exactCount > 0
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

  const opportunityMode = searchParams.get("opportunityMode") === "1";
  let responseStudents: Array<Record<string, unknown>> =
    students as unknown as Array<Record<string, unknown>>;

  if (opportunityMode && students.length > 0) {
    responseStudents = (await attachStudentOpportunitySnapshots(
      students,
    )) as unknown as Array<Record<string, unknown>>;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return NextResponse.json({
    students: responseStudents,
    totalCount,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  });
}

type InitialOpportunitiesResult = {
  opportunities: number;
  baseOpportunities: number;
  hasActiveChapter: boolean;
  activeChapterName?: string;
  warning?: string;
  error?: string;
};

/**
 * النظام هو صاحب القرار النهائي لفرص الطالب عند التسجيل.
 * لا نعتمد نهائياً على opportunities/baseOpportunities القادمة من العميل،
 * لأن أي طلب API مباشر قد يرسل قيماً غير صحيحة. عند وجود فصل نشط واحد للدورة
 * نستخدم فرص الفصل فقط، وعند غياب الفصل النشط نسجل الطالب بفرص صفر مع
 * تحذير إداري واضح. أما وجود أكثر من فصل نشط فهو تعارض خطير يمنع التسجيل
 * حتى يتم إصلاح صفحة الفصول والفرص.
 */
async function getInitialOpportunities(
  course: { id: string; name?: string | null } | null,
  client: typeof db | Prisma.TransactionClient = db,
): Promise<InitialOpportunitiesResult> {
  if (!course) {
    return {
      opportunities: 0,
      baseOpportunities: 0,
      hasActiveChapter: false,
      warning: "الدورة المحددة غير موجودة، لذلك لا يمكن احتساب فرص الطالب.",
      error: "الدورة المحددة غير موجودة",
    };
  }

  const activeCourseChapters = await client.courseChapter.findMany({
    where: { courseId: course.id, active: true, archived: false },
    include: { chapter: { select: { name: true, opportunities: true } } },
  });

  if (activeCourseChapters.length > 1) {
    return {
      opportunities: 0,
      baseOpportunities: 0,
      hasActiveChapter: false,
      error:
        "لا يمكن تسجيل الطالب لأن هذه الدورة تحتوي أكثر من فصل نشط. أصلح الفصول والفرص أولاً.",
    };
  }

  if (activeCourseChapters.length === 0) {
    return {
      opportunities: 0,
      baseOpportunities: 0,
      hasActiveChapter: false,
      warning: "هذه الدورة لا تحتوي على فصل نشط، الطالب سيُسجل بدون فرص.",
    };
  }

  const activeCourseChapter = activeCourseChapters[0];
  const opp = Math.max(
    0,
    Math.trunc(Number(activeCourseChapter.chapter.opportunities || 0)),
  );

  return {
    opportunities: opp,
    baseOpportunities: opp,
    hasActiveChapter: true,
    activeChapterName: activeCourseChapter.chapter.name,
    warning:
      opp <= 0
        ? "الفصل النشط لهذه الدورة فرصه 0، لذلك سيبدأ الطالب بدون فرص."
        : undefined,
  };
}

export async function POST(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(
    req,
    "students.add",
  );
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

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

  if (course.active === false) {
    return NextResponse.json(
      { error: "هذه الدورة موقوفة عن التسجيل حالياً" },
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

  const initialOpportunitiesCheck = await getInitialOpportunities(course);
  if (initialOpportunitiesCheck.error) {
    return NextResponse.json(
      { error: initialOpportunitiesCheck.error },
      { status: 409 },
    );
  }

  try {
    await ensureStudentCodeSequenceReady();
    const created = await retryStudentCodeConflict(() =>
      withSerializableTransaction(async (tx) => {
        // Re-read the course and active chapter inside the same serializable
        // transaction that creates the student. The outer validation is only an
        // early UX check and is never trusted during a concurrent settings change.
        const transactionCourse = await tx.course.findUnique({
          where: { id: String(body.courseId) },
        });
        if (!transactionCourse) {
          throw new StudentIntegrityError(
            "الدورة المحددة لم تعد موجودة. لم يتم تسجيل الطالب.",
            400,
          );
        }
        if (transactionCourse.active === false) {
          throw new StudentIntegrityError(
            "هذه الدورة موقوفة عن التسجيل حالياً",
            400,
          );
        }
        const transactionChoiceValidation = validateStudentCourseChoices(
          transactionCourse,
          courseChoices,
        );
        if (!transactionChoiceValidation.ok) {
          throw new StudentIntegrityError(
            transactionChoiceValidation.error,
            400,
          );
        }
        const transactionSubSite = resolveSubSite(
          transactionCourse,
          String(body.studyType ?? ""),
          String(body.locationScope ?? ""),
          String(body.baghdadMode ?? ""),
          String(body.subSite ?? ""),
        );
        const initialOpportunitiesResult = await getInitialOpportunities(
          transactionCourse,
          tx,
        );
        if (initialOpportunitiesResult.error) {
          throw new StudentIntegrityError(initialOpportunitiesResult.error);
        }
        const [code] = await allocateStudentCodes(tx, 1);
        const createdStudent = await tx.student.create({
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
            subSite: transactionSubSite || body.subSite,
            // PostgreSQL sequence allocation is atomic across all app instances.
            code,
            status: "نشط",
            dismissalType: "",
            dismissalReason: "",
            dismissalNotes: body.dismissalNotes
              ? String(body.dismissalNotes)
              : null,
            createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
            opportunities: initialOpportunitiesResult.opportunities,
            baseOpportunities: initialOpportunitiesResult.baseOpportunities,
            accountingGraceDays: normalizeGraceDays(body.accountingGraceDays),
            courseId: body.courseId,
            ...uniqueKeys,
          },
        });

        await tx.auditLog.create({
          data: {
            module: "تسجيل الطلاب",
            action: "تسجيل طالب",
            details: `${createdStudent.name} - ${createdStudent.code} - ${transactionCourse.name}${
              initialOpportunitiesResult.activeChapterName
                ? ` - ${initialOpportunitiesResult.activeChapterName}`
                : ""
            }`,
            userId: principal.id,
            userName: principal.name,
          },
        });

        return {
          student: createdStudent,
          opportunitiesWarning: initialOpportunitiesResult.warning,
        };
      }),
    );

    const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
      created.student,
    ]);

    return NextResponse.json(
      {
        student: studentWithOpportunity,
        opportunitiesWarning: created.opportunitiesWarning,
        source: "database",
      },
      { status: 201 },
    );
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "students.edit");
  if (authError) return authError;

  const body = await req.json();
  const { id, courseTransferPolicy: rawCourseTransferPolicy, ...data } = body;
  stripNonWritableStudentUpdateFields(data);
  const courseTransferPolicy = normalizeCourseTransferPolicy(
    rawCourseTransferPolicy,
  );
  if (!id)
    return NextResponse.json(
      { error: "تعذر تحديد الطالب المطلوب" },
      { status: 400 },
    );
  if (
    rawCourseTransferPolicy !== undefined &&
    rawCourseTransferPolicy !== null &&
    rawCourseTransferPolicy !== "" &&
    !courseTransferPolicy
  ) {
    return NextResponse.json(
      {
        error:
          "سياسة نقل الطالب غير واضحة. اختر: اعتباره طالب جديد للدورة أو الإبقاء على فرصه كما هي.",
      },
      { status: 400 },
    );
  }
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
    const current = await db.student.findUnique({
      where: { id },
      select: { name: true, phone: true, telegram: true },
    });
    const {
      nameKey: updateNameKey,
      phoneKey: updatePhoneKey,
      telegramKey: updateTelegramKey,
    } = getStudentUniqueKeys({
      name: data.name ?? current?.name,
      phone: data.phone ?? current?.phone,
      telegram: data.telegram ?? current?.telegram,
    });
    const updateDuplicateConditions: Record<string, string>[] = [];
    if (updateNameKey)
      updateDuplicateConditions.push({ nameKey: updateNameKey });
    if (updatePhoneKey)
      updateDuplicateConditions.push({ phoneKey: updatePhoneKey });
    if (updateTelegramKey)
      updateDuplicateConditions.push({ telegramKey: updateTelegramKey });
    const duplicateSource = updateDuplicateConditions.length
      ? await db.student.findMany({
          where: { OR: updateDuplicateConditions },
          select: { id: true, name: true, phone: true, telegram: true },
          take: 10,
        })
      : [];
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
  if (data.opportunities !== undefined) {
    data.opportunities = Number(data.opportunities);
    // Clamp opportunities to the active chapter's baseOpportunities for this
    // student's course. This prevents the client from writing values above
    // the cap (e.g. due to stale cache or a stale bulk operation that ran
    // before a chapter change). The clamp applies whenever opportunities is
    // explicitly being written, regardless of which course it is.
    const courseIdForClamp =
      String(data.courseId || "").trim() ||
      (
        await db.student.findUnique({
          where: { id },
          select: { courseId: true },
        })
      )?.courseId;
    if (courseIdForClamp) {
      const activeLink = await db.courseChapter.findFirst({
        where: { courseId: courseIdForClamp, active: true, archived: false },
        select: { chapterId: true },
      });
      if (activeLink) {
        const chapter = await db.chapter.findUnique({
          where: { id: activeLink.chapterId },
          select: { opportunities: true },
        });
        const chapterOpp = Number(chapter?.opportunities || 0);
        if (chapterOpp > 0) {
          data.opportunities = Math.min(
            Math.max(0, Math.trunc(data.opportunities)),
            chapterOpp,
          );
          // Keep baseOpportunities aligned with the active chapter.
          data.baseOpportunities = chapterOpp;
        }
      }
    }
  }
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

  let resetOpportunityHistory = false;
  let resetTargetCourseId = "";

  // كشف تغيير الدورة، نوع البرنامج، أو نوع الدورة. كل واحدة من هذي التغييرات
  // تستوجب قراراً واضحاً من المستخدم: هل يريد اعتبار الطالب جديداً (reset)
  // أو الإبقاء على فرصه (keep)؟
  const fieldsRequiringTransferPolicy =
    data.courseId !== undefined ||
    data.studyType !== undefined ||
    data.courseProgram !== undefined;

  if (fieldsRequiringTransferPolicy) {
    const currentStudent = await db.student.findUnique({
      where: { id },
      select: {
        courseId: true,
        opportunities: true,
        baseOpportunities: true,
        studyType: true,
        courseProgram: true,
      },
    });
    if (!currentStudent) {
      return NextResponse.json(
        {
          error:
            "تعذر العثور على الطالب المطلوب. حدّث الصفحة ثم حاول مرة أخرى.",
        },
        { status: 404 },
      );
    }

    const targetCourseId = String(data.courseId ?? "").trim();
    const courseChanged =
      data.courseId !== undefined &&
      Boolean(targetCourseId) &&
      targetCourseId !== currentStudent.courseId;

    const studyTypeChanged =
      data.studyType !== undefined &&
      Boolean(data.studyType) &&
      String(data.studyType) !== String(currentStudent.studyType ?? "");

    const courseProgramChanged =
      data.courseProgram !== undefined &&
      Boolean(data.courseProgram) &&
      String(data.courseProgram) !== String(currentStudent.courseProgram ?? "");

    const needsTransferPolicy =
      courseChanged || studyTypeChanged || courseProgramChanged;

    if (needsTransferPolicy && !courseTransferPolicy) {
      const reasons: string[] = [];
      if (courseChanged) reasons.push("الدورة");
      if (studyTypeChanged) reasons.push("نوع البرنامج");
      if (courseProgramChanged) reasons.push("نوع الدورة");
      return NextResponse.json(
        {
          error: `تغيير ${reasons.join("، ")} يحتاج قراراً واضحاً: هل تريد اعتباره طالباً جديداً بفرص الفصل النشط، أم الإبقاء على فرصه وسجله كما هي؟`,
        },
        { status: 400 },
      );
    }

    if (needsTransferPolicy && courseTransferPolicy === "reset") {
      // استخدم الدورة المستهدفة (سواء كانت موجودة أو جديدة) لاحتساب الفرص.
      const courseForOpp = targetCourseId || currentStudent.courseId;
      const nextOpportunities = await getInitialOpportunities({
        id: courseForOpp,
      });
      if (nextOpportunities.error) {
        return NextResponse.json(
          { error: nextOpportunities.error },
          { status: 409 },
        );
      }
      data.opportunities = nextOpportunities.opportunities;
      data.baseOpportunities = nextOpportunities.baseOpportunities;
      resetOpportunityHistory = true;
      resetTargetCourseId = courseForOpp;
      // امسح حالة الفصل القديمة حتى يبدأ الطالب كصفحة بيضاء في الدورة الجديدة.
      data.status = "نشط";
      data.dismissalType = "";
      data.dismissalReason = "";
      data.dismissalNotes = "";
      // حذف السجل سيتم داخل نفس transaction التي تنقل الطالب وتعيد احتسابه.
      // بذلك لا يمكن أن تضيع السجلات إذا فشل تحديث الطالب بعد الحذف.
    }

    if (needsTransferPolicy && courseTransferPolicy === "keep") {
      // Keep means a pure settings transfer. Do not let stale client
      // values rewrite the student's current opportunity balance.
      delete data.opportunities;
      delete data.baseOpportunities;
    }
  }

  try {
    const result = await withSerializableTransaction(async (tx) => {
      const transactionData = { ...data };

      if (resetOpportunityHistory) {
        const nextOpportunities = await getInitialOpportunities(
          { id: resetTargetCourseId },
          tx,
        );
        if (nextOpportunities.error) {
          throw new StudentIntegrityError(nextOpportunities.error);
        }
        transactionData.opportunities = nextOpportunities.opportunities;
        transactionData.baseOpportunities = nextOpportunities.baseOpportunities;
        await tx.opportunityLog.deleteMany({ where: { studentId: id } });
      }

      const student = await tx.student.update({
        where: { id },
        data: transactionData,
      });

      // Updating the student, deleting the old opportunity history (for reset),
      // and recalculating the new academic state are one all-or-nothing unit.
      const academicRecalculation = await recalculateStudentsAcademicState(
        [id],
        { tx },
      );
      const refreshedStudent =
        (await tx.student.findUnique({ where: { id } })) || student;

      return { refreshedStudent, academicRecalculation };
    });

    const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
      result.refreshedStudent,
    ]);

    return NextResponse.json({
      student: studentWithOpportunity,
      academicRecalculation: result.academicRecalculation,
      source: "database",
    });
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(
    req,
    "students.delete",
  );
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id)
    return NextResponse.json(
      { error: "تعذر تحديد الطالب المطلوب" },
      { status: 400 },
    );
  try {
    const impact = await getStudentDeleteImpact(id);
    if (!impact) {
      return NextResponse.json(
        { error: "تعذر العثور على الطالب المطلوب" },
        { status: 404 },
      );
    }

    if (impact.student.status === ARCHIVED_STUDENT_STATUS) {
      return NextResponse.json({ ok: true, archived: true, impact });
    }

    const relationSummary = buildStudentArchiveSummary(impact.counts);
    const archiveText = `أرشفة الطالب بدلاً من الحذف النهائي. السبب: حماية البيانات المرتبطة (${relationSummary}). الحالة السابقة: ${impact.student.status || "غير محددة"}.`;

    const [student] = await db.$transaction([
      db.student.update({
        where: { id },
        data: {
          status: ARCHIVED_STUDENT_STATUS,
          dismissalReason: "أرشفة إدارية",
          dismissalNotes: archiveText,
        },
      }),
      db.studentNote.create({
        data: {
          studentId: id,
          kind: "أرشفة",
          text: archiveText,
          sourceType: "student-archive",
          sourceId: id,
        },
      }),
      db.auditLog.create({
        data: {
          module: "سجل الطلاب",
          action: "أرشفة طالب بدل الحذف",
          details: `${impact.student.name} - ${impact.student.code} - ${relationSummary}`,
          userId: principal.id,
          userName: principal.name,
        },
      }),
    ]);

    const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
      student,
    ]);

    return NextResponse.json({
      ok: true,
      archived: true,
      student: studentWithOpportunity,
      impact: {
        ...impact,
        counts: {
          ...impact.counts,
          notes: impact.counts.notes + 1,
        },
        totalRelations: impact.totalRelations + 1,
        hasRelations: true,
      },
      message: "تمت أرشفة الطالب بدل الحذف النهائي حفاظاً على سجلاته.",
    });
  } catch (error) {
    return getPrismaStudentErrorResponse(error);
  }
}
