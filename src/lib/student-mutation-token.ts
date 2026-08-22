import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";

const STUDENT_MUTATION_TOKEN_FIELDS = [
  "id",
  "name",
  "nameKey",
  "school",
  "gender",
  "phone",
  "phoneKey",
  "parentPhone",
  "telegram",
  "telegramKey",
  "courseProgram",
  "courseTerm",
  "studyType",
  "locationScope",
  "baghdadMode",
  "mainSite",
  "subSite",
  "code",
  "status",
  "dismissalType",
  "dismissalReason",
  "dismissalNotes",
  "createdAt",
  "opportunities",
  "baseOpportunities",
  "accountingGraceDays",
  "gracePeriodStartDate",
  "gracePeriodEndedAt",
  "courseId",
] as const;

export function buildStudentMutationToken(
  student: Record<string, unknown>,
): string {
  return buildMutationPreviewToken(
    `student-edit:${String(student.id || "")}`,
    Object.fromEntries(
      STUDENT_MUTATION_TOKEN_FIELDS.map((field) => [field, student[field]]),
    ),
  );
}

export function withStudentMutationToken<T extends Record<string, unknown>>(
  student: T,
): T & { mutationToken: string } {
  return { ...student, mutationToken: buildStudentMutationToken(student) };
}
