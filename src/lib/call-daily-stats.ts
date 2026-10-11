/**
 * «إحصائيات المكالمات»: one Baghdad day of contact actions, counted per
 * employee and per course. Pure: built from the «المكالمات» log lines of
 * that day (every status a caller sets writes one), the students' courses
 * and the day's targets.
 *
 * An action is one call (student + exam) an employee left with a status that
 * day: changing the status again on the same call is still one action, and a
 * status cleared by the end of the day is none. Two employees on the same
 * call are two actions, so the courses add up to the employees.
 */

export const CALL_ACTION_LOG_MODULE = "المكالمات";
export const CALL_ACTION_SET = "تحديث حالة مكالمة";
export const CALL_ACTION_CLEARED = "مسح حالة مكالمة";
export const NO_COURSE_ID = "";

export type CallActionLogLine = {
  time: Date | string;
  action: string;
  details: string | null;
  userId: string | null;
  userName: string | null;
};

export type CallDailyCourse = { id: string; name: string; target: number | null; done: number; remaining: number; rate: number | null };
export type CallDailyEmployee = {
  key: string;
  name: string;
  total: number;
  courses: Array<{ id: string; name: string; count: number }>;
  statuses: Array<{ status: string; count: number }>;
};
export type CallDailyStats = {
  courses: CallDailyCourse[];
  employees: CallDailyEmployee[];
  totals: { target: number; done: number; remaining: number; rate: number | null };
};

function parseDetails(details: string | null): { studentId: string; examId: string; status: string } | null {
  if (!details) return null;
  try {
    const value = JSON.parse(details) as Record<string, unknown>;
    const studentId = String(value.studentId || "").trim();
    if (!studentId) return null;
    const status = String(value.status || "").trim();
    return { studentId, examId: String(value.examId || "").trim(), status: status === "بدون إجراء" ? "" : status };
  } catch {
    return null;
  }
}

const rateOf = (done: number, target: number | null) => (target && target > 0 ? done / target : null);

export function buildCallDailyStats(input: {
  lines: CallActionLogLine[];
  /** studentId → courseId */
  studentCourse: Map<string, string>;
  /** Every course to list (active ones), with its name. */
  courses: Array<{ id: string; name: string }>;
  /** Extra names for courses that are no longer listed (archived). */
  courseNames?: Map<string, string>;
  /** courseId → target for the day */
  targets: Map<string, number>;
}): CallDailyStats {
  // The last status each employee left on each call during the day.
  const last = new Map<string, { actor: string; name: string; courseId: string; status: string }>();
  const ordered = [...input.lines].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  for (const line of ordered) {
    if (line.action !== CALL_ACTION_SET && line.action !== CALL_ACTION_CLEARED) continue;
    const facts = parseDetails(line.details);
    if (!facts) continue;
    const actor = line.userId ? `id:${line.userId}` : `name:${String(line.userName || "").trim()}`;
    const name = String(line.userName || "").trim() || "مستخدم";
    last.set(`${actor}|${facts.studentId}|${facts.examId}`, {
      actor,
      name,
      courseId: input.studentCourse.get(facts.studentId) ?? NO_COURSE_ID,
      status: line.action === CALL_ACTION_CLEARED ? "" : facts.status,
    });
  }

  const names = new Map<string, string>(input.courseNames || []);
  for (const course of input.courses) names.set(course.id, course.name);
  const courseName = (id: string) => names.get(id) || (id ? "دورة محذوفة" : "بدون دورة");

  const employees = new Map<string, { name: string; total: number; courses: Map<string, number>; statuses: Map<string, number> }>();
  const doneByCourse = new Map<string, number>();
  for (const item of last.values()) {
    if (!item.status) continue;
    const employee = employees.get(item.actor) || { name: item.name, total: 0, courses: new Map(), statuses: new Map() };
    employee.name = item.name;
    employee.total += 1;
    employee.courses.set(item.courseId, (employee.courses.get(item.courseId) || 0) + 1);
    employee.statuses.set(item.status, (employee.statuses.get(item.status) || 0) + 1);
    employees.set(item.actor, employee);
    doneByCourse.set(item.courseId, (doneByCourse.get(item.courseId) || 0) + 1);
  }

  // Every listed course, then any other course that had work or a target.
  const courseIds = input.courses.map((course) => course.id);
  for (const id of [...doneByCourse.keys(), ...input.targets.keys()]) {
    if (!courseIds.includes(id)) courseIds.push(id);
  }
  const courses: CallDailyCourse[] = courseIds.map((id) => {
    const target = input.targets.has(id) ? input.targets.get(id)! : null;
    const done = doneByCourse.get(id) || 0;
    return { id, name: courseName(id), target, done, remaining: Math.max(0, (target || 0) - done), rate: rateOf(done, target) };
  });

  const target = courses.reduce((sum, course) => sum + (course.target || 0), 0);
  const done = courses.reduce((sum, course) => sum + course.done, 0);
  return {
    courses,
    employees: [...employees.entries()]
      .map(([key, employee]) => ({
        key,
        name: employee.name,
        total: employee.total,
        courses: [...employee.courses.entries()]
          .map(([id, count]) => ({ id, name: courseName(id), count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar")),
        statuses: [...employee.statuses.entries()]
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ar")),
    totals: { target, done, remaining: Math.max(0, target - done), rate: rateOf(done, target || null) },
  };
}

/** The UTC instants of a Baghdad day «YYYY-MM-DD» (Baghdad is UTC+3 all year). */
export function baghdadDayRange(day: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const from = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), -3, 0, 0, 0));
  if (!Number.isFinite(from.getTime())) return null;
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}
