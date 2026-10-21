/**
 * «إحصائيات المكالمات»: the calls of the cumulative and final exams only —
 * a daily exam never shows here. Pure: built from the «المكالمات» log lines
 * (every status a caller sets writes one), the students' courses, the exam
 * types and each course's exam with its required number.
 *
 * Employees: one Baghdad day. An action is one call (student + exam) an
 * employee left with a status that day: changing the status again on the
 * same call is still one action, and a status cleared by the end of the day
 * is none. Two employees on the same call are two actions.
 *
 * Courses: each against its latest cumulative exam on the day. The required
 * number is one number for that exam (its «المخصومين»), and the work done is
 * every student of the course whose call on that exam has a status at the end
 * of the day, whoever set it and on whichever day — each student once.
 */

export const CALL_ACTION_LOG_MODULE = "المكالمات";
export const CALL_ACTION_SET = "تحديث حالة مكالمة";
export const CALL_ACTION_CLEARED = "مسح حالة مكالمة";
export const NO_COURSE_ID = "";

/** The exams «إحصائيات المكالمات» counts: never a daily one. */
export const CALL_STATS_EXAM_TYPES = ["تراكمي", "فاينل"] as const;
export function isCallStatsExamType(type: string | null | undefined): boolean {
  return (CALL_STATS_EXAM_TYPES as readonly string[]).includes(String(type || "").trim());
}

export type CallActionLogLine = {
  time: Date | string;
  action: string;
  details: string | null;
  userId: string | null;
  userName: string | null;
};

/** A course's exam on the day, with its numbers (null: not known). */
export type CallCourseExam = {
  examId: string;
  examName: string;
  /** The required number: the exam's «المخصومين», one number for the exam. */
  target: number | null;
  /** «المخصومين» and «الدرجات الكاملة» of the exam as the calls list shows them now. */
  discounted: number | null;
  full: number | null;
};

export type CallDailyCourse = {
  id: string;
  name: string;
  examId: string;
  /** The cumulative exam the numbers are for. */
  examName: string;
  target: number | null;
  discounted: number | null;
  full: number | null;
  /** Students of the course whose call on the exam has a status by the end of the day. */
  done: number;
  /** Of them, the ones acted on during the day. */
  doneToday: number;
  remaining: number;
  rate: number | null;
};
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
  totals: {
    target: number;
    done: number;
    doneToday: number;
    remaining: number;
    rate: number | null;
    discounted: number;
    full: number;
    /** Every employee's actions of the day. */
    actions: number;
  };
};

type CallFacts = { studentId: string; examId: string; status: string };

function parseDetails(details: string | null): CallFacts | null {
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

/** The student ids a set of log lines is about (for loading their courses). */
export function callLogStudentIds(lines: CallActionLogLine[]): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    const facts = parseDetails(line.details);
    if (facts) ids.add(facts.studentId);
  }
  return [...ids];
}

/** The exam ids a set of log lines is about (for loading their types). */
export function callLogExamIds(lines: CallActionLogLine[]): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    const facts = parseDetails(line.details);
    if (facts?.examId) ids.add(facts.examId);
  }
  return [...ids];
}

const timeOf = (line: CallActionLogLine) => new Date(line.time).getTime();
const rateOf = (done: number, target: number | null) => (target && target > 0 ? done / target : null);

