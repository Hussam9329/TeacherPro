import { findStudentGracePeriod, formatGracePeriod, type GracePeriodRange } from "./grace-periods";
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

/** Read the recorded grant, including historical settlements and manual pledges. */
export function hasTwoOpportunityPledge(logs: Record<string, unknown>[]): boolean {
  return logs.some(log => {
    const action = String(log.action || "").trim();
    const reason = studentReportText(log.reason).normalize("NFKD").replace(/[\u064B-\u065F\u0670]/g, "");
    const mentionsPledge = action === "رصيد بعد تعهد" || /تعهد/.test(reason);
    if (!mentionsPledge || /حماية P\d+|دون تغيير بتوجيه المالك/.test(reason)) return false;
    if (/(?:بدون|دون|لا يوجد)\s+(?:ال)?تعهد|لم\s+(?:يتعهد|يتم\s+(?:قبول\s+)?(?:ال)?تعهد)|الغاء\s+(?:ال)?تعهد/.test(reason)) return false;

    // Balance setters record the new balance; appliedAmount can be zero even
    // when a historical settlement explicitly established a two-chance pledge.
    if (["رصيد بعد تعهد", "رصيد إعادة التفعيل", "إعادة تعيين"].includes(action)) {
      return (reportNumber(log.balanceAfter) ?? reportNumber(log.amount)) === 2;
    }
    if (action === "إضافة") {
      return (reportNumber(log.appliedAmount) ?? reportNumber(log.amount)) === 2;
    }
    // Some older manual returns have only the completed reactivation event.
    const savedBalance = reportNumber(log.balanceAfter);
    return (savedBalance === null || savedBalance === 2) &&
      (action === "إعادة تفعيل" || action === "إعادة تفعيل بفرصتين") &&
      (action === "إعادة تفعيل بفرصتين" || /فرصتين/.test(reason));
  });
}

export type ReportBalanceNote = { text: string; date: string };
export type ReportOpportunityContext = {
  settlement: {
    date: string;
    settledGradeIds: ReadonlySet<string>;
  } | null;
  balanceNotes: ReportBalanceNote[];
  /** The student's active grace periods: the only source of grace in reports. */
  gracePeriods?: readonly GracePeriodRange[];
};

