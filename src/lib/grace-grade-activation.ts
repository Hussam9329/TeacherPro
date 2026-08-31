import {
  isStudentCurrentlyInGrace,
  type StudentGraceLike,
} from "@/lib/student-grace";

export type GraceGradeActivationInput = {
  student: StudentGraceLike;
  status: string;
  score: number | null | undefined;
  examOnOrAfterRegistration: boolean;
  now?: Date;
};

/**
 * The one business decision for ending grace through grade entry.
 *
 * Zero is a real grade. Blank/non-numeric states, absence, cheating, and
 * historical pre-registration scores never terminate grace.
 */
export function shouldEndGraceForNumericGrade(
  input: GraceGradeActivationInput,
): boolean {
  return (
    input.status === "درجة" &&
    typeof input.score === "number" &&
    Number.isFinite(input.score) &&
    input.examOnOrAfterRegistration &&
    isStudentCurrentlyInGrace(input.student, input.now)
  );
}
