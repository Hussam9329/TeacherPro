import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { STUDENT_STATUS_ARCHIVED } from "@/lib/student-scope";

/**
 * An archived student is frozen: no grade, leave, call, note, opportunity or
 * profile change of any kind. The one way out is the explicit «استعادة من
 * الأرشيف» action. Every write path asks here before touching a student.
 */
export const ARCHIVED_STUDENT_LOCKED_MESSAGE =
  "الطالب مؤرشف: لا تُنفَّذ عليه أي عملية. استعده من «استعادة من الأرشيف» أولاً.";
export const ARCHIVED_STUDENT_LOCKED_CODE = "ARCHIVED_STUDENT_LOCKED";

export class ArchivedStudentError extends Error {
  readonly statusCode = 409;
  readonly code = ARCHIVED_STUDENT_LOCKED_CODE;
  constructor() {
    super(ARCHIVED_STUDENT_LOCKED_MESSAGE);
    this.name = "ArchivedStudentError";
  }
}

type StudentCounter = {
  student: { count: (args: { where: Prisma.StudentWhereInput }) => Promise<number> };
};

/** Throws ArchivedStudentError when any of the given students is archived. */
export async function assertStudentsNotArchived(
  client: StudentCounter,
  studentIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = Array.from(new Set(studentIds.map((id) => String(id || "")).filter(Boolean)));
  if (!ids.length) return;
  const archived = await client.student.count({ where: { id: { in: ids }, status: STUDENT_STATUS_ARCHIVED } });
  if (archived > 0) throw new ArchivedStudentError();
}

export function isArchivedStudentError(error: unknown): error is ArchivedStudentError {
  return error instanceof ArchivedStudentError ||
    (error as { code?: unknown } | null)?.code === ARCHIVED_STUDENT_LOCKED_CODE;
}

export function archivedStudentLockedResponse(): NextResponse {
  return NextResponse.json(
    { error: ARCHIVED_STUDENT_LOCKED_MESSAGE, code: ARCHIVED_STUDENT_LOCKED_CODE },
    { status: 409, headers: { "X-TeacherPro-Retryable": "0" } },
  );
}
