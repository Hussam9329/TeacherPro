import { formatGradeScore, normalizeScore, type GradeLike } from "./exam-utils";

type ResultTone = "pass" | "fail-light" | "excused" | "sky" | "absent" | "cheating" | "neutral";

/** Academic result only. A score or failure never proves a recorded penalty. */
export function gradeRecordResultPresentation(
  grade: NonNullable<GradeLike>,
  exam: { fullMark: number; passMark?: number | null },
): { scoreText: string; label: string; tone: ResultTone; numeric: boolean } {
  const status = String(grade.status || "");
  if (status === "درجة معلّقة") {
    return { scoreText: "درجة معلّقة", label: "", tone: "neutral", numeric: false };
  }
  if (status === "درجة") {
    const score = normalizeScore(grade.score);
    const passMark = normalizeScore(exam.passMark);
    if (score === null) {
      return { scoreText: "بانتظار الدرجة", label: "", tone: "neutral", numeric: false };
    }
    const passed = passMark !== null && score >= passMark;
    return {
      scoreText: formatGradeScore(grade, exam),
      label: passMark === null ? "درجة مسجّلة" : passed ? "ناجح" : "راسب",
      tone: passMark === null ? "neutral" : passed ? "pass" : "fail-light",
      numeric: true,
    };
  }
  if (status === "قبل تسجيل الطالب") {
    return { scoreText: "قبل التسجيل", label: "", tone: "sky", numeric: false };
  }
  if (status === "ضمن فترة السماح") {
    return { scoreText: "لا توجد نتيجة مسجّلة", label: "", tone: "neutral", numeric: false };
  }
  const tone = status === "مجاز" ? "excused"
    : status === "غائب" ? "absent"
      : status === "غش" ? "cheating" : "neutral";
  return { scoreText: status || "لا توجد نتيجة مسجّلة", label: "", tone, numeric: false };
}
