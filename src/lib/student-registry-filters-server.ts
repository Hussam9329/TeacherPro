import type { Prisma } from "@prisma/client";
import { sanitizePhoneInput } from "@/lib/format";
import { normalizeArabicText } from "@/lib/route-helpers";
import { sanitizeTelegramInput } from "@/lib/student-utils";
import { getStudentFilterLocationAliases } from "@/lib/student-list-filters";
import { normalizeListFilter } from "@/lib/all-filter";
import { STUDENT_STATUS_ARCHIVED } from "@/lib/student-scope";
import { buildStudentRegistryIssueWhere } from "@/lib/student-registry-issue-server";

const BAGHDAD_SITES = ["المنصور", "البنوك", "زيونة"] as const;

function locationFieldWhere(
  field: "locationScope" | "mainSite" | "subSite",
  values: readonly string[],
): Prisma.StudentWhereInput[] {
  return values.map((value) => ({
    [field]: { equals: value, mode: "insensitive" },
  }));
}

/**
 * Authoritative location predicate for the student registry, its counters and
 * exports. Baghdad remains a broad scope, while its configured sites can be
 * selected independently. Historical spellings are matched as one location.
 */
export function buildStudentRegistryLocationWhere(
  rawLocation: string,
): Prisma.StudentWhereInput | null {
  const location = rawLocation.trim();
  const normalized = normalizeArabicText(location);
  if (!normalized) return null;

  if (normalized === normalizeArabicText("بغداد")) {
    return { locationScope: "بغداد" };
  }

  if (normalized === normalizeArabicText("خارج القطر")) {
    return { locationScope: "خارج القطر" };
  }

  const aliases = getStudentFilterLocationAliases(location);
  const isBaghdadSite = BAGHDAD_SITES.some(
    (site) => normalizeArabicText(site) === normalized,
  );
  if (isBaghdadSite) {
    return {
      AND: [
        {
          OR: [
            { locationScope: "بغداد" },
            { locationScope: null },
            { locationScope: "" },
          ],
        },
        {
          OR: [
            ...locationFieldWhere("mainSite", aliases),
            ...locationFieldWhere("subSite", aliases),
          ],
        },
      ],
    };
  }

  const or = (["locationScope", "mainSite", "subSite"] as const).flatMap(
    (field) => locationFieldWhere(field, aliases),
  );
  return or.length ? { OR: or } : null;
}

/**
 * One search definition shared by list, statistics and export. Telegram is
 * searched through its normalized key (without @) and its display value, but
 * latin text always remains eligible as a student name as well.
 */
export function buildStudentRegistrySearchWhere(
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
  ];

  if (normalized) {
    or.push({ nameKey: { contains: normalized, mode: "insensitive" } });
  }

  if (telegram) {
    or.push(
      { telegramKey: { startsWith: telegram, mode: "insensitive" } },
      { telegram: { startsWith: telegram, mode: "insensitive" } },
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

/**
 * Complete database predicate shared by the paginated list and full export.
 * Any filter added to the registry must pass through this helper so exporting
 * can never return rows that are absent from the on-screen result set.
 */
export async function buildStudentRegistryWhere(
  searchParams: URLSearchParams,
): Promise<Prisma.StudentWhereInput> {
  const and: Prisma.StudentWhereInput[] = [];
  const status = normalizeListFilter(searchParams.get("status"));
  const includeArchived = searchParams.get("includeArchived") === "1";
  const gender = normalizeListFilter(searchParams.get("gender"));
  const courseId = normalizeListFilter(searchParams.get("courseId"));
  const courseIds = String(searchParams.get("courseIds") || "")
    .split(",")
    .map((value) => normalizeListFilter(value))
    .filter(Boolean);
  const courseProgram = normalizeListFilter(searchParams.get("courseProgram"));
  const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
  const studyType = normalizeListFilter(searchParams.get("studyType"));
  const location = normalizeListFilter(
    searchParams.get("location") || searchParams.get("locationScope"),
  );
  const opportunityStatus = normalizeListFilter(
    searchParams.get("opportunityStatus"),
  );
  const opportunityCount = normalizeListFilter(
    searchParams.get("opportunityCount"),
  );

  // Generic student reads keep their safe visible-only default. The registry
  // explicitly opts into all statuses because its UI label is "كل الحالات".
  if (status) and.push({ status });
  else if (!includeArchived) {
    and.push({ status: { not: STUDENT_STATUS_ARCHIVED } });
  }
  if (gender) and.push({ gender });
  if (courseId) and.push({ courseId });
  if (courseIds.length > 0) and.push({ courseId: { in: courseIds } });
  if (courseProgram) and.push({ courseProgram });
  if (courseProgram === "كورسات" && courseTerm) and.push({ courseTerm });
  if (studyType) and.push({ studyType });

  const locationWhere = buildStudentRegistryLocationWhere(location);
  if (locationWhere) and.push(locationWhere);

  if (opportunityStatus === "active") and.push({ status: "نشط" });
  else if (opportunityStatus === "dismissed") and.push({ status: "مفصول" });
  else if (opportunityStatus === "has-opportunities")
    and.push({ status: "نشط", opportunities: { gt: 0 } });
  else if (opportunityStatus === "no-opportunities")
    and.push({ status: "نشط", opportunities: 0 });

  if (opportunityCount !== "") {
    const count = Number(opportunityCount);
    if (Number.isFinite(count) && count >= 0) {
      and.push({ opportunities: Math.trunc(count) });
    }
  }

  const searchWhere = buildStudentRegistrySearchWhere(
    String(searchParams.get("q") || ""),
  );
  if (searchWhere) and.push(searchWhere);

  const registryIssueWhere = await buildStudentRegistryIssueWhere(searchParams);
  if (registryIssueWhere) and.push(registryIssueWhere);

  if (and.length === 0) return {};
  return and.length === 1 ? and[0] : { AND: and };
}
