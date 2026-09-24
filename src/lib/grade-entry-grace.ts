import {
  classifyGradeAcademicImpact,
  isGradeEnteredUnified,
  type ExamLike,
  type GradeLike,
  type StudentGraceLike,
} from "@/lib/grade-classification";
import { isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";
import { shouldEndGraceForNumericGrade } from "@/lib/grace-grade-activation";

/** Exam protection and the effect of entering a number are separate decisions. */
export function getGradeEntryGraceState(args: {
  student: StudentGraceLike;
  exam: ExamLike;
  grade?: GradeLike | null;
  hasLeave?: boolean;
  now?: Date;
}): { protectedForExam: boolean; numericGradeEndsGrace: boolean } {
  const { student, exam, grade, hasLeave = false, now } = args;
  // Missing grades still need an exam-specific badge/filter before the bulk
  // operation creates their marker. This is a read-only classification probe.
  const gradeForClassification = isGradeEnteredUnified(grade, exam)
    ? grade
    : { ...grade, status: "غائب", score: null };
  const protectedForExam = !hasLeave && classifyGradeAcademicImpact(
    gradeForClassification,
    exam,
    { student },
  ) === "grace-period";

  return {
    protectedForExam,
    numericGradeEndsGrace: shouldEndGraceForNumericGrade({
      student,
      status: "درجة",
      score: 0,
      examOnOrAfterRegistration: isExamOnOrAfterStudentRegistration(student, exam),
      now,
    }),
  };
}
