import { CALL_STUDENT_NOTE_CATEGORY } from "@/lib/call-notes-filter";

type StudentExamCallLike = {
  studentId: string;
  examId?: string | null;
  category?: string | null;
};

/**
 * Contact status belongs to one logical follow-up call per student + exam.
 * `category` remains legacy/display metadata only and must never participate
 * in the identity of an exam call.
 */
export function isStudentExamCall(call: StudentExamCallLike): boolean {
  return Boolean(
    String(call.studentId || "") &&
      String(call.examId || "") &&
      String(call.category || "") !== CALL_STUDENT_NOTE_CATEGORY,
  );
}

export function studentExamCallIdentityKey(
  studentId: string,
  examId: string | null | undefined,
): string {
  return `${String(studentId || "")}::${String(examId || "")}`;
}

export function studentExamCallIdentityMatches(
  call: StudentExamCallLike,
  studentId: string,
  examId: string | null | undefined,
): boolean {
  return (
    isStudentExamCall(call) &&
    call.studentId === studentId &&
    String(call.examId || "") === String(examId || "")
  );
}
