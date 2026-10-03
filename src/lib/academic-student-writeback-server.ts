import { Prisma } from "@prisma/client";
import type { AcademicStudent } from "@/lib/academic-types";

type AcademicStudentResult = Pick<
  AcademicStudent,
  "id" | "status" | "opportunities" | "dismissalReason"
> & Partial<Pick<AcademicStudent, "bonusProgress" | "bonusWaitingExamName">>;

/**
 * Persist the engine's final student fields inside the caller's transaction.
 * Student has no Prisma @updatedAt field. The status trigger retires the
 * previous dismissal checkbox; other manual fields and timestamps remain
 * untouched, as with student.update.
 */
export async function persistAcademicStudentResults(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  students: readonly AcademicStudentResult[],
): Promise<number> {
  // The engine normally returns each student once. Keep the same final value
  // as sequential updates if a caller supplies an ID more than once.
  const uniqueStudents = [...new Map(students.map((student) => [student.id, student])).values()];
  let updatedStudents = 0;

  for (let offset = 0; offset < uniqueStudents.length; offset += 500) {
    const group = uniqueStudents.slice(offset, offset + 500);
    // A student the engine did not replay (no unique active chapter) keeps
    // its stored «فرصة مكافأة» progress: NULL means "unchanged".
    const values = group.map((student) => {
      const replayed = student.bonusProgress !== undefined;
      const progress = replayed ? Math.max(0, Math.min(2, Math.trunc(Number(student.bonusProgress) || 0))) : null;
      const waiting = replayed ? (progress === 2 ? student.bonusWaitingExamName || null : null) : null;
      return Prisma.sql`(
      ${student.id}::text,
      ${student.status}::text,
      ${Math.max(0, Math.trunc(Number(student.opportunities || 0)))}::integer,
      ${student.dismissalReason || null}::text,
      ${progress}::integer,
      ${replayed}::boolean,
      ${waiting}::text
    )`;
    });
    const [counts] = await client.$queryRaw<Array<{ matched: number; updated: number }>>(Prisma.sql`
      WITH input(id, status, opportunities, "dismissalReason", "bonusProgress", replayed, "bonusWaitingExamName") AS (
        VALUES ${Prisma.join(values)}
      ), target AS (
        SELECT input.id, input.status, input.opportunities, input."dismissalReason",
          CASE WHEN input.replayed THEN input."bonusProgress" ELSE student."bonusProgress" END AS "bonusProgress",
          CASE WHEN input.replayed THEN input."bonusWaitingExamName" ELSE student."bonusWaitingExamName" END AS "bonusWaitingExamName"
        FROM input JOIN "Student" AS student USING (id)
      ), updated AS (
        UPDATE "Student" AS student
        SET status = target.status,
            opportunities = target.opportunities,
            "dismissalReason" = target."dismissalReason",
            "bonusProgress" = target."bonusProgress",
            "bonusWaitingExamName" = target."bonusWaitingExamName"
        FROM target
        WHERE student.id = target.id
          AND ROW(student.status, student.opportunities, student."dismissalReason", student."bonusProgress", student."bonusWaitingExamName")
            IS DISTINCT FROM ROW(target.status, target.opportunities, target."dismissalReason", target."bonusProgress", target."bonusWaitingExamName")
        RETURNING student.id
      )
      SELECT
        (SELECT COUNT(*)::integer FROM "Student" JOIN input USING (id)) AS matched,
        (SELECT COUNT(*)::integer FROM updated) AS updated
    `);
    if (!counts || counts.matched !== group.length) {
      // A disappearing student must abort the caller's whole transaction,
      // just as an individual Prisma update would fail with a missing row.
      throw new Error("تعذر تثبيت نتيجة الاحتساب: تغيرت قائمة الطلاب أثناء الحفظ.");
    }
    updatedStudents += counts.updated;
  }

  return updatedStudents;
}
