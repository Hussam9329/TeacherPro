/** Read-only wording for the published student report. Never replay the ledger. */
export function reportNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function studentReportText(value: unknown): string {
  return String(value ?? "")
    .replace(/\[(?:academic-[^\]]*|zero-balance-violation|قبل:[^\]]*)\]/g, "")
    .replace(/تلقائي(?:اً|ا|ة)?/g, "")
    .replace(/تسوية تاريخية\s*:\s*/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:،؛.\-–—|]+|[\s:،؛.\-–—|]+$/g, "")
    .trim();
}

export type ReportMovementKind = "add" | "deduct" | "reset" | "chapter-start" | "confirm-balance" | "return-balance" | "return" | "dismiss" | "other";
type Movement = {
  action: string; amount: number; reason?: string | null;
  appliedAmount?: number | null; balanceBefore?: number | null; balanceAfter?: number | null;
  movementKind?: ReportMovementKind;
};

export function presentOpportunityMovement(log: Movement) {
  const action = log.action.trim();
  const rawReason = log.reason || "";
  const kind: ReportMovementKind = log.movementKind || (
    action === "إضافة" ? "add" :
    action === "خصم" || action === "خصم تلقائي" ? "deduct" :
    action === "رصيد بعد تعهد" || action === "رصيد إعادة التفعيل" ? "return-balance" :
    action === "إعادة تفعيل" ? "return" :
    action.startsWith("فصل") ? "dismiss" :
    action === "إعادة تعيين" ? (/حماية P\d+|دون تغيير بتوجيه المالك/.test(rawReason) ? "confirm-balance" : /انتقال|تحويل فصل/.test(rawReason) ? "chapter-start" : "reset") : "other"
  );
  const labels: Record<ReportMovementKind, string> = {
    add: "إضافة فرص", deduct: "خصم فرص", reset: "رصيد جديد",
    "chapter-start": "بداية رصيد الفصل", "return-balance": "رصيد العودة للدراسة",
    "confirm-balance": "تأكيد الرصيد",
    return: "العودة للدراسة", dismiss: "فصل من الدراسة", other: "تحديث مسجّل",
  };
  const amount = reportNumber(log.appliedAmount) ?? reportNumber(log.amount);
  const before = reportNumber(log.balanceBefore);
  const after = reportNumber(log.balanceAfter);
  let reason = log.movementKind ? rawReason : studentReportText(rawReason);
  if (!log.movementKind) {
    if (kind === "confirm-balance") reason = "تم تثبيت رصيدك كما هو؛ لم تُضف أو تُخصم فرص في هذا الإجراء.";
    else if (kind === "chapter-start") reason = "بدأ حساب فرص هذا الفصل برصيد جديد؛ خصومات الفصل السابق لا تُخصم منه.";
    else if (kind === "reset" && /تجاهل آثار الامتحانات|تثبيت رصيد/.test(rawReason)) {
      reason = /تعهد/.test(rawReason)
        ? "بدأ رصيد جديد بعد قبول التعهّد."
        : "حدّدت الإدارة رصيداً جديداً؛ الامتحانات المشمولة بهذا الإجراء لا تخصم منه.";
    } else if (kind === "return-balance") {
      reason = /تعهد/.test(rawReason) ? "مُنحت هذه الفرص بعد قبول التعهّد والعودة للدراسة." : "رصيد مُنح عند العودة للدراسة.";
    } else if (kind === "return") {
      reason = /تعهد/.test(rawReason) ? "تم قبول التعهّد وإعادتك إلى الدراسة." : /الفصل/.test(rawReason) ? "تمت إعادتك إلى الدراسة عند بدء الفصل الجديد." : "تمت إعادتك إلى الدراسة.";
    } else if (kind === "deduct") {
      reason = reason.replace(/درجة\s+([\d.]+)\s+ضمن الخصم/, "الدرجة $1 تستوجب خصم فرص")
        .replace(/درجة خصم\s*\(([\d.]+)\)/, "الدرجة $1 تستوجب خصم فرص");
    }
    if (/^تسوي[ةه]$/.test(reason)) reason = "تعديل الرصيد من الإدارة.";
    if (reason === "تعهد") reason = "بعد قبول التعهّد.";
  }
  if (!reason) reason = "لم يُسجّل سبب إضافي لهذه الحركة.";

  let effectText = "لا يوجد تغيير في عدد الفرص مسجّل لهذه الحركة";
  if (kind === "add" || kind === "deduct") {
    effectText = amount === null ? "عدد الفرص غير مسجّل" : amount === 0 ? "لم يتغيّر عدد الفرص" : `${kind === "add" ? "إضافة" : "خصم"} ${amount}`;
  } else if (kind === "confirm-balance") {
    const balance = after ?? reportNumber(log.amount);
    effectText = balance === null ? "لم يتغيّر الرصيد" : `بقي الرصيد ${balance}`;
  } else if (["reset", "chapter-start", "return-balance"].includes(kind)) {
    const target = after ?? reportNumber(log.amount);
    effectText = target === null ? "الرصيد الجديد غير مسجّل" : `أصبح الرصيد ${target}`;
  } else if (kind === "return" || kind === "dismiss") effectText = "تغيير الحالة";
  return { action: kind === "other" ? studentReportText(action) || labels.other : labels[kind], reason, movementKind: kind, effectText, balanceBefore: before, balanceAfter: after };
}

