export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  requireAnyPermission,
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
import {
  databaseMigrationRequiredResponse,
  normalizeArabicText,
  isMissingDatabaseObjectError,
} from "@/lib/route-helpers";
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
import { archiveAndResetStudentEnrollment } from "@/lib/student-enrollment-archive-server";
import { buildStudentAcademicImpactToken } from "@/lib/student-academic-impact-token";
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
  // Academic balances are owned by the opportunities/academic engine only.
  "opportunities",
  "baseOpportunities",
  // Status and dismissal transitions are owned by status-action. Keeping them
  // out of generic profile edits prevents accidental unarchive/reactivation.
  "status",
  "dismissalType",
  "dismissalReason",
  "dismissalNotes",
  // gracePeriodStartDate is set by the backend only (when graceDays changes)
  "gracePeriodStartDate",
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
    if (isMissingDatabaseObjectError(error)) {
      console.error("[API] /api/students missing database object:", error);
      return databaseMigrationRequiredResponse(
        "تعذر تسجيل الطالب لأن إصدار قاعدة البيانات لا يطابق إصدار النظام. أعد نشر آخر نسخة؛ الترحيلات ستُطبّق تلقائياً قبل تشغيلها.",
      );
    }
    return getPrismaStudentErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(
    req,
    "students.edit",
  );
  if (principalOrError instanceof NextResponse) return principalOrError;
  const principal = principalOrError;

  const body = await req.json().catch(() => ({}));
  const {
    id,
    courseTransferPolicy: rawCourseTransferPolicy,
    academicImpactConfirmed: rawAcademicImpactConfirmed,
    academicImpactPreviewToken: rawAcademicImpactPreviewToken,
    ...rawData
  } = body;
  const data: any = { ...rawData };
  stripNonWritableStudentUpdateFields(data);
  // Preserve only the user-requested fields before derived course values are
  // normalized. The transaction recalculates those derived values against the
  // latest course configuration instead of trusting an earlier read.
  const requestedData: Record<string, unknown> = { ...data };
  const courseTransferPolicy = normalizeCourseTransferPolicy(
    rawCourseTransferPolicy,
  );
  const academicImpactConfirmed = rawAcademicImpactConfirmed === true;
  const academicImpactPreviewToken = String(rawAcademicImpactPreviewToken || "").trim();

  if (!id) {
    return NextResponse.json(
      { error: "تعذر تحديد الطالب المطلوب" },
      { status: 400 },
    );
  }
  if (
    rawCourseTransferPolicy !== undefined &&
    rawCourseTransferPolicy !== null &&
    rawCourseTransferPolicy !== "" &&
    !courseTransferPolicy
  ) {
    return NextResponse.json(
      {
        error:
          "سياسة التغيير غير واضحة. اختر: طالب جديد أو الإبقاء على ملفه الحالي.",
      },
      { status: 400 },
    );
  }

  const currentStudent = await db.student.findUnique({
    where: { id: String(id) },
  });
  if (!currentStudent) {
    return NextResponse.json(
      { error: "تعذر العثور على الطالب المطلوب. حدّث الصفحة ثم حاول مرة أخرى." },
      { status: 404 },
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
  if (data.telegram !== undefined) {
    data.telegram = sanitizeTelegramInput(String(data.telegram ?? ""));
  }
  if (data.accountingGraceDays !== undefined) {
    const graceDaysError = validateGraceDays(data.accountingGraceDays);
    if (graceDaysError)
      return NextResponse.json({ error: graceDaysError }, { status: 400 });
    const requestedGraceDays = normalizeGraceDays(data.accountingGraceDays);
    data.accountingGraceDays = requestedGraceDays;
    // GRACE PERIOD START DATE: When the admin sets grace days > 0,
    // the grace period starts from NOW (not from registration date).
    // When the admin sets grace days = 0, clear the start date
    // (student goes back to automatic 3-day from registration only).
    if (requestedGraceDays > 0) {
      data.gracePeriodStartDate = new Date();
    } else {
      data.gracePeriodStartDate = null;
    }
  }
  if (data.createdAt !== undefined) {
    const parsedCreatedAt = new Date(String(data.createdAt || ""));
    if (!Number.isFinite(parsedCreatedAt.getTime())) {
      return NextResponse.json(
        { error: "تاريخ تسجيل الطالب غير صالح" },
        { status: 400 },
      );
    }
    data.createdAt = parsedCreatedAt;
  }

  const mergedIdentity = {
    id: String(id),
    name: data.name ?? currentStudent.name,
    phone: data.phone ?? currentStudent.phone,
    telegram: data.telegram ?? currentStudent.telegram,
  };
  if (
    data.name !== undefined ||
    data.phone !== undefined ||
    data.telegram !== undefined
  ) {
    const identityKeys = getStudentUniqueKeys(mergedIdentity);
    const duplicateConditions: Record<string, string>[] = [];
    if (identityKeys.nameKey)
      duplicateConditions.push({ nameKey: identityKeys.nameKey });
    if (identityKeys.phoneKey)
      duplicateConditions.push({ phoneKey: identityKeys.phoneKey });
    if (identityKeys.telegramKey)
      duplicateConditions.push({ telegramKey: identityKeys.telegramKey });
    const duplicateSource = duplicateConditions.length
      ? await db.student.findMany({
          where: { OR: duplicateConditions },
          select: { id: true, name: true, phone: true, telegram: true },
          take: 10,
        })
      : [];
    const duplicateMessage = getStudentDuplicateMessage(
      duplicateSource,
      mergedIdentity,
      String(id),
    );
    if (duplicateMessage) {
      return NextResponse.json({ error: duplicateMessage }, { status: 409 });
    }
    if (data.name !== undefined) data.nameKey = identityKeys.nameKey;
    if (data.phone !== undefined) data.phoneKey = identityKeys.phoneKey;
    if (data.telegram !== undefined)
      data.telegramKey = identityKeys.telegramKey;
  }

  const targetCourseId = String(
    data.courseId ?? currentStudent.courseId,
  ).trim();
  const targetCourse = await db.course.findUnique({
    where: { id: targetCourseId },
  });
  if (!targetCourse) {
    return NextResponse.json(
      { error: "الدورة المحددة غير موجودة" },
      { status: 400 },
    );
  }
  if (targetCourse.active === false && targetCourseId !== currentStudent.courseId) {
    return NextResponse.json(
      { error: "الدورة الجديدة موقوفة عن التسجيل حالياً" },
      { status: 400 },
    );
  }

  const nextCourseProgram = String(
    data.courseProgram ?? currentStudent.courseProgram ?? "",
  );
  const nextCourseTerm =
    nextCourseProgram === "كورسات"
      ? String(data.courseTerm ?? currentStudent.courseTerm ?? "")
      : "";
  const nextStudyType = String(
    data.studyType ?? currentStudent.studyType ?? "",
  );
  const nextLocationScope = String(
    data.locationScope ?? currentStudent.locationScope ?? "",
  );
  const nextBaghdadMode = String(
    data.baghdadMode ?? currentStudent.baghdadMode ?? "",
  );
  const requestedSubSite = String(data.subSite ?? currentStudent.subSite ?? "");
  const nextSubSite =
    resolveSubSite(
      targetCourse,
      nextStudyType,
      nextLocationScope,
      nextBaghdadMode,
      requestedSubSite,
    ) || requestedSubSite;

  const choiceValidation = validateStudentCourseChoices(targetCourse, {
    courseProgram: nextCourseProgram,
    courseTerm: nextCourseTerm,
    studyType: nextStudyType,
    locationScope: nextLocationScope,
    baghdadMode: nextBaghdadMode,
    subSite: nextSubSite,
  });
  if (!choiceValidation.ok) {
    return NextResponse.json(
      { error: choiceValidation.error },
      { status: 400 },
    );
  }
  if (data.courseTerm !== undefined || data.courseProgram !== undefined) {
    data.courseTerm = nextCourseTerm;
  }
  if (data.subSite !== undefined || data.studyType !== undefined || data.locationScope !== undefined || data.baghdadMode !== undefined || data.courseId !== undefined) {
    data.subSite = nextSubSite;
  }

  const normalized = (value: unknown) => String(value ?? "").trim();
  const courseChanged = targetCourseId !== currentStudent.courseId;
  const sameCourseContextChanged =
    !courseChanged &&
    [
      [nextCourseProgram, currentStudent.courseProgram],
      [nextCourseTerm, currentStudent.courseTerm],
      [nextStudyType, currentStudent.studyType],
      [nextLocationScope, currentStudent.locationScope],
      [nextBaghdadMode, currentStudent.baghdadMode],
      [String(data.mainSite ?? currentStudent.mainSite ?? ""), currentStudent.mainSite],
      [nextSubSite, currentStudent.subSite],
    ].some(([nextValue, currentValue]) =>
      normalized(nextValue) !== normalized(currentValue),
    );

  if (courseChanged && courseTransferPolicy !== "reset") {
    return NextResponse.json(
      {
        error:
          "النقل إلى دورة مختلفة يبدأ ملفاً جديداً دائماً. اختر «نقل كطالب جديد»؛ لا يمكن إبقاء درجات أو فرص الدورة السابقة فعالة.",
        requiresNewEnrollmentReset: true,
      },
      { status: 409 },
    );
  }
  if (sameCourseContextChanged && !courseTransferPolicy) {
    return NextResponse.json(
      {
        error:
          "تغيير نوع الدراسة/الدورة/الموقع داخل نفس الدورة يحتاج اختياراً واضحاً: الإبقاء على الملف كما هو أو البدء كطالب جديد.",
        requiresTransferPolicy: true,
      },
      { status: 409 },
    );
  }

  const resetEnrollment =
    courseChanged ||
    (sameCourseContextChanged && courseTransferPolicy === "reset");
  const requestedCreatedAt =
    data.createdAt instanceof Date ? data.createdAt : currentStudent.createdAt;
  const requestedGraceDays =
    data.accountingGraceDays !== undefined
      ? Number(data.accountingGraceDays)
      : Number(currentStudent.accountingGraceDays || 0);
  const registrationDateChanged =
    requestedCreatedAt.toISOString().slice(0, 10) !==
    currentStudent.createdAt.toISOString().slice(0, 10);
  const graceDaysChanged =
    requestedGraceDays !== Number(currentStudent.accountingGraceDays || 0);

  if (
    !resetEnrollment &&
    (registrationDateChanged || graceDaysChanged) &&
    (!academicImpactConfirmed || !academicImpactPreviewToken)
  ) {
    return NextResponse.json(
      {
        error:
          "تغيير تاريخ التسجيل أو فترة السماح قد يعيد تفسير الدرجات والخصومات القديمة. اعرض الأثر ثم أكد الحفظ.",
        requiresAcademicImpactPreview: true,
      },
      { status: 409 },
    );
  }

  try {
    const result = await withSerializableTransaction(async (tx) => {
      const lockedStudent = await tx.student.findUnique({
        where: { id: String(id) },
      });
      if (!lockedStudent) {
        throw new StudentIntegrityError(
          "تعذر العثور على الطالب المطلوب. حدّث الصفحة ثم حاول مرة أخرى.",
          404,
        );
      }
      const transactionTargetCourseId = String(
        requestedData.courseId ?? lockedStudent.courseId,
      ).trim();
      const transactionCourse = await tx.course.findUnique({
        where: { id: transactionTargetCourseId },
      });
      if (!transactionCourse) {
        throw new StudentIntegrityError("الدورة المحددة لم تعد موجودة", 400);
      }

      const transactionCourseChanged =
        transactionTargetCourseId !== lockedStudent.courseId;
      if (transactionCourseChanged && transactionCourse.active === false) {
        throw new StudentIntegrityError(
          "الدورة الجديدة موقوفة عن التسجيل حالياً",
          400,
        );
      }
      if (transactionCourseChanged && courseTransferPolicy !== "reset") {
        throw new StudentIntegrityError(
          "النقل إلى دورة مختلفة يجب أن ينفذ كطالب جديد.",
        );
      }

      const transactionCourseProgram = String(
        requestedData.courseProgram ?? lockedStudent.courseProgram ?? "",
      );
      const transactionCourseTerm =
        transactionCourseProgram === "كورسات"
          ? String(requestedData.courseTerm ?? lockedStudent.courseTerm ?? "")
          : "";
      const transactionStudyType = String(
        requestedData.studyType ?? lockedStudent.studyType ?? "",
      );
      const transactionLocationScope = String(
        requestedData.locationScope ?? lockedStudent.locationScope ?? "",
      );
      const transactionBaghdadMode = String(
        requestedData.baghdadMode ?? lockedStudent.baghdadMode ?? "",
      );
      const transactionRequestedSubSite = String(
        requestedData.subSite ?? lockedStudent.subSite ?? "",
      );
      const transactionSubSite =
        resolveSubSite(
          transactionCourse,
          transactionStudyType,
          transactionLocationScope,
          transactionBaghdadMode,
          transactionRequestedSubSite,
        ) || transactionRequestedSubSite;

      const transactionChoiceValidation = validateStudentCourseChoices(
        transactionCourse,
        {
          courseProgram: transactionCourseProgram,
          courseTerm: transactionCourseTerm,
          studyType: transactionStudyType,
          locationScope: transactionLocationScope,
          baghdadMode: transactionBaghdadMode,
          subSite: transactionSubSite,
        },
      );
      if (!transactionChoiceValidation.ok) {
        throw new StudentIntegrityError(
          transactionChoiceValidation.error,
          400,
        );
      }

      const transactionData: any = { ...data };
      transactionData.courseId = transactionTargetCourseId;
      if (
        requestedData.courseTerm !== undefined ||
        requestedData.courseProgram !== undefined
      ) {
        transactionData.courseTerm = transactionCourseTerm;
      }
      if (
        requestedData.subSite !== undefined ||
        requestedData.studyType !== undefined ||
        requestedData.locationScope !== undefined ||
        requestedData.baghdadMode !== undefined ||
        requestedData.courseId !== undefined
      ) {
        transactionData.subSite = transactionSubSite;
      }
      let archiveSummary: Awaited<
        ReturnType<typeof archiveAndResetStudentEnrollment>
      > | null = null;
      let academicRecalculation: Awaited<
        ReturnType<typeof recalculateStudentsAcademicState>
      > | null = null;
      const transactionSameCourseContextChanged =
        !transactionCourseChanged &&
        [
          [transactionCourseProgram, lockedStudent.courseProgram],
          [transactionCourseTerm, lockedStudent.courseTerm],
          [transactionStudyType, lockedStudent.studyType],
          [transactionLocationScope, lockedStudent.locationScope],
          [transactionBaghdadMode, lockedStudent.baghdadMode],
          [
            String(requestedData.mainSite ?? lockedStudent.mainSite ?? ""),
            lockedStudent.mainSite,
          ],
          [transactionSubSite, lockedStudent.subSite],
        ].some(([nextValue, currentValue]) =>
          normalized(nextValue) !== normalized(currentValue),
        );
      if (transactionSameCourseContextChanged && !courseTransferPolicy) {
        throw new StudentIntegrityError(
          "تغيير إعدادات الطالب داخل الدورة يحتاج اختيار الإبقاء أو البدء كطالب جديد.",
        );
      }
      const transactionResetEnrollment =
        transactionCourseChanged ||
        (transactionSameCourseContextChanged && courseTransferPolicy === "reset");
      const transactionKeepEnrollment =
        transactionSameCourseContextChanged && courseTransferPolicy === "keep";

      if (
        lockedStudent.status === ARCHIVED_STUDENT_STATUS &&
        (transactionResetEnrollment || transactionSameCourseContextChanged)
      ) {
        throw new StudentIntegrityError(
          "الطالب مؤرشف. استعده من إجراء «استعادة من الأرشيف» أولاً؛ تعديل الملف لا يعيد تفعيله ولا ينقله.",
          409,
        );
      }

      if (transactionResetEnrollment) {
        const resetKind = transactionCourseChanged
          ? "course-transfer"
          : "same-course-new-student";
        archiveSummary = await archiveAndResetStudentEnrollment(tx, {
          studentId: String(id),
          targetCourseId: transactionTargetCourseId,
          resetKind,
          reason: transactionCourseChanged
            ? `نقل الطالب من دورة ${lockedStudent.courseId} إلى دورة ${transactionTargetCourseId} وبدء ملف جديد`
            : "اختيار اعتبار الطالب جديداً بعد تغيير إعداداته داخل الدورة نفسها",
          createdById: principal.id,
          createdByName: principal.name,
        });
        const nextOpportunities = await getInitialOpportunities(
          transactionCourse,
          tx,
        );
        if (nextOpportunities.error) {
          throw new StudentIntegrityError(nextOpportunities.error);
        }
        transactionData.courseId = transactionTargetCourseId;
        transactionData.opportunities = nextOpportunities.opportunities;
        transactionData.baseOpportunities = nextOpportunities.baseOpportunities;
        transactionData.status = "نشط";
        transactionData.dismissalType = "";
        transactionData.dismissalReason = "";
        transactionData.dismissalNotes = "";
        // الطالب الجديد يبدأ من لحظة النقل/إعادة البداية؛ هذا يمنع امتحانات
        // الملف القديم من العودة إلى التأثير مستقبلاً.
        transactionData.createdAt = new Date();
      } else if (transactionKeepEnrollment) {
        // No recalculation and no balance rewrite. "Keep" is literal.
        delete transactionData.opportunities;
        delete transactionData.baseOpportunities;
      }

      const transactionRequestedCreatedAt =
        transactionData.createdAt instanceof Date
          ? transactionData.createdAt
          : lockedStudent.createdAt;
      const transactionRequestedGraceDays =
        transactionData.accountingGraceDays !== undefined
          ? Number(transactionData.accountingGraceDays)
          : Number(lockedStudent.accountingGraceDays || 0);
      const transactionRegistrationDateChanged =
        transactionRequestedCreatedAt.toISOString().slice(0, 10) !==
        lockedStudent.createdAt.toISOString().slice(0, 10);
      const transactionGraceDaysChanged =
        transactionRequestedGraceDays !==
        Number(lockedStudent.accountingGraceDays || 0);
      const transactionAcademicInputsChanged =
        transactionRegistrationDateChanged || transactionGraceDaysChanged;

      if (
        lockedStudent.status === ARCHIVED_STUDENT_STATUS &&
        transactionAcademicInputsChanged
      ) {
        throw new StudentIntegrityError(
          "تاريخ التسجيل وفترة السماح لا يُعدلان لطالب مؤرشف. استعد الطالب أولاً بإجراء الاستعادة المخصص.",
          409,
        );
      }

      if (!transactionResetEnrollment && transactionAcademicInputsChanged) {
        if (!academicImpactConfirmed || !academicImpactPreviewToken) {
          throw new StudentIntegrityError(
            "تغيير تاريخ التسجيل أو فترة السماح يحتاج معاينة أثر مؤكدة قبل الحفظ.",
            409,
          );
        }
        const currentPreviewToken = await buildStudentAcademicImpactToken(tx, {
          studentId: String(id),
          proposedCreatedAt: transactionRequestedCreatedAt,
          proposedGraceDays: transactionRequestedGraceDays,
        });
        if (currentPreviewToken !== academicImpactPreviewToken) {
          throw new StudentIntegrityError(
            "تغيرت بيانات الطالب الأكاديمية بعد المعاينة. أعد عرض الأثر ثم أكد الحفظ من جديد.",
            409,
          );
        }
      }

      const student = await tx.student.update({
        where: { id: String(id) },
        data: transactionData,
      });

      if (!transactionResetEnrollment && transactionAcademicInputsChanged) {
        academicRecalculation = await recalculateStudentsAcademicState(
          [String(id)],
          { tx },
        );
      }

      await tx.auditLog.create({
        data: {
          module: "سجل الطلاب",
          action: transactionResetEnrollment
            ? transactionCourseChanged
              ? "نقل طالب وبدء ملف جديد"
              : "إعادة بدء الطالب داخل الدورة"
            : transactionKeepEnrollment
              ? "تعديل إعدادات الطالب مع إبقاء الملف"
              : "تعديل بيانات طالب",
          details: `${student.name} - ${student.code} - ${archiveSummary ? `أرشيف ${archiveSummary.archiveId}` : "بدون تصفير"}`,
          userId: principal.id,
          userName: principal.name,
        },
      });

      const refreshedStudent =
        (await tx.student.findUnique({ where: { id: String(id) } })) || student;
      return {
        refreshedStudent,
        academicRecalculation,
        archiveSummary,
        resetApplied: transactionResetEnrollment,
        keepApplied: transactionKeepEnrollment,
      };
    });

    const [studentWithOpportunity] = await attachStudentOpportunitySnapshots([
      result.refreshedStudent,
    ]);

    return NextResponse.json({
      student: studentWithOpportunity,
      academicRecalculation: result.academicRecalculation,
      enrollmentArchive: result.archiveSummary,
      resetApplied: result.resetApplied,
      keepApplied: result.keepApplied,
      source: "database",
    });
  } catch (error) {
    // إذا كانت ترحيلات قاعدة البيانات الأخيرة غير مطبّقة (مثل جدول
    // StudentEnrollmentArchive أو قيود الدرجة/الامتحان)، أعطِ رسالة واضحة
    // بدل 500 عام كي يعرف المدير أنه يجب تشغيل npm run db:deploy.
    if (isMissingDatabaseObjectError(error)) {
      console.error("[API] /api/students missing database object:", error);
      return databaseMigrationRequiredResponse(
        "تعذر حفظ الطالب لأن إصدار قاعدة البيانات لا يطابق إصدار النظام. أعد نشر آخر نسخة؛ الترحيلات ستُطبّق تلقائياً قبل تشغيلها.",
      );
    }
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
