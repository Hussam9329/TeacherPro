/**
 * A manual opportunity command and its documented undo («تراجع موثق عن …»,
 * linked by reversalOfLogId or [undo-ref:<id>]) that cancel each other out
 * were a mistake and its correction: a student's file shows neither. The
 * engine is untouched; this is display only. A pair is hidden only when the
 * two moved the same number of opportunities in opposite directions, so the
 * rest of the record still adds up.
 */
type PairLog = {
  id?: unknown;
  action?: unknown;
  amount?: unknown;
  appliedAmount?: unknown;
  reason?: unknown;
  examId?: unknown;
  reversalOfLogId?: unknown;
};

function undoneLogId(log: PairLog): string {
  const linked = String(log.reversalOfLogId ?? "").trim();
  if (linked) return linked;
  return String(log.reason ?? "").match(/\[undo-ref:([^\]]+)\]/u)?.[1]?.trim() || "";
}

function moved(log: PairLog): number {
  const value = Number(log.appliedAmount ?? log.amount);
  return Number.isFinite(value) ? Math.abs(value) : NaN;
}

function direction(log: PairLog): 1 | -1 | 0 {
  const action = String(log.action ?? "").trim();
  if (action === "إضافة") return 1;
  if (action === "خصم") return -1;
  return 0;
}

export function cancelledManualPairIds(logs: readonly PairLog[]): Set<string> {
  const byId = new Map<string, PairLog>();
  for (const log of logs) {
    const id = String(log.id ?? "").trim();
    if (id) byId.set(id, log);
  }
  const hidden = new Set<string>();
  for (const undo of logs) {
    const undoId = String(undo.id ?? "").trim();
    const originalId = undoneLogId(undo);
    const original = originalId ? byId.get(originalId) : undefined;
    if (!undoId || !original || hidden.has(originalId)) continue;
    if (String(undo.examId ?? "").trim() || String(original.examId ?? "").trim()) continue;
    const undoDirection = direction(undo);
    if (!undoDirection || undoDirection !== -direction(original)) continue;
    if (!(moved(undo) > 0) || moved(undo) !== moved(original)) continue;
    hidden.add(undoId);
    hidden.add(originalId);
  }
  return hidden;
}

/** The logs a student's file shows: without mistaken commands and their undo. */
export function withoutCancelledManualPairs<T extends PairLog>(logs: readonly T[]): T[] {
  const hidden = cancelledManualPairIds(logs);
  return hidden.size ? logs.filter((log) => !hidden.has(String(log.id ?? "").trim())) : [...logs];
}
