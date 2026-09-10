import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";

const EXAM_MUTATION_FIELDS = [
  "id", "name", "type", "courseIds", "mainSite", "date", "fullMark",
  "passMark", "discountMark", "opportunitiesPenalty", "dismissalGrade",
  "noDiscount", "active", "scheduledActivateAt", "createdAt", "createdAtSource",
] as const;

/** GET/bootstrap include relations; scalar create/update reads do not. Hash
 * the same persisted Exam fields everywhere so fresh forms are not rejected.
 * Actual changes to any Exam field still invalidate the edit token. */
export function buildExamMutationToken(exam: Record<string, unknown>): string {
  return buildMutationPreviewToken(
    `exam-edit:${String(exam.id || "")}`,
    Object.fromEntries(EXAM_MUTATION_FIELDS.map(field => [field, exam[field]])),
  );
}
