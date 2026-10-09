import type { Prisma } from "@prisma/client";
import { baghdadDateKey } from "@/lib/baghdad-time";
import {
  formatGraceDays,
  formatGracePeriod,
  gracePeriodEndFromDays,
  NEW_STUDENT_GRACE_DAYS,
  NEW_STUDENT_GRACE_NOTE,
} from "@/lib/grace-periods";
import { graceDateColumn } from "@/lib/grace-periods-server";

/**
 * Every student newly added to TeacherPro gets a grace period of
 * NEW_STUDENT_GRACE_DAYS days from their registration day (Baghdad), so they
 * are not held to exams while still new. It is an ordinary grace period
 * (source «manual», as the database allows), marked by its note:
 * «إدارة فترة السماح» shows it and can edit or cancel it.
 */

/** The automatic period for a registration date: its Baghdad day and the next two. */
export function newStudentGraceRange(registeredAt: Date | string): { startDate: string; endDate: string } | null {
  const startDate = baghdadDateKey(registeredAt);
  const endDate = gracePeriodEndFromDays(startDate, NEW_STUDENT_GRACE_DAYS);
  return startDate && endDate ? { startDate, endDate } : null;
}

type NewStudent = { id: string; name: string; code: string; createdAt: Date; status: string };

/**
 * Adds the automatic grace period to students just created in this
 * transaction (active students only), with one «فترات السماح» log line each.
 * Returns how many periods were added.
 */
export async function addNewStudentGracePeriods(
  tx: Prisma.TransactionClient,
  students: readonly NewStudent[],
  actor: { id: string | null; name: string },
): Promise<number> {
  let added = 0;
  const logEach = students.length === 1;
  const ranges: string[] = [];
  for (const student of students) {
    if (student.status !== "نشط") continue;
    const range = newStudentGraceRange(student.createdAt);
    if (!range) continue;
    await tx.gracePeriod.create({
      data: {
        studentId: student.id,
        startDate: graceDateColumn(range.startDate),
        endDate: graceDateColumn(range.endDate),
        source: "manual",
        note: NEW_STUDENT_GRACE_NOTE,
        createdById: actor.id,
        createdByName: actor.name,
        updatedById: actor.id,
        updatedByName: actor.name,
      },
    });
    if (logEach) {
      await tx.auditLog.create({
        data: {
          module: "فترات السماح",
          action: "إضافة فترة سماح",
          details: `${student.name} - ${student.code} - ${formatGracePeriod(range)} (${formatGraceDays(NEW_STUDENT_GRACE_DAYS)}) - تلقائية للطالب الجديد من تاريخ تسجيله`,
          userId: actor.id,
          userName: actor.name,
        },
      });
    } else if (ranges.length < 20) {
      ranges.push(`${student.code}: ${formatGracePeriod(range)}`);
    }
    added += 1;
  }
  // A bulk import gets one line for all its new students.
  if (!logEach && added > 0) {
    await tx.auditLog.create({
      data: {
        module: "فترات السماح",
        action: "إضافة فترة سماح",
        details: `فترة سماح تلقائية (${formatGraceDays(NEW_STUDENT_GRACE_DAYS)} من تاريخ التسجيل) لـ ${added} طالب جديد من الإضافة الجماعية - ${ranges.join("، ")}${added > ranges.length ? " …" : ""}`,
        userId: actor.id,
        userName: actor.name,
      },
    });
  }
  return added;
}
