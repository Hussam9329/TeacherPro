import { db } from "../src/lib/db";
import { withSerializableTransaction } from "../src/lib/serializable-transaction";
import { recalculateStudentsAcademicState } from "../src/lib/academic-recalculate-server";
import { removeProtectedAbsencesForStudents } from "../src/lib/grace-period-repair-server";

const BATCH_SIZE = 100;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function main() {
  const studentsWithAbsences = await db.grade.findMany({
    where: { status: "غائب" },
    distinct: ["studentId"],
    select: { studentId: true },
  });
  const studentIds: string[] = (
    studentsWithAbsences as Array<{ studentId: unknown }>
  ).map((row) => String(row.studentId));
  if (studentIds.length === 0) {
    console.log("[Grace Repair] No absence records found.");
    return;
  }

  let deletedGrades = 0;
  let deletedCalls = 0;
  let recalculatedStudents = 0;

  for (const batch of chunks(studentIds, BATCH_SIZE)) {
    const result = await withSerializableTransaction(async (tx) => {
      const repair = await removeProtectedAbsencesForStudents(tx, batch);
      if (repair.studentIds.length === 0) {
        return { grades: 0, calls: 0, students: 0 };
      }
      const recalculation = await recalculateStudentsAcademicState(
        repair.studentIds,
        { tx },
      );
      return {
        grades: repair.deletedGrades,
        calls: repair.deletedCalls,
        students: recalculation.studentIds.length,
      };
    });
    deletedGrades += result.grades;
    deletedCalls += result.calls;
    recalculatedStudents += result.students;
  }

  console.log(
    `[Grace Repair] Removed ${deletedGrades} invalid absences, removed ${deletedCalls} related call records, and recalculated ${recalculatedStudents} students.`,
  );
}

main()
  .catch((error) => {
    console.error("[Grace Repair] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
