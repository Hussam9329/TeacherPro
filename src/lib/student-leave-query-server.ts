import type { Prisma } from "@prisma/client";
import { baghdadTodayKey } from "./baghdad-time";
import { normalizeStudentName, normalizeTelegramIdentifier } from "./student-utils";
import { db } from "@/lib/db";

const SEARCH_ID_LIST_LIMIT = 5000;

/**
 * The leaves list search. Students and exams are matched once in their own
 * (small) tables and leaves are filtered by those ids, instead of joining the
 * student's name, code, phone and Telegram and the exam name on every leave
 * row of every query.
 */
export async function studentLeaveListWhere(params: URLSearchParams): Promise<Prisma.StudentLeaveWhereInput> {
  const and: Prisma.StudentLeaveWhereInput[] = [];
  const studentId = params.get("studentId")?.trim();
  if (studentId) and.push({ studentId });
  const type = params.get("leaveType");
  if (type === "exam" || type === "period") and.push({ leaveType: type });
  const q = params.get("q")?.trim().slice(0, 200);
  if (q) {
    const studentSearch: Prisma.StudentWhereInput[] = [
      { name: { contains: q, mode: "insensitive" } },
      { nameKey: { contains: normalizeStudentName(q), mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
    // Telegram is searched by the recovered username, not the numeric Telegram id.
    const username = normalizeTelegramIdentifier(q);
    if (username) studentSearch.push({ username: { contains: username, mode: "insensitive" } });
    const [students, exams] = await Promise.all([
      db.student.findMany({ where: { OR: studentSearch }, select: { id: true }, take: SEARCH_ID_LIST_LIMIT + 1 }),
      db.exam.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { id: true } }),
    ]);
    const or: Prisma.StudentLeaveWhereInput[] = (["reason", "notes", "studyType"] as const)
      .map(field => ({ [field]: { contains: q, mode: "insensitive" as const } }));
    if (students.length > SEARCH_ID_LIST_LIMIT) or.push({ student: { is: { OR: studentSearch } } });
    else if (students.length) or.push({ studentId: { in: students.map((student) => student.id) } });
    if (exams.length) or.push({ examId: { in: exams.map((exam) => exam.id) } });
    and.push({ OR: or });
  }
  const date = params.get("date") === "today" ? baghdadTodayKey() : params.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const start = new Date(`${date}T00:00:00.000Z`);
    if (Number.isFinite(start.getTime())) {
      const end = new Date(start.getTime() + 86400000);
      and.push({ OR: [
        { leaveType: "exam", date: { gte: start, lt: end } },
        { leaveType: "period", AND: [
          { OR: [{ dateFrom: { lt: end } }, { dateFrom: null, date: { lt: end } }] },
          { OR: [{ dateTo: { gte: start } }, { dateTo: null, dateFrom: { gte: start } }, { dateTo: null, dateFrom: null, date: { gte: start } }] },
        ] },
      ] });
    }
  }
  return and.length ? { AND: and } : {};
}
