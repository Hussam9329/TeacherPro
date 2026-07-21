export type GradeStatusFilter =
  | "all"
  | "excused"
  | "grace-period"
  | "absent"
  | "cheating"
  | "discounted"
  | "failed"
  | "academic-accounting"
  | "passed"
  | "full-mark"
  | "has-grade";

export const gradeStatusFilterLabels: Record<GradeStatusFilter, string> = {
  all: "كل حالات الدرجة",
  excused: "الطلاب المجازون",
  "grace-period": "ضمن السماح",
  absent: "الطلاب الغائبون",
  cheating: "طلاب الغش",
  discounted: "الطلاب المخصومون",
  failed: "الراسبون غير المخصومين",
  "academic-accounting": "طلاب المحاسبة",
  passed: "الطلاب الناجحون",
  "full-mark": "الدرجة الكاملة",
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

function isFailedNotDiscounted(
  score: number | null,
  exam: { passMark?: unknown; discountMark?: unknown; noDiscount?: boolean },
): boolean {
  if (score === null) return false;
  const passMark = Number(exam.passMark || 0);
  const discountMark = Number(exam.discountMark || 0);
  if (exam.noDiscount) return score < passMark;
  return score > discountMark && score < passMark;
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
  const isNoAccountingKind = ["grace", "before-registration", "unavailable-exam", "excused"].includes(kind);

  switch (filter) {
    case "excused":
      return kind === "excused";
    case "grace-period":
      return kind === "grace" || kind === "before-registration";
    case "absent":
      return !isNoAccountingKind && grade.status === "غائب";
    case "cheating":
      return !isNoAccountingKind && grade.status === "غش";
    case "discounted":
      return !isNoAccountingKind && score !== null && !exam.noDiscount && score <= discountMark;
    case "failed":
      return !isNoAccountingKind && isFailedNotDiscounted(score, exam);
    case "academic-accounting":
      return !isNoAccountingKind && kind === "academic-accounting";
    case "passed":
      return !isNoAccountingKind && score !== null && score >= passMark;
    case "full-mark":
      return !isNoAccountingKind && score !== null && score === fullMark;
    case "has-grade":
      return score !== null || grade.status === "غائب" || grade.status === "غش" || grade.status === "ضمن فترة السماح";
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
