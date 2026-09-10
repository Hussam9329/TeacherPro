import { Prisma } from "@prisma/client";
import type { AcademicStudent } from "@/lib/academic-types";

type AcademicStudentResult = Pick<
  AcademicStudent,
  "id" | "status" | "opportunities" | "dismissalReason"
>;

/**
 * Persist the engine's final student fields inside the caller's transaction.
 * Student has no Prisma @updatedAt field. All other student fields and
 * database timestamps therefore remain untouched, as with student.update.
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
    const values = group.map((student) => Prisma.sql`(
      ${student.id}::text,
      ${student.status}::text,
      ${Math.max(0, Math.trunc(Number(student.opportunities || 0)))}::integer,
      ${student.dismissalReason || null}::text
    )`);
    const [counts] = await client.$queryRaw<Array<{ matched: number; updated: number }>>(Prisma.sql`
      WITH input(id, status, opportunities, "dismissalReason") AS (
        VALUES ${Prisma.join(values)}
      ), updated AS (
        UPDATE "Student" AS student
        SET status = input.status,
            opportunities = input.opportunities,
            "dismissalReason" = input."dismissalReason"
        FROM input
        WHERE student.id = input.id
          AND ROW(student.status, student.opportunities, student."dismissalReason")
            IS DISTINCT FROM ROW(input.status, input.opportunities, input."dismissalReason")
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
