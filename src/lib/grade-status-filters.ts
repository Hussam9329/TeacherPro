export type GradeStatusFilter =
  | "all"
  | "full-mark"
  | "grace-period"
  | "absent"
  | "discounted"
  | "failed"
  | "academic-accounting"
  | "cheating"
  | "has-grade";

export const gradeStatusFilterLabels: Record<GradeStatusFilter, string> = {
  all: "كل حالات الدرجة",
  "full-mark": "الدرجة الكاملة",
  "grace-period": "طلاب فترة السماح",
  absent: "الطلاب الغائبين",
  discounted: "الطلاب المخصومين",
  failed: "الطلاب الراسبين",
  "academic-accounting": "طلاب المحاسبة",
  cheating: "طلاب الغش",
  "has-grade": "الطلاب الذين لديهم درجة",
};

export const gradeStatusFilterOptions = Object.keys(
  gradeStatusFilterLabels,
) as GradeStatusFilter[];

function numericScore(grade: {
  status?: string;
  score?: unknown;
}): number | null {
  if (grade.status !== "درجة") return null;
  const score = Number(grade.score);
  return Number.isFinite(score) ? score : null;
}

export function gradeMatchesStatusFilter(
  filter: GradeStatusFilter | string,
  grade: { status?: string; score?: unknown },
  exam: {
    fullMark?: unknown;
    passMark?: unknown;
    discountMark?: unknown;
    noDiscount?: boolean;
  },
  classificationResult?: { kind?: string },
): boolean {
  if (!filter || filter === "all") return true;

  const score = numericScore(grade);
  const fullMark = Number(exam.fullMark || 0);
  const passMark = Number(exam.passMark || 0);
  const discountMark = Number(exam.discountMark || 0);
  const kind = String(classificationResult?.kind || "");
  const isNoAccountingKind = ["grace", "before-registration", "excused"].includes(kind);

  switch (filter) {
    case "full-mark":
      return !isNoAccountingKind && score !== null && score === fullMark;
    case "grace-period":
      return kind === "grace" || kind === "before-registration";
    case "absent":
      return !isNoAccountingKind && grade.status === "غائب";
    case "discounted":
      return !isNoAccountingKind && score !== null && !exam.noDiscount && score <= discountMark;
    case "failed":
      return !isNoAccountingKind && score !== null && score < passMark;
    case "academic-accounting":
      return (
        !isNoAccountingKind &&
        (kind === "academic-accounting" ||
          (score !== null &&
            !exam.noDiscount &&
            score > discountMark &&
            score < passMark))
      );
    case "cheating":
      return !isNoAccountingKind && grade.status === "غش";
    case "has-grade":
      return score !== null;
    default:
      return true;
  }
}

export function firstArabicLetter(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const first = text[0]
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
  return first;
}

export function buildArabicLetterOptions(names: unknown[]): string[] {
  return Array.from(new Set(names.map(firstArabicLetter).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, "ar"),
  );
}

export function matchesArabicLetterFilter(
  name: unknown,
  letter: string,
): boolean {
  if (!letter || letter === "all") return true;
  return firstArabicLetter(name) === letter;
}
