import { findStudentGracePeriod, GRACE_PERIOD_EXCUSE_LABEL, type GracePeriodRange } from "./grace-periods";
import { isExamOnOrAfterStudentRegistration } from "./exam-utils";
import { examResultTimelineDate } from "./academic-event-order";
import type { AcademicOpportunityCommandEffect } from "./academic-types";
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
  /** Show recorded past effects alongside dated balance movements. */
  historical?: boolean;
  studentStatus?: string;
  /** Completed returns to study only; additions and resets are not returns. */
  reactivationDates?: readonly string[];
  /** The student's active grace periods: the only source of grace in reports. */
  gracePeriods?: readonly GracePeriodRange[];
  registeredAt?: string | Date | null;
};

export type ReportTimelineEvent = {
  date: string;
  text: string;
  kind: "add" | "return" | "reset" | "deduct";
  balanceAfter: number | null;
};

function reportOpportunityCount(amount: number): string {
  return amount === 0 ? "0 من الفرص" : amount === 1 ? "فرصة واحدة"
    : amount === 2 ? "فرصتين" : `${amount} فرص`;
}

function reportWholeNumber(value: unknown): number | null {
  const amount = reportNumber(value);
  return amount !== null && Number.isSafeInteger(amount) ? amount : null;
}

function reportPledgeRecorded(log: Record<string, unknown>): boolean {
  const reason = studentReportText(log.reason).normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآٱ]/g, "ا");
  if (/(?:بدون|دون|لا يوجد|عدم|الغاء)\s+(?:ال)?تعهد|لم\s+(?:يتعهد|يتم\s+(?:قبول\s+)?(?:ال)?تعهد)|تعهد\s+غير\s+مقبول/.test(reason)) return false;
  return log.action === "رصيد بعد تعهد" || /تعهد/.test(reason);
}

/** Match an effect produced by the accounting engine on this profile snapshot.
 * Stored command balances belong to entry time; they are NOT running balances
 * in the corrected exam chronology. Never fall back to those snapshots. */
function reportCommandEffect(
  log: Record<string, unknown>,
  effects: readonly AcademicOpportunityCommandEffect[],
): AcademicOpportunityCommandEffect | null {
  if (log.ledgerVersion !== 2 || !log.id || !log.studentId || !log.chapterId) return null;
  const matches = effects.filter(effect => effect.logId === log.id &&
    effect.studentId === log.studentId && effect.chapterId === log.chapterId);
  if (matches.length !== 1) return null;
  const effect = matches[0];
  if ([effect.balanceBefore, effect.balanceAfter, effect.amount, effect.cap]
    .some(value => typeof value !== "number" || reportWholeNumber(value) === null)) return null;
  const recorded = reportWholeNumber(log.appliedAmount ?? log.amount);
  if (recorded === null) return null;
  const expected = log.action === "إضافة"
    ? Math.min(effect.cap, effect.balanceBefore + recorded)
    : Math.max(0, effect.balanceBefore - recorded);
  return effect.balanceAfter === expected &&
    effect.amount === Math.abs(effect.balanceAfter - effect.balanceBefore) &&
    effect.balanceBefore <= effect.cap && effect.balanceAfter <= effect.cap ? effect : null;
}

/** Present dated commands using effects from the SAME engine that calculates
 * the balance. Older/superseded commands retain only their recorded grant;
 * unknown history never manufactures a running balance. No accounting here. */
