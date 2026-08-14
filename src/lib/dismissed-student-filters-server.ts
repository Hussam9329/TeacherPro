import type { Prisma } from "@prisma/client";

export const DISMISSED_STUDENT_STATUS = "مفصول";
export const DISMISSED_STUDENT_PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function buildSearchWhere(rawQuery: string): Prisma.StudentWhereInput | null {
  const q = cleanText(rawQuery);
  if (!q) return null;
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { parentPhone: { contains: q, mode: "insensitive" } },
      { telegram: { contains: q, mode: "insensitive" } },
      { dismissalReason: { contains: q, mode: "insensitive" } },
      { dismissalNotes: { contains: q, mode: "insensitive" } },
    ],
  };
}

export function composeDismissedStudentWhere(
  parts: Prisma.StudentWhereInput[],
): Prisma.StudentWhereInput {
  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return {};
  if (filtered.length === 1) return filtered[0];
  return { AND: filtered };
}

/**
 * Authoritative filter shared by the dismissed-student list and counters.
 * Keeping every predicate on the server makes pagination correct even for
 * pledge and notes filters; no page is filtered again in the browser.
 */
export function buildDismissedStudentWhere(
  searchParams: URLSearchParams,
): Prisma.StudentWhereInput {
  const parts: Prisma.StudentWhereInput[] = [
    { status: DISMISSED_STUDENT_STATUS },
  ];
  const searchWhere = buildSearchWhere(searchParams.get("q") || "");
  const courseId = cleanText(searchParams.get("courseId"));
  const dismissalType = cleanText(searchParams.get("dismissalType"));
  const notesFilter = cleanText(searchParams.get("notesFilter"));
  const pledgeFilter = cleanText(searchParams.get("pledgeFilter"));

  if (searchWhere) parts.push(searchWhere);
  if (courseId) parts.push({ courseId });
  if (dismissalType) parts.push({ dismissalType });

  if (notesFilter === "with-notes") {
    parts.push({ dismissalNotes: { not: "" } });
  } else if (notesFilter === "without-notes") {
    parts.push({ OR: [{ dismissalNotes: null }, { dismissalNotes: "" }] });
  }

  if (pledgeFilter === "with-pledge") {
    parts.push({
      studentNotes: {
        some: { kind: DISMISSED_STUDENT_PLEDGE_NOTE_KIND },
      },
    });
  } else if (pledgeFilter === "without-pledge") {
    parts.push({
      studentNotes: {
        none: { kind: DISMISSED_STUDENT_PLEDGE_NOTE_KIND },
      },
    });
  }

  return composeDismissedStudentWhere(parts);
}