export function reportGradeOutcome(grade: Record<string, unknown>, exam?: Record<string, unknown>): string {
  const status = String(grade.status || "");
  if (status === "درجة") {
    const score = reportNumber(grade.score);
    if (score === null) return "غياب";
    const full = reportNumber(exam?.fullMark);
    const pass = reportNumber(exam?.passMark);
    return full !== null && score === full ? "الدرجة كاملة" : pass === null ? "درجة مسجّلة" : score >= pass ? "ناجح" : "أقل من درجة النجاح";
  }
  return ({ "غائب": "غياب", "غش": "حالة غش", "مجاز": "إجازة", "ضمن فترة السماح": "ضمن فترة السماح", "قبل تسجيل الطالب": "قبل تسجيلك" } as Record<string, string>)[status] || "غياب";
}

export function reportGradeEffect(grade: Record<string, unknown>, exam: Record<string, unknown> | undefined, logs: Record<string, unknown>[]): string {
  // Describe stored movements first; grade thresholds alone do not prove a deduction.
  const deductions = logs.filter(l => l.action === "خصم" || l.action === "خصم تلقائي");
  const deducted = deductions.reduce((sum, l) => sum + (reportNumber(l.appliedAmount) ?? reportNumber(l.amount) ?? 0), 0);
  const dismissed = logs.some(l => String(l.action || "").startsWith("فصل"));
  if (deducted || dismissed) return [deducted ? `خصم مسجّل: ${deducted}` : "", dismissed ? "سُجّل فصل بسبب هذا الامتحان" : ""].filter(Boolean).join(". ");
  if (grade.academicEffectExcluded) return "لا خصم: هذه الدرجة مستثناة من حساب الفرص.";
  if (grade.status === "مجاز") return "لا خصم: لديك إجازة لهذا الامتحان.";
  if (grade.status === "قبل تسجيل الطالب") return "لا خصم: الامتحان قبل تسجيلك.";
  if (grade.status === "ضمن فترة السماح" || /درجة (?:مؤجلة خلال فترة سماح الطالب|مؤجلة خلال فترة السماح|حقيقية داخل فترة السماح)/.test(String(grade.notes || ""))) return "لا خصم: الامتحان ضمن فترة السماح.";
  if (exam?.noDiscount) return "هذا الامتحان لا يخصم فرصاً.";
  return "لا يوجد خصم مسجّل لهذا الامتحان.";
}
