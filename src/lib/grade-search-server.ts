import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeArabicText } from "@/lib/route-helpers";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";

// Up to this many matching students the search is an id list; a broader
// match (a single common letter) keeps the relation filter to stay within the
// database's parameter limit.
const SEARCH_ID_LIST_LIMIT = 5000;

/**
 * The search box. It is matched once against the students and exams tables
 * (small) and the grades are then filtered by those ids through their indexes.
 * Matching the student's name, code, phones and Telegram through a join on
 * every grade row, in each of the five queries of a grade-records page, made
 * every keystroke wait seconds.
 */
export async function buildGradeSearchWhere(
  rawQuery: string,
): Promise<Prisma.GradeWhereInput | null> {
  const query = rawQuery.trim();
  if (!query) return null;

  const normalizedQuery = normalizeArabicText(query);
  const compactQuery = query.replace(/\s+/g, "");
  // Telegram is searched by the recovered username, not the numeric Telegram id.
  const username = normalizeTelegramIdentifier(query);

  const studentSearch: Prisma.StudentWhereInput[] = [
    { name: { contains: query, mode: "insensitive" } },
    { code: { startsWith: query, mode: "insensitive" } },
    { phone: { startsWith: compactQuery, mode: "insensitive" } },
    { parentPhone: { startsWith: compactQuery, mode: "insensitive" } },
  ];
  if (username) {
    studentSearch.push({ username: { contains: username, mode: "insensitive" } });
  }

  if (normalizedQuery) {
    studentSearch.push({
      nameKey: { contains: normalizedQuery, mode: "insensitive" },
    });
  }
  if (compactQuery.length >= 7) {
    studentSearch.push(
      { phone: { contains: compactQuery, mode: "insensitive" } },
      { parentPhone: { contains: compactQuery, mode: "insensitive" } },
    );
  }

  const [students, exams] = await Promise.all([
    db.student.findMany({
      where: { OR: studentSearch },
      select: { id: true },
      take: SEARCH_ID_LIST_LIMIT + 1,
    }),
    db.exam.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true },
    }),
  ]);
  const studentClause: Prisma.GradeWhereInput =
    students.length > SEARCH_ID_LIST_LIMIT
      ? { student: { is: { OR: studentSearch } } }
      : { studentId: { in: students.map((student) => student.id) } };

  const or: Prisma.GradeWhereInput[] = [
    { notes: { contains: query, mode: "insensitive" } },
  ];
  if (students.length > 0) or.push(studentClause);
  if (exams.length > 0) or.push({ examId: { in: exams.map((exam) => exam.id) } });
  return { OR: or };
}
