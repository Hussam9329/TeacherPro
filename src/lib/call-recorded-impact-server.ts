import { annotateGradeRecordedImpacts } from "@/lib/grade-recorded-impact-server";
import { annotateGradeSettlementEffects } from "@/lib/grade-settlement-server";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import type { ReportGradePresentation } from "@/lib/student-report-presentation";

type AnnotatedGrade = Parameters<typeof annotateGradeRecordedImpacts>[0][number] & {
  recordedOpportunityImpact?: ReportGradePresentation;
};

/** A deduction the ledger recorded and that still weighs on today's balance. */
export function recordedImpactChargedNow(impact: ReportGradePresentation): boolean {
  const charged = impact.tone === "deducted" || impact.tone === "dismissed";
  return charged && !impact.text.includes("لا أثر على الرصيد الحالي");
}

/**
 * For each stored grade of the calls list: does the opportunities ledger
 * show a deduction that still counts? This is the same evidence the card's
 * badge shows, so the «المخصومين» filter and its count agree with the badge.
 * A grade with no ledger evidence is simply absent from the map.
 */
export async function loadRecordedChargeByGradeId(
  grades: AnnotatedGrade[],
  scope: string,
): Promise<Map<string, boolean>> {
  const charged = new Map<string, boolean>();
  if (!grades.length) return charged;
  // Same two steps as «سجل الدرجات»: settlements first, then the ledger.
  await withDatabaseSchema(async () => {
    await annotateGradeSettlementEffects(grades);
    await annotateGradeRecordedImpacts(grades);
  }, scope);
  for (const grade of grades) {
    if (grade.recordedOpportunityImpact) {
      charged.set(grade.id, recordedImpactChargedNow(grade.recordedOpportunityImpact));
    }
  }
  return charged;
}
