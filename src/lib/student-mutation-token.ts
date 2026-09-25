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
  "dismissalReason",
  "dismissalNotes",
  "createdAt",
  "opportunities",
  "baseOpportunities",
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
  sourceStudent: Record<string, unknown> = student,
): T & { mutationToken: string } {
  // Display snapshots may normalize legacy balances. The concurrency guard
  // must fingerprint the stored row that PUT will compare, not its presentation.
  return { ...student, mutationToken: buildStudentMutationToken(sourceStudent) };
}
