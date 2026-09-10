import type { Prisma } from "@prisma/client";
import { baghdadTodayKey } from "./baghdad-time";
import { normalizeStudentName } from "./student-utils";

export function studentLeaveListWhere(params: URLSearchParams): Prisma.StudentLeaveWhereInput {
  const and: Prisma.StudentLeaveWhereInput[] = [];
  const studentId = params.get("studentId")?.trim();
  if (studentId) and.push({ studentId });
  const type = params.get("leaveType");
  if (type === "exam" || type === "period") and.push({ leaveType: type });
  const q = params.get("q")?.trim().slice(0, 200);
  if (q) and.push({ OR: [
    { student: { is: { OR: [
      { name: { contains: q, mode: "insensitive" } },
      { nameKey: { contains: normalizeStudentName(q), mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } }, { telegram: { contains: q, mode: "insensitive" } },
    ] } } },
    { exam: { is: { name: { contains: q, mode: "insensitive" } } } },
    ...(["reason", "notes", "studyType"] as const).map(field => ({ [field]: { contains: q, mode: "insensitive" as const } })),
  ] });
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
