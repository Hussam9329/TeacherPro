/**
 * Shared, framework-free validation for exam creation and editing.
 * Browser forms and API routes must use this module so academic rules cannot
 * drift between screens or be bypassed by a direct request.
 */

export type ExamValidationField =
  | "form"
  | "name"
  | "type"
  | "courseIds"
  | "mainSites"
  | "date"
  | "fullMark"
  | "passMark"
  | "discountMark"
  | "opportunitiesPenalty"
  | "dismissalGrade"
  | "scheduledActivateAt";

export type ExamValidationFieldErrors = Partial<
  Record<ExamValidationField, string>
>;

export type ExamValidationResult = {
  isValid: boolean;
  firstError: string | null;
  fieldErrors: ExamValidationFieldErrors;
};

export type ExamGradePolicyInput = {
  type: unknown;
  noDiscount: boolean;
  fullMark: unknown;
  passMark: unknown;
  discountMark?: unknown;
  opportunitiesPenalty?: unknown;
  dismissalGrade?: unknown;
};

export type ExamGradePolicyValidation = ExamValidationResult & {
  values: {
    fullMark: number | null;
    passMark: number | null;
    discountMark: number | null;
    opportunitiesPenalty: number | null;
    dismissalGrade: number | null;
  };
};

export type ExamFormValidationInput = ExamGradePolicyInput & {
  name: unknown;
  courseIds: readonly unknown[];
  mainSites: readonly unknown[];
  date: unknown;
  statusMode?: unknown;
  scheduledActivateAt?: unknown;
  /** A loading/server-context blocker supplied by the screen. */
  preflightError?: string | null;
  /** A course eligibility blocker supplied by the screen/API. */
  courseSelectionError?: string | null;
};

const VALID_EXAM_TYPES = new Set(["يومي", "تراكمي", "فاينل"]);
const ARABIC_OR_PERSIAN_DIGITS = /[٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹]/g;
const LATIN_DIGIT_BY_ARABIC_DIGIT: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

function normalizeNumberish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value
    .replace(
      ARABIC_OR_PERSIAN_DIGITS,
      (digit) => LATIN_DIGIT_BY_ARABIC_DIGIT[digit] ?? digit,
    )
    .trim();
  return normalized === "" ? null : normalized;
}

