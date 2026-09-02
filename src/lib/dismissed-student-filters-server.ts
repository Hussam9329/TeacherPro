import type { Prisma } from "@prisma/client";

export const DISMISSED_STUDENT_STATUS = "مفصول";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function dismissedHistoryWhere(): Prisma.StudentWhereInput {
  return {
    OR: [
      {
        opportunityLogs: {
          some: {
            OR: [
              { action: "فصل تلقائي" },
              { action: "خصم", reason: { startsWith: "فصل الطالب" } },
            ],
          },
        },
      },
      {
        studentNotes: {
          some: {
            kind: "إجراء",
            OR: [
              { text: { startsWith: "فصل الطالب" } },
              { text: { startsWith: "تم فصل الطالب" } },
            ],
          },
        },
      },
    ],
  };
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

export function buildDismissedHistoryScopeWhere(
  rawScope: string | null | undefined,
): Prisma.StudentWhereInput {
  const scope = cleanText(rawScope);
  if (scope === "former") {
    return composeDismissedStudentWhere([
      { status: "نشط" },
      dismissedHistoryWhere(),
    ]);
  }
  if (scope === "all") {
    return {
      OR: [
        { status: DISMISSED_STUDENT_STATUS },
        composeDismissedStudentWhere([
          { status: "نشط" },
          dismissedHistoryWhere(),
        ]),
      ],
    };
  }
  return { status: DISMISSED_STUDENT_STATUS };
}

/**
 * Authoritative filter shared by dismissed-student lists and counters.
 * `historyScope=all` is used by إدارة المفصولين to include active students
 * who have a real dismissal event in their history. The historical marker is
 * informational only and never participates in academic calculations.
 */
export function buildDismissedStudentWhere(
  searchParams: URLSearchParams,
): Prisma.StudentWhereInput {
  const parts: Prisma.StudentWhereInput[] = [
    buildDismissedHistoryScopeWhere(searchParams.get("historyScope")),
  ];
  const searchWhere = buildSearchWhere(searchParams.get("q") || "");
  const courseId = cleanText(searchParams.get("courseId"));
  const notesFilter = cleanText(searchParams.get("notesFilter"));

  if (searchWhere) parts.push(searchWhere);
  if (courseId) parts.push({ courseId });

  if (notesFilter === "with-notes") {
    parts.push({ dismissalNotes: { not: "" } });
  } else if (notesFilter === "without-notes") {
    parts.push({ OR: [{ dismissalNotes: null }, { dismissalNotes: "" }] });
  }

  return composeDismissedStudentWhere(parts);
}
