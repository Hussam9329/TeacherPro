import type { Prisma } from "@prisma/client";

export const STUDENT_STATUS_ACTIVE = "نشط";
export const STUDENT_STATUS_DISMISSED = "مفصول";
export const STUDENT_STATUS_ARCHIVED = "مؤرشف";

export type StudentOperationalScope = "visible" | "active" | "followup" | "archived" | "all";

export function isArchivedStudentStatus(status: unknown): boolean {
  return String(status || "") === STUDENT_STATUS_ARCHIVED;
}

export function isDismissedStudentStatus(status: unknown): boolean {
  return String(status || "") === STUDENT_STATUS_DISMISSED;
}

export function isActiveStudentStatus(status: unknown): boolean {
  return String(status || "") === STUDENT_STATUS_ACTIVE;
}

export function visibleStudentWhere(): Prisma.StudentWhereInput {
  return { status: { not: STUDENT_STATUS_ARCHIVED } };
}

export function activeStudentWhere(): Prisma.StudentWhereInput {
  return { status: STUDENT_STATUS_ACTIVE };
}

export function archivedStudentWhere(): Prisma.StudentWhereInput {
  return { status: STUDENT_STATUS_ARCHIVED };
}

export function followupStudentWhere(): Prisma.StudentWhereInput {
  return { status: { notIn: [STUDENT_STATUS_DISMISSED, STUDENT_STATUS_ARCHIVED] } };
}

export function studentScopeWhere(scope: StudentOperationalScope = "visible"): Prisma.StudentWhereInput {
  if (scope === "all") return {};
  if (scope === "active") return activeStudentWhere();
  if (scope === "followup") return followupStudentWhere();
  if (scope === "archived") return archivedStudentWhere();
  return visibleStudentWhere();
}

export function mergeStudentWhere(
  ...parts: Array<Prisma.StudentWhereInput | null | undefined | false>
): Prisma.StudentWhereInput {
  const and = parts.filter(Boolean) as Prisma.StudentWhereInput[];
  if (and.length === 0) return {};
  if (and.length === 1) return and[0];
  return { AND: and };
}

export function studentCourseScopeWhere(
  courseId: string,
  scope: StudentOperationalScope = "visible",
): Prisma.StudentWhereInput {
  return mergeStudentWhere({ courseId }, studentScopeWhere(scope));
}

export function studentIdsWhere(ids: string[]): Prisma.StudentWhereInput | null {
  const cleanIds = Array.from(new Set(ids.map(String).filter(Boolean)));
  return cleanIds.length ? { id: { in: cleanIds } } : null;
}
