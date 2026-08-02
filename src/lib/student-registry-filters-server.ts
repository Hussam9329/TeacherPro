import type { Prisma } from "@prisma/client";
import { sanitizePhoneInput } from "@/lib/format";
import { normalizeArabicText } from "@/lib/route-helpers";
import { sanitizeTelegramInput } from "@/lib/student-utils";
import { getStudentFilterLocationAliases } from "@/lib/student-list-filters";

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