function reportLogDate(log: Record<string, unknown>): string | null {
  if (log.date instanceof Date && !Number.isFinite(log.date.getTime())) return null;
  const value = log.date instanceof Date ? log.date.toISOString() : String(log.date || "");
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

function reportBalanceGrant(log: Record<string, unknown>): boolean {
  // Keep the balance-grant vocabulary aligned with the academic engine. A
  // status-only reactivation is not a grant and cannot settle a grade.
  return log.action === "رصيد بعد تعهد" || log.action === "رصيد إعادة التفعيل" ||
    String(log.reason || "").includes("فرصتين بعد التعهد");
}

/** Describe recorded balance commands without recalculating the balance.
 * Structured settlement membership follows gradeSettlementExclusion: only
 * the exact saved grade IDs are covered, never every exam before a date.
 * Unlike the broader profile explanation, this public report requires a
 * known active chapter and does not infer a legacy settlement from notes. */
export function buildReportOpportunityContext(
  logs: readonly Record<string, unknown>[],
  activeChapterId?: unknown,
): ReportOpportunityContext {
  const chapterId = typeof activeChapterId === "string" ? activeChapterId.trim() : "";
  if (!chapterId) return { settlement: null, balanceNotes: [] };
  const currentLogs = logs.filter(log => log.chapterId === chapterId && reportLogDate(log));
  const ordered = [...currentLogs].sort((a, b) =>
    Date.parse(reportLogDate(a)!) - Date.parse(reportLogDate(b)!));
  const setters = ordered.filter(log => log.ledgerVersion === 2 &&
    (log.action === "إعادة تعيين" || reportBalanceGrant(log)));
  const reset = setters.filter(log => log.action === "إعادة تعيين").at(-1);
  const grant = setters.filter(reportBalanceGrant).at(-1);
  // The engine chooses a reset when a reset and a grant have the same date.
  const latest = reset && (!grant || Date.parse(reportLogDate(reset)!) >= Date.parse(reportLogDate(grant)!))
    ? reset : grant;
  const targetBalance = latest ? reportNumber(latest.balanceAfter ?? latest.amount) : null;
  const validLatest = latest && targetBalance !== null && Number.isSafeInteger(targetBalance) ? latest : null;
  let settlement: ReportOpportunityContext["settlement"] = null;
  if (validLatest) {
    const settledGradeIds = new Set<string>();
    // Corrupt/missing membership never falls back to an older settlement's
    // IDs, which could incorrectly hide a later, still-effective grade.
    try {
      const ids: unknown = typeof validLatest.settledGradeIds === "string"
        ? JSON.parse(validLatest.settledGradeIds) : null;
      if (Array.isArray(ids) && ids.every(id => typeof id === "string" && id.trim())) {
        ids.forEach(id => settledGradeIds.add(id));
      }
    } catch { /* Keep all grade effects when their settlement is unproved. */ }
    settlement = { date: reportLogDate(validLatest)!, settledGradeIds };
  }

  const balanceNotes: ReportBalanceNote[] = [];
  if (validLatest) {
    const reason = String(validLatest.reason || "");
    // The owner removed chapter-opening and balance-confirmation notes.
    if (reportBalanceGrant(validLatest)) {
      const text = validLatest.action === "رصيد بعد تعهد" || hasTwoOpportunityPledge([validLatest])
        ? `مُنحت رصيداً قدره ${targetBalance} من الفرص بعد قبول التعهّد`
        : `أُعيد تفعيلك برصيد ${targetBalance} من الفرص`;
      balanceNotes.push({ text, date: reportLogDate(validLatest)! });
    } else if (!/حماية P\d+|دون تغيير بتوجيه المالك|انتقال|تحويل فصل/.test(reason)) {
      balanceNotes.push({ text: `حدّدت الإدارة رصيدك بـ ${targetBalance} من الفرص`, date: reportLogDate(validLatest)! });
    }
  }
  for (const log of ordered) {
    if (log.action !== "إضافة" || reportBalanceGrant(log)) continue;
    const date = reportLogDate(log)!;
    if (settlement && Date.parse(date) < Date.parse(settlement.date)) continue;
    const amount = reportNumber(log.appliedAmount) ?? reportNumber(log.amount);
    if (amount === null || amount <= 0 || !Number.isSafeInteger(amount)) continue;
    const count = amount === 1 ? "فرصة واحدة" : amount === 2 ? "فرصتين" : `${amount} فرص`;
    balanceNotes.push({ text: `أضافت الإدارة ${count}`, date });
  }
  return { settlement, balanceNotes };
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
  // The retired grace placeholder is not a result: it records nothing.
  return ({ "غائب": "غياب", "غش": "حالة غش", "مجاز": "إجازة", "ضمن فترة السماح": "لا توجد نتيجة مسجلة", "قبل تسجيل الطالب": "قبل تسجيلك" } as Record<string, string>)[status] || "غياب";
}

export function reportGradeEffect(grade: Record<string, unknown>, exam: Record<string, unknown> | undefined, logs: Record<string, unknown>[], context?: ReportOpportunityContext): string {
  const settlement = context?.settlement;
  const settledGrade = Boolean(settlement && typeof grade.id === "string" && settlement.settledGradeIds.has(grade.id));
  const effectiveLogs = settlement ? logs.filter(log => {
    const automatic = log.action === "خصم تلقائي" || log.action === "فصل تلقائي" ||
      String(log.reason || "").startsWith("تلقائي:");
    if (automatic) return !settledGrade;
    // A later manual deduction still affects a settled exam. An old dated
    // manual command was superseded by the saved reset/return balance.
    const date = reportLogDate(log);
    return !date || Date.parse(date) >= Date.parse(settlement.date);
  }) : logs;
  // Describe stored movements first; grade thresholds alone do not prove a deduction.
  const deductions = effectiveLogs.filter(l => l.action === "خصم" || l.action === "خصم تلقائي");
  const deducted = deductions.reduce((sum, l) => sum + (reportNumber(l.appliedAmount) ?? reportNumber(l.amount) ?? 0), 0);
  const dismissed = effectiveLogs.some(l => String(l.action || "").startsWith("فصل"));
  const deductionText = deducted === 1
    ? "تم خصم فرصة لهذا الامتحان"
    : deducted === 2
      ? "تم خصم فرصتين لهذا الامتحان"
      : deducted > 0 ? `عدد الفرص المخصومة لهذا الامتحان: ${deducted}` : "";
  if (deducted || dismissed) return [deductionText, dismissed ? "سُجّل فصل بسبب هذا الامتحان" : ""].filter(Boolean).join(". ");
  if (settledGrade) return "لا يوجد خصم لهذا الامتحان — مشمول بتسوية الرصيد";
  if (grade.academicEffectExcluded) return "لا خصم: هذه الدرجة مستثناة من حساب الفرص.";
  if (grade.status === "مجاز") return "لا خصم: لديك إجازة لهذا الامتحان.";
  if (grade.status === "قبل تسجيل الطالب") return "لا خصم: الامتحان قبل تسجيلك.";
  const gracePeriod = findStudentGracePeriod(context?.gracePeriods, exam?.date as string | Date | null | undefined);
  if (gracePeriod) return `لا خصم: الامتحان ضمن فترة السماح ${formatGracePeriod(gracePeriod)}.`;
  if (exam?.noDiscount) return "هذا الامتحان لا يخصم فرصاً.";
  return "لا يوجد خصم لهذا الامتحان";
}
