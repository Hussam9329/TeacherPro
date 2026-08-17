export const PRE_REGISTRATION_GRADE_EXCLUSION_REASON =
  "درجة رقمية أُدخلت لامتحان يسبق تسجيل الطالب، وهي محفوظة في سجله ومستبعدة دائماً من الخصم والفصل والمحاسبة الأكاديمية.";

export const PRE_REGISTRATION_GRADE_EXCLUSION_SOURCE =
  "PreRegistrationGrade:Direct";

export function isPreRegistrationNumericGrade(input: {
  examOnOrAfterRegistration: boolean;
  status: string;
  score: number | null | undefined;
}): boolean {
  return (
    !input.examOnOrAfterRegistration &&
    input.status === "درجة" &&
    typeof input.score === "number" &&
    Number.isFinite(input.score)
  );
}
