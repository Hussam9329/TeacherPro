import { Prisma } from "@prisma/client";
import { normalizeListFilter } from "@/lib/all-filter";
import { sanitizePhoneInput } from "@/lib/format";
import { normalizeArabicText } from "@/lib/route-helpers";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { BONUS_OPPORTUNITY_ACTION } from "@/lib/bonus-opportunity";

/** Active students one pass (or one missing grade) away from «فرصة مكافأة». */
export const BONUS_ON_THE_WAY_WHERE: Prisma.StudentWhereInput = {
  status: "نشط",
  bonusProgress: { gte: 1 },
};
/** Students whose ledger holds a «فرصة مكافأة». */
export const BONUS_EARNED_WHERE: Prisma.StudentWhereInput = {
  status: { not: "مؤرشف" },
  opportunityLogs: { some: { action: BONUS_OPPORTUNITY_ACTION } },
};

export type OpportunityFilterInput = {
  courseId?: string | null;
  status?: string | null;
  opportunityCount?: string | null;
  q?: string | null;
};

export type BulkOpportunityFilterInput = OpportunityFilterInput & {
  actionType?: string | null;
  excludeDismissed?: string | boolean | null;
  excludeFullOpportunities?: string | boolean | null;
};

export function composeStudentWhere(
  parts: Prisma.StudentWhereInput[],
): Prisma.StudentWhereInput {
  return parts.length > 0 ? { AND: parts } : {};
}

export function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "نعم"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "لا"].includes(normalized)) return false;
  return fallback;
}

export function buildOpportunitySearchWhere(
  rawQuery: string,
): Prisma.StudentWhereInput | null {
  const query = rawQuery.trim();
  if (!query) return null;
  const normalized = normalizeArabicText(query);
  const numeric = sanitizePhoneInput(query);
  // Telegram is searched by the recovered username, not the numeric Telegram id.
  const username = normalizeTelegramIdentifier(query);
  const or: Prisma.StudentWhereInput[] = [
    { name: { contains: query, mode: "insensitive" } },
    { code: { startsWith: query, mode: "insensitive" } },
    { school: { contains: query, mode: "insensitive" } },
    { subSite: { contains: query, mode: "insensitive" } },
    { status: { contains: query, mode: "insensitive" } },
    { dismissalReason: { contains: query, mode: "insensitive" } },
    { dismissalNotes: { contains: query, mode: "insensitive" } },
  ];
  if (normalized) {
    or.push({ nameKey: { contains: normalized, mode: "insensitive" } });
  }
  if (username) {
    or.push({ username: { contains: username, mode: "insensitive" } });
  }
  if (numeric) {
    or.push(
      { phone: { startsWith: numeric, mode: "insensitive" } },
      { phoneKey: { startsWith: numeric, mode: "insensitive" } },
      { parentPhone: { startsWith: numeric, mode: "insensitive" } },
    );
    if (numeric.length >= 7) {
      or.push(
        { phone: { contains: numeric, mode: "insensitive" } },
        { phoneKey: { contains: numeric, mode: "insensitive" } },
        { parentPhone: { contains: numeric, mode: "insensitive" } },
      );
    }
  }
  return { OR: or };
}

export function buildOpportunityFilters(
  input: OpportunityFilterInput,
): Prisma.StudentWhereInput[] {
  const and: Prisma.StudentWhereInput[] = [];
  // One course, or several together ("a,b"); none is every course.
  const courseIds = [...new Set(String(input.courseId || "").split(",").map((value) => normalizeListFilter(value)).filter(Boolean))];
  const status = normalizeListFilter(input.status || "");
  const opportunityCount = normalizeListFilter(input.opportunityCount || "");
  const query = String(input.q || "").trim();

  if (courseIds.length === 1) and.push({ courseId: courseIds[0] });
  else if (courseIds.length > 1) and.push({ courseId: { in: courseIds } });

  if (status === "active") and.push({ status: "نشط" });
  else if (status === "dismissed") and.push({ status: "مفصول" });
  else if (status === "has-opportunities") {
    and.push({ status: "نشط", opportunities: { gt: 0 } });
  } else if (status === "no-opportunities") {
    and.push({ status: "نشط", opportunities: 0 });
  } else if (status === "bonus-on-the-way") {
    and.push(BONUS_ON_THE_WAY_WHERE);
  } else if (status === "bonus-earned") {
    and.push(BONUS_EARNED_WHERE);
  } else {
    and.push({ status: { not: "مؤرشف" } });
  }

  if (opportunityCount !== "") {
    const numericCount = Number(opportunityCount);
    if (Number.isFinite(numericCount)) {
      and.push({ opportunities: Math.trunc(numericCount) });
    }
  }

  const searchWhere = buildOpportunitySearchWhere(query);
  if (searchWhere) and.push(searchWhere);

  return and;
}

export function hasActiveChapterWhere(): Prisma.StudentWhereInput {
  return {
    course: {
      chapters: {
        some: {
          active: true,
          archived: false,
        },
      },
    },
  };
}

export function noActiveChapterWhere(): Prisma.StudentWhereInput {
  return {
    course: {
      chapters: {
        none: {
          active: true,
          archived: false,
        },
      },
    },
  };
}
