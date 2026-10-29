/** The word added to a withdrawn student's name: «حسام خليل» → «حسام خليل انسحاب». */
export const WITHDRAWAL_WORD = "انسحاب";

/** The name with «انسحاب» at its end, added once. */
export function withdrawnStudentName(name: string): string {
  const trimmed = name.trim();
  return new RegExp(`(^|\\s)${WITHDRAWAL_WORD}$`).test(trimmed) ? trimmed : `${trimmed} ${WITHDRAWAL_WORD}`;
}

/** The name without the «انسحاب» that withdrawal added, or null when it has none. */
export function unwithdrawnStudentName(name: string): string | null {
  const trimmed = name.trim();
  const match = new RegExp(`\\s+${WITHDRAWAL_WORD}$`).exec(trimmed);
  return match ? trimmed.slice(0, match.index).trim() || null : null;
}

/**
 * The state the student held before withdrawal archived them. Withdrawal keeps
 * the dismissal reason, and every return to «نشط» clears it, so a stored
 * reason means the student was dismissed.
 */
export function statusBeforeWithdrawal(student: { dismissalReason?: string | null }): "نشط" | "مفصول" {
  return String(student.dismissalReason || "").trim() ? "مفصول" : "نشط";
}