export function buildCallDailyStats(input: {
  /** Every call log line up to the end of the day (older ones count for the courses). */
  lines: CallActionLogLine[];
  /** The Baghdad day: the employees' actions are the lines inside it. */
  day: { from: Date; to: Date };
  /** examId → type, for every exam the lines name. */
  examTypes: Map<string, string>;
  /** studentId → courseId now */
  studentCourse: Map<string, string>;
  /** studentId → the moves to another course, oldest first: a call before a move belongs to the course left. */
  courseMoves?: Map<string, Array<{ at: Date | string; fromCourseId: string }>>;
  /** Every course to list (active ones), with its name. */
  courses: Array<{ id: string; name: string }>;
  /** Extra names for courses that are no longer listed (archived). */
  courseNames?: Map<string, string>;
  /** courseId → its latest cumulative exam on the day, with the numbers. */
  courseExams: Map<string, CallCourseExam>;
}): CallDailyStats {
  // The course a student was in at a moment: the first move after it says
  // which course they left; with none they are still in their course now.
  const courseAt = (studentId: string, time: number) =>
    input.courseMoves?.get(studentId)?.find((move) => new Date(move.at).getTime() > time)?.fromCourseId
    ?? input.studentCourse.get(studentId)
    ?? NO_COURSE_ID;
  const from = input.day.from.getTime();
  const to = input.day.to.getTime();
  const counted = (examId: string) => isCallStatsExamType(input.examTypes.get(examId));
  const ordered = input.lines
    .filter((line) => (line.action === CALL_ACTION_SET || line.action === CALL_ACTION_CLEARED) && timeOf(line) < to)
    .sort((a, b) => timeOf(a) - timeOf(b));

  // Employees: the last status each one left on each call during the day.
  const last = new Map<string, { actor: string; name: string; courseId: string; status: string }>();
  // Courses: the status of each call at the end of the day, and whether it was touched that day.
  const callState = new Map<string, { status: string; today: boolean; courseId: string }>();
  for (const line of ordered) {
    const facts = parseDetails(line.details);
    if (!facts || !counted(facts.examId)) continue;
    const status = line.action === CALL_ACTION_CLEARED ? "" : facts.status;
    const inDay = timeOf(line) >= from;
    const courseId = courseAt(facts.studentId, timeOf(line));
    const callKey = `${facts.studentId}|${facts.examId}`;
    callState.set(callKey, { status, today: Boolean(callState.get(callKey)?.today) || inDay, courseId });
    if (!inDay) continue;
    const actor = line.userId ? `id:${line.userId}` : `name:${String(line.userName || "").trim()}`;
    last.set(`${actor}|${callKey}`, {
      actor,
      name: String(line.userName || "").trim() || "مستخدم",
      courseId,
      status,
    });
  }

  const names = new Map<string, string>(input.courseNames || []);
  for (const course of input.courses) names.set(course.id, course.name);
  const courseName = (id: string) => names.get(id) || (id ? "دورة محذوفة" : "بدون دورة");

  const employees = new Map<string, { name: string; total: number; courses: Map<string, number>; statuses: Map<string, number> }>();
  let actions = 0;
  for (const item of last.values()) {
    if (!item.status) continue;
    const employee = employees.get(item.actor) || { name: item.name, total: 0, courses: new Map(), statuses: new Map() };
    employee.name = item.name;
    employee.total += 1;
    employee.courses.set(item.courseId, (employee.courses.get(item.courseId) || 0) + 1);
    employee.statuses.set(item.status, (employee.statuses.get(item.status) || 0) + 1);
    employees.set(item.actor, employee);
    actions += 1;
  }

  // Each course's exam: its students whose call has a status at the end of the day.
  const doneByCourse = new Map<string, { done: number; today: number }>();
  for (const [key, state] of callState) {
    if (!state.status) continue;
    const examId = key.slice(key.indexOf("|") + 1);
    const courseId = state.courseId;
    if (input.courseExams.get(courseId)?.examId !== examId) continue;
    const sum = doneByCourse.get(courseId) || { done: 0, today: 0 };
    sum.done += 1;
    if (state.today) sum.today += 1;
    doneByCourse.set(courseId, sum);
  }

  // Every listed course, then any other course that has an exam to show.
  const courseIds = input.courses.map((course) => course.id);
  for (const id of input.courseExams.keys()) {
    if (!courseIds.includes(id)) courseIds.push(id);
  }
  const courses: CallDailyCourse[] = courseIds.map((id) => {
    const exam = input.courseExams.get(id);
    const target = exam?.target ?? null;
    const progress = doneByCourse.get(id) || { done: 0, today: 0 };
    return {
      id,
      name: courseName(id),
      examId: exam?.examId || "",
      examName: exam?.examName || "",
      target,
      discounted: exam?.discounted ?? null,
      full: exam?.full ?? null,
      done: progress.done,
      doneToday: progress.today,
      remaining: target === null ? 0 : Math.max(0, target - progress.done),
      rate: rateOf(progress.done, target),
    };
  });

  const sum = (pick: (course: CallDailyCourse) => number | null) => courses.reduce((total, course) => total + (pick(course) || 0), 0);
  const target = sum((course) => course.target);
  const done = sum((course) => course.done);
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
    totals: {
      target,
      done,
      doneToday: sum((course) => course.doneToday),
      remaining: sum((course) => course.remaining),
      // The same numbers as «المتبقي»: a course over its number adds only its number.
      rate: rateOf(target - sum((course) => course.remaining), target || null),
      discounted: sum((course) => course.discounted),
      full: sum((course) => course.full),
      actions,
    },
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

/**
 * «العدد المطلوب» follows the groups chosen above the table: «المخصومين»
 * (the kept number of the course's latest exam), «الدرجات الكاملة», or both
 * added together. With neither chosen it stays the discounted number. The
 * remaining count and the rate follow, per course and in the totals (a course
 * over its number adds only its number, as before).
 */
export function withChosenGroups(stats: CallDailyStats, chosen: { discounted: boolean; full: boolean }): CallDailyStats {
  const pickTarget = (course: CallDailyCourse): number | null => {
    if (!chosen.discounted && !chosen.full) return course.target;
    const parts = [chosen.discounted ? course.target : null, chosen.full ? course.full : null].filter(
      (value): value is number => typeof value === "number",
    );
    return parts.length ? parts.reduce((total, value) => total + value, 0) : null;
  };
  const courses = stats.courses.map((course) => {
    const target = pickTarget(course);
    return {
      ...course,
      target,
      remaining: target === null ? 0 : Math.max(0, target - course.done),
      rate: rateOf(course.done, target),
    };
  });
  const sum = (pick: (course: CallDailyCourse) => number | null) => courses.reduce((total, course) => total + (pick(course) || 0), 0);
  const target = sum((course) => course.target);
  const remaining = sum((course) => course.remaining);
  return {
    ...stats,
    courses,
    totals: { ...stats.totals, target, remaining, rate: rateOf(target - remaining, target || null) },
  };
}