export function buildReportTimelineEvents(
  logs: readonly Record<string, unknown>[],
  activeChapterId?: unknown,
  commandEffects: readonly AcademicOpportunityCommandEffect[] = [],
  opportunityLimit?: unknown,
): ReportTimelineEvent[] {
  const chapterId = typeof activeChapterId === "string" ? activeChapterId.trim() : "";
  const ordered = logs.filter(log => {
    const logChapter = String(log.chapterId || "").trim();
    return (!chapterId || !logChapter || chapterId === logChapter) && reportLogDate(log) &&
      log.action !== "خصم تلقائي" && log.action !== "فصل تلقائي" &&
      !String(log.reason || "").startsWith("تلقائي:") &&
      !/حماية P\d+|دون تغيير بتوجيه المالك/.test(String(log.reason || ""));
  }).sort((a, b) => Date.parse(reportLogDate(a)!) - Date.parse(reportLogDate(b)!) ||
    String(a.id || "").localeCompare(String(b.id || "")));
  const targetBalance = (log: Record<string, unknown>) => reportWholeNumber(log.balanceAfter ?? log.amount);
  const isSetter = (log: Record<string, unknown>) =>
    log.action === "إعادة تعيين" || log.action === "رصيد بعد تعهد" || log.action === "رصيد إعادة التفعيل";
  const grants = ordered.filter(log => isSetter(log) && targetBalance(log) !== null);
  const events: ReportTimelineEvent[] = [];
  for (const log of ordered) {
    const action = String(log.action || "").trim();
    const date = reportLogDate(log)!;
    const after = reportWholeNumber(log.balanceAfter);
    const pledge = reportPledgeRecorded(log);
    if (action === "إضافة" || (action === "خصم" && !String(log.examId || "").trim())) {
      const amount = reportWholeNumber(log.appliedAmount ?? log.amount);
      if (amount === null || amount <= 0) continue;
      const kind = action === "إضافة" ? "add" : "deduct";
      const effect = reportCommandEffect(log, commandEffects);
      let text: string;
      if (effect) {
        if (kind === "add" && effect.amount === 0) {
          text = `${pledge ? "بعد قبول التعهّد، " : ""}بقي رصيدك مكتملًا عند ${effect.balanceAfter} فرص (الحد الأعلى لفرص الفصل)`;
        } else {
          text = kind === "add"
            ? `${pledge ? "بعد قبول التعهّد، أضافت الإدارة" : "أضافت الإدارة"} ${reportOpportunityCount(effect.amount)}`
            : `خصمت الإدارة ${reportOpportunityCount(effect.amount)}`;
          text += kind === "add" && effect.amount < amount
            ? ` — ارتفع الرصيد من ${effect.balanceBefore} إلى ${effect.balanceAfter} (الحد الأعلى لفرص الفصل)`
            : ` — أصبح الرصيد ${effect.balanceAfter}`;
        }
      } else {
        // A retained historical grant is evidence of the command, not proof
        // of its effective increment after later result corrections.
        text = kind === "add"
          ? `${pledge ? "بعد قبول التعهّد، سُجّل منح" : "سُجّل منح"} ${reportOpportunityCount(amount)}`
          : `خصمت الإدارة ${reportOpportunityCount(amount)}`;
        const limit = reportWholeNumber(opportunityLimit);
        if (kind === "add" && limit !== null) text += ` (بحدّ أقصى ${limit} للرصيد)`;
      }
      events.push({ date, text, kind, balanceAfter: effect?.balanceAfter ?? null });
    } else if (isSetter(log)) {
      const balance = targetBalance(log);
      if (balance === null) continue;
      const count = reportOpportunityCount(balance);
      const returning = action === "رصيد بعد تعهد" || action === "رصيد إعادة التفعيل";
      const chapterStart = action === "إعادة تعيين" && /انتقال|تحويل فصل/.test(String(log.reason || ""));
      const text = chapterStart ? `بدأ حساب فرص الفصل برصيد ${count}`
        : returning ? pledge ? `تم قبول التعهّد وإعادة تفعيلك برصيد ${count}` : `أُعيد تفعيلك برصيد ${count}`
        : pledge ? `بعد قبول التعهّد، حُدّد رصيدك بـ ${count}` : `حدّدت الإدارة رصيدك بـ ${count}`;
      events.push({ date, text, kind: returning ? "return" : "reset", balanceAfter: balance });
    } else if (action === "إعادة تفعيل" || action === "إعادة تفعيل بفرصتين") {
      // The same recovery writes a status row and a balance row, sometimes
      // milliseconds apart. Keep the grant, which carries the actual balance.
      const paired = grants.some(grant =>
        Math.abs(Date.parse(reportLogDate(grant)!) - Date.parse(date)) <= 1000 &&
        (!log.chapterId || !grant.chapterId || log.chapterId === grant.chapterId) &&
        (after === null || after === targetBalance(grant)));
      if (paired) continue;
      const legacyTwo = action === "إعادة تفعيل بفرصتين" || (pledge && /فرصتين/.test(String(log.reason || "")));
      const balance = after ?? (legacyTwo ? 2 : null);
      const text = pledge ? "تم قبول التعهّد وإعادة تفعيلك" : "أُعيد تفعيلك";
      events.push({ date, text: text + (balance === null ? "" : ` برصيد ${reportOpportunityCount(balance)}`), kind: "return", balanceAfter: balance });
    }
  }
  return events;
}

/** Keep the exam's real day and use same-day balance movements only to
 * resolve a date-only exam's position within that day. */
export function reportGradeTimelineDate(
  grade: Record<string, unknown>,
  exam: Record<string, unknown> | undefined,
  events: readonly ReportTimelineEvent[],
): string {
  const examDate = reportLogDate({ date: exam?.date });
  const enteredDate = reportLogDate({ date: grade.createdAt });
  if (!examDate) return enteredDate || "";
  if (!enteredDate) return examDate;
  return examResultTimelineDate(examDate, enteredDate, events
    .filter(event => event.kind !== "deduct" && (event.kind !== "return" || event.balanceAfter !== null))
    .map(event => event.date));
}

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
    if (score === null) return "بانتظار الدرجة";
    const full = reportNumber(exam?.fullMark);
    const pass = reportNumber(exam?.passMark);
    return full !== null && score === full ? "الدرجة كاملة" : pass === null ? "درجة مسجّلة" : score >= pass ? "ناجح" : "أقل من درجة النجاح";
  }
  // The retired grace placeholder is not a result: it records nothing.
  return ({ "غائب": "غياب", "غش": "غش", "مجاز": "إجازة", [GRACE_PERIOD_EXCUSE_LABEL]: "مجاز", "قبل تسجيل الطالب": "قبل تسجيلك" } as Record<string, string>)[status] || "بانتظار الدرجة";
}

