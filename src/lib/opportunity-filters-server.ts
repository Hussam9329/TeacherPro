import { Prisma } from "@prisma/client";
import { normalizeListFilter } from "@/lib/all-filter";
import { sanitizePhoneInput } from "@/lib/format";
import { normalizeArabicText } from "@/lib/route-helpers";
import { sanitizeTelegramInput } from "@/lib/student-utils";

export type OpportunityFilterInput = {
  courseId?: string | null;
  status?: string | null;
  opportunityCount?: string | null;
  q?: string | null;
};

export type BulkOpportunityActionType = "add" | "deduct";

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
  const telegram = sanitizeTelegramInput(query)
    .replace(/\s+/g, "")
    .toLowerCase();
  const or: Prisma.StudentWhereInput[] = [
    { name: { contains: query, mode: "insensitive" } },
    { code: { startsWith: query, mode: "insensitive" } },
    { school: { contains: query, mode: "insensitive" } },
    { subSite: { contains: query, mode: "insensitive" } },
    { status: { contains: query, mode: "insensitive" } },
    { dismissalType: { contains: query, mode: "insensitive" } },
    { dismissalReason: { contains: query, mode: "insensitive" } },
    { dismissalNotes: { contains: query, mode: "insensitive" } },
  ];
  if (normalized) {
    or.push({ nameKey: { contains: normalized, mode: "insensitive" } });
  }
  if (telegram) {
    or.push(
      { telegramKey: { startsWith: telegram, mode: "insensitive" } },
      {
        telegram: {
          startsWith: sanitizeTelegramInput(query),
          mode: "insensitive",
        },
      },
    );
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
  const courseId = normalizeListFilter(input.courseId || "");
  const status = normalizeListFilter(input.status || "");
  const opportunityCount = normalizeListFilter(input.opportunityCount || "");
  const query = String(input.q || "").trim();

  if (courseId) and.push({ courseId });

  if (status === "active") and.push({ status: "نشط" });
  else if (status === "dismissed") and.push({ status: "مفصول" });
  else if (status === "has-opportunities") {
    and.push({ status: "نشط", opportunities: { gt: 0 } });
  } else if (status === "no-opportunities") {
    and.push({ status: "نشط", opportunities: 0 });
  } else if (status === "temporary-dismissal") {
    and.push({ status: "مفصول", dismissalType: "فصل مؤقت" });
  } else if (status === "final-dismissal") {
    and.push({ status: "مفصول", dismissalType: "فصل نهائي" });
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

export function bulkOpportunityWhereParts(
  input: BulkOpportunityFilterInput,
): Prisma.StudentWhereInput[] {
  const actionType = input.actionType === "deduct" ? "deduct" : "add";
  const excludeDismissed = normalizeBoolean(input.excludeDismissed, true);
  const excludeFullOpportunities = normalizeBoolean(
    input.excludeFullOpportunities,
    true,
  );
  const parts = [...buildOpportunityFilters(input), hasActiveChapterWhere()];

  if (actionType === "add" && excludeDismissed) {
    parts.push({ status: { not: "مفصول" } });
  }

  // أصحاب الفرص الكاملة يحتاجون مقارنة ديناميكية بسقف الفصل النشط الفعلي، لذلك
  // يتم حسمهم بعد جلب Snapshot موحد داخل API حتى تطابق المعاينة التنفيذ.
  void excludeFullOpportunities;

  return parts;
}
