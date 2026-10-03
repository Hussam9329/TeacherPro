import type { Prisma } from "@prisma/client";

export const STUDENT_STATUS_ACTIVE = "نشط";
export const STUDENT_STATUS_DISMISSED = "مفصول";
export const STUDENT_STATUS_ARCHIVED = "مؤرشف";

export type StudentOperationalScope = "visible" | "active" | "followup" | "archived" | "all";

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
  // المتابعة تشمل النشطين والمفصولين — المفصولين يحتاجون متابعة أيضاً
  // (مكالمات لولي الأمر وإدارة إعادة التفعيل). فقط المؤرشفون مستثنون.
  return { status: { notIn: [STUDENT_STATUS_ARCHIVED] } };
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