export function parseExamNumber(value: unknown): number | null {
  const normalized = normalizeNumberish(value);
  if (
    normalized === null ||
    normalized === undefined ||
    (typeof normalized !== "number" && typeof normalized !== "string")
  ) {
    return null;
  }
  if (
    typeof normalized === "string" &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)
  ) {
    return null;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasOptionalValue(value: unknown): boolean {
  const normalized = normalizeNumberish(value);
  return normalized !== null && normalized !== undefined;
}

function hasText(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function hasSelection(value: readonly unknown[]): boolean {
  return Array.isArray(value) && value.some((item) => hasText(item));
}

function createCollector() {
  const fieldErrors: ExamValidationFieldErrors = {};
  let firstError: string | null = null;

  return {
    add(
      field: ExamValidationField,
      fieldMessage: string,
      summaryMessage = fieldMessage,
    ) {
      if (!fieldErrors[field]) fieldErrors[field] = fieldMessage;
      if (!firstError) firstError = summaryMessage;
    },
    result(): ExamValidationResult {
      return {
        isValid: firstError === null,
        firstError,
        fieldErrors,
      };
    },
  };
}

/**
 * Validate all numeric relationships that control exam outcomes.
 * passMark === fullMark is valid by design.
 */
export function validateExamGradePolicy(
  input: ExamGradePolicyInput,
): ExamGradePolicyValidation {
  const isFinalExam = String(input.type ?? "") === "فاينل";
  const noDiscount = Boolean(input.noDiscount);
  const fullMark = parseExamNumber(input.fullMark);
  const passMark = parseExamNumber(input.passMark);
  const discountMark =
    isFinalExam || noDiscount ? 0 : parseExamNumber(input.discountMark);
  const opportunitiesPenalty =
    isFinalExam || noDiscount
      ? 0
      : parseExamNumber(input.opportunitiesPenalty);
  const hasDismissalGrade =
    !noDiscount && isFinalExam && hasOptionalValue(input.dismissalGrade);
  const dismissalGrade = hasDismissalGrade
    ? parseExamNumber(input.dismissalGrade)
    : null;
  const errors = createCollector();

  if (fullMark === null || !Number.isInteger(fullMark)) {
    errors.add(
      "fullMark",
      "الدرجة الكاملة يجب أن تكون عدداً صحيحاً بدون كسور.",
      "درجات الامتحان يجب أن تكون أعداداً صحيحة بدون كسور",
    );
  } else if (fullMark <= 0) {
    errors.add("fullMark", "الدرجة الكاملة يجب أن تكون أكبر من صفر.");
  }

  if (passMark === null || !Number.isInteger(passMark)) {
    errors.add(
      "passMark",
      "درجة النجاح يجب أن تكون عدداً صحيحاً بدون كسور.",
      "درجات الامتحان يجب أن تكون أعداداً صحيحة بدون كسور",
    );
  } else if (passMark < 0) {
    errors.add("passMark", "درجة النجاح لا يمكن أن تكون أقل من صفر.");
  } else if (
    fullMark !== null &&
    Number.isInteger(fullMark) &&
    fullMark > 0 &&
    passMark > fullMark
  ) {
    errors.add(
      "passMark",
      `درجة النجاح لا يمكن أن تتجاوز الدرجة الكاملة (${fullMark}).`,
      "درجة النجاح يجب أن تكون بين صفر والدرجة الكاملة",
    );
  }

  if (!isFinalExam && !noDiscount) {
    if (discountMark === null || !Number.isInteger(discountMark)) {
      errors.add(
        "discountMark",
        "درجة الخصم يجب أن تكون عدداً صحيحاً بدون كسور.",
        "درجات الامتحان يجب أن تكون أعداداً صحيحة بدون كسور",
      );
    } else if (discountMark < 0) {
      errors.add("discountMark", "درجة الخصم لا يمكن أن تكون أقل من صفر.");
    } else if (
      fullMark !== null &&
      Number.isInteger(fullMark) &&
      fullMark > 0 &&
      discountMark > fullMark
    ) {
      errors.add(
        "discountMark",
        `درجة الخصم لا يمكن أن تتجاوز الدرجة الكاملة (${fullMark}).`,
        "درجة الخصم يجب أن تكون بين صفر والدرجة الكاملة",
      );
    }

    if (
      passMark !== null &&
      discountMark !== null &&
      Number.isInteger(passMark) &&
      Number.isInteger(discountMark) &&
      passMark >= 0 &&
      discountMark >= 0 &&
      passMark <= discountMark
    ) {
      errors.add(
        "passMark",
        "درجة النجاح يجب أن تكون أكبر من درجة الخصم.",
      );
      errors.add(
        "discountMark",
        "درجة الخصم يجب أن تكون أقل من درجة النجاح.",
        "درجة النجاح يجب أن تكون أكبر من درجة الخصم.",
      );
    }

    if (
      opportunitiesPenalty === null ||
      !Number.isInteger(opportunitiesPenalty) ||
      opportunitiesPenalty <= 0
    ) {
      errors.add(
        "opportunitiesPenalty",
        "خصم الفرص يجب أن يكون عدداً صحيحاً أكبر من صفر.",
      );
    }
  }

  if (!noDiscount && isFinalExam && hasDismissalGrade) {
    if (dismissalGrade === null || !Number.isInteger(dismissalGrade)) {
      errors.add(
        "dismissalGrade",
        "درجة الفصل يجب أن تكون عدداً صحيحاً بدون كسور.",
        "درجة الفصل يجب أن تكون عدداً صحيحاً بين صفر والدرجة الكاملة",
      );
    } else if (
      dismissalGrade < 0 ||
      (fullMark !== null &&
        Number.isInteger(fullMark) &&
        fullMark > 0 &&
        dismissalGrade > fullMark)
    ) {
      errors.add(
        "dismissalGrade",
        fullMark !== null && fullMark > 0
          ? `درجة الفصل يجب أن تكون بين صفر والدرجة الكاملة (${fullMark}).`
          : "درجة الفصل يجب أن تكون بين صفر والدرجة الكاملة.",
        "درجة الفصل يجب أن تكون عدداً صحيحاً بين صفر والدرجة الكاملة",
      );
    }
  }

  return {
    ...errors.result(),
    values: {
      fullMark,
      passMark,
      discountMark,
      opportunitiesPenalty,
      dismissalGrade,
    },
  };
}

/** Validate the complete form shape plus the shared numeric policy. */
export function validateExamForm(
  input: ExamFormValidationInput,
): ExamValidationResult {
  const errors = createCollector();

  if (input.preflightError) {
    errors.add("form", input.preflightError);
  }
  if (!hasText(input.name)) {
    errors.add("name", "اسم الامتحان مطلوب");
  }
  if (!VALID_EXAM_TYPES.has(String(input.type ?? ""))) {
    errors.add("type", "نوع الامتحان غير صحيح");
  }
  if (!hasSelection(input.courseIds)) {
    errors.add("courseIds", "يجب اختيار دورة واحدة على الأقل");
  } else if (input.courseSelectionError) {
    errors.add("courseIds", input.courseSelectionError);
  }
  if (!hasSelection(input.mainSites)) {
    errors.add("mainSites", "يجب اختيار منطقة واحدة على الأقل");
  }
  if (!hasText(input.date)) {
    errors.add("date", "تاريخ الامتحان مطلوب");
  }

  const gradeValidation = validateExamGradePolicy(input);
  for (const [field, message] of Object.entries(
    gradeValidation.fieldErrors,
  )) {
    if (message) {
      errors.add(
        field as ExamValidationField,
        message,
        gradeValidation.firstError || message,
      );
    }
  }

  if (
    String(input.statusMode ?? "") === "تفعيل مجدول" &&
    !hasText(input.scheduledActivateAt)
  ) {
    errors.add(
      "scheduledActivateAt",
      "حدد تاريخ ووقت التفعيل المجدول",
    );
  }

  return errors.result();
}
