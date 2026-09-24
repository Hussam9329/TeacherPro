import type { Prisma } from "@prisma/client";
import {
  normalizeStudentGraceHistory,
  parseGraceDateOnly,
  preserveStudentGraceHistory,
  type StudentGraceHistoryEntry,
  type StudentGraceLike,
} from "@/lib/student-grace";

type GraceHistoryClient = Pick<Prisma.TransactionClient, "grade" | "studentLeaveGradeBackup">;

/**
 * Capture only known entitlement before an academic edit. Legacy grace
 * markers can outlive their erased window, including beneath an active leave.
 * Their evidence protects that exact exam on that exact day, never an inferred
 * surrounding interval or another exam sharing the day. This function only
 * reads; the caller persists its result in the same write transaction.
 */
export async function captureStudentGraceHistory(
  client: GraceHistoryClient,
  student: StudentGraceLike & { id: string },
  options: Parameters<typeof preserveStudentGraceHistory>[1] = {},
): Promise<StudentGraceHistoryEntry[]> {
  if (!student.id) throw new Error("Student ID is required to capture grace history.");
  const now = options.now || new Date();
  const today = parseGraceDateOnly(now);
  if (!today) throw new Error("Invalid grace history capture date.");
  const history = preserveStudentGraceHistory(student, { ...options, now });
  const where = { studentId: student.id, status: "ضمن فترة السماح", score: null };
  const select = { exam: { select: { id: true, date: true } } } as const;
  const [markers, backups] = await Promise.all([
    client.grade.findMany({ where, select }),
    client.studentLeaveGradeBackup.findMany({ where, select }),
  ]);

  for (const { exam } of [...markers, ...backups]) {
    if (!exam?.id || exam.id === options.excludeExamId) continue;
    const day = parseGraceDateOnly(exam.date);
    if (!day || day > today) continue;
    const endExclusive = new Date(day);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    history.push({
      start: day.toISOString().slice(0, 10),
      endExclusive: endExclusive.toISOString().slice(0, 10),
      excludedExamIds: [],
      examIds: [exam.id],
    });
  }
  return normalizeStudentGraceHistory(history);
}