export type ReportGradeTone = "ordinary" | "excused" | "deducted" | "dismissed";
export type ReportGradePresentation = { text: string; tone: ReportGradeTone };

/** Text and row emphasis use the same recorded ledger. Ordinary callers see
 * the effective balance; historical reports retain effects before a grant. */
export function reportGradePresentation(grade: Record<string, unknown>, exam: Record<string, unknown> | undefined, logs: Record<string, unknown>[], context?: ReportOpportunityContext): ReportGradePresentation {
  const settlement = context?.settlement;
  const settledGrade = Boolean(settlement && typeof grade.id === "string" && settlement.settledGradeIds.has(grade.id));
  const effectiveLogs = settlement && !context?.historical ? logs.filter(log => {
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
  const dismissals = effectiveLogs.filter(l => String(l.action || "").startsWith("فصل"));
  const dismissed = dismissals.length > 0;
  const dismissalDates = dismissals.map(reportLogDate);
  // Calling a dismissal historical requires both the current active status
  // and a completed return after every recorded dismissal for this exam.
  // Missing dates cannot establish that order, and a later new dismissal
  // must not be explained away by an earlier return.
  const historicalDismissal = Boolean(context?.historical && context.studentStatus === "نشط" &&
    dismissed && dismissalDates.every(date => date !== null) &&
    context.reactivationDates?.some(value => {
      const date = reportLogDate({ date: value });
      return date !== null && dismissalDates.every(dismissalDate => Date.parse(date) > Date.parse(dismissalDate!));
    }));
  const deductionText = deducted === 1
    ? "خُصمت فرصة"
    : deducted === 2
      ? "خُصمت فرصتان"
      : deducted > 0 ? `خُصمت ${deducted} فرص` : "";
  if (deducted || dismissed) return {
    text: [deductionText, dismissed
      ? historicalDismissal ? "سُجّل فصل سابقاً بسبب هذا الامتحان" : "سُجّل فصل بسبب هذا الامتحان"
      : ""].filter(Boolean).join(". "),
    tone: dismissed ? "dismissed" : "deducted",
  };
  const gracePeriod = findStudentGracePeriod(context?.gracePeriods, exam?.date as string | Date | null | undefined);
  const withoutPenalty = (text: string): ReportGradePresentation => ({
    text, tone: grade.status === "مجاز" || gracePeriod ? "excused" : "ordinary",
  });
  if (settledGrade && !context?.historical) return withoutPenalty("لا خصم (قبل رصيدك الجديد)");
  if (grade.status === "قبل تسجيل الطالب" || !isExamOnOrAfterStudentRegistration(
    { createdAt: context?.registeredAt },
    { date: exam?.date as string | Date | null | undefined },
  )) return withoutPenalty("قبل تسجيل الطالب");
  if (grade.academicEffectExcluded) return withoutPenalty("لا خصم");
  if (grade.status === "مجاز") return withoutPenalty("لا خصم");
  if (gracePeriod) {
    const [year, month, day] = gracePeriod.endDate.split("-").map(Number);
    return withoutPenalty(`بدون خصم (فترة سماح لغاية ${day}-${month}-${year})`);
  }
  if (reportNumber(grade.score) === null && grade.status !== "غائب" && grade.status !== "غش") return withoutPenalty("—");
  if (exam?.noDiscount) return withoutPenalty("امتحان بدون خصم");
  if (settledGrade && context?.historical) {
    const score = reportNumber(grade.score);
    const discountMark = reportNumber(exam?.discountMark);
    const dismissalGrade = reportNumber(exam?.dismissalGrade);
    const passMark = reportNumber(exam?.passMark);
    const mayHavePenalty = grade.status === "غائب" || grade.status === "غش" ||
      (score !== null && (exam?.type === "فاينل"
        ? score === 0 || (dismissalGrade !== null && score <= dismissalGrade)
        : discountMark !== null ? score <= discountMark : passMark !== null && score < passMark));
    // A threshold can identify a missing historical explanation, but cannot
    // establish that any opportunities were actually deducted.
    if (mayHavePenalty) return withoutPenalty("لا يوجد خصم مسجّل");
  }
  return withoutPenalty("لا خصم");
}

export function reportGradeEffect(grade: Record<string, unknown>, exam: Record<string, unknown> | undefined, logs: Record<string, unknown>[], context?: ReportOpportunityContext): string {
  return reportGradePresentation(grade, exam, logs, context).text;
}
