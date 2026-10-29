/**
 * «سجل الامتحانات»: the per-exam numbers, cached by exam id. Only exams on
 * screen are requested; a search or filter reuses what is already loaded, and
 * a data change marks every loaded exam stale, so the ones on screen refresh
 * at once and the rest when they are scrolled to. A stale number stays shown
 * until its refresh arrives.
 */
export type ExamStatState = "loading" | "stale" | "fresh" | "missing";

export class ExamStatsCache<T> {
  private readonly values = new Map<string, T>();
  private readonly missing = new Set<string>();
  private readonly stale = new Set<string>();
  /** In-flight requests: exam id → the generation that asked for it. */
  private readonly pending = new Map<string, number>();
  /** Failed requests: not asked again until the next data change. */
  private readonly failed = new Map<string, number>();
  private generation = 0;

  /** Data changed somewhere: everything loaded or in flight is out of date. */
  invalidate(): void {
    this.generation += 1;
    for (const id of this.values.keys()) this.stale.add(id);
    for (const id of this.pending.keys()) this.stale.add(id);
    this.missing.clear();
  }

  /** The ids among `wanted` that need a request now; they become pending. */
  take(wanted: Iterable<string>): { ids: string[]; generation: number } {
    const ids: string[] = [];
    for (const id of new Set(wanted)) {
      if (!id || this.pending.get(id) === this.generation || this.failed.get(id) === this.generation) continue;
      const needed = this.stale.has(id) || (!this.values.has(id) && !this.missing.has(id));
      if (!needed) continue;
      this.pending.set(id, this.generation);
      ids.push(id);
    }
    return { ids, generation: this.generation };
  }

  /** A request finished: `result` is null when it failed. */
  resolve(ids: readonly string[], generation: number, result: Record<string, T> | null): void {
    const current = generation === this.generation;
    for (const id of ids) {
      if (this.pending.get(id) === generation) this.pending.delete(id);
      if (result && Object.prototype.hasOwnProperty.call(result, id)) {
        this.values.set(id, result[id]);
        this.missing.delete(id);
      } else if (result) {
        // The server has no numbers for it (removed, or outside the scope).
        // An answer from before a data change is asked again instead.
        if (!current) continue;
        this.values.delete(id);
        this.missing.add(id);
      } else {
        // A failed request keeps a shown number (still stale); otherwise it
        // shows «—». Either way it is asked again on the next data change.
        this.failed.set(id, generation);
        if (current && !this.values.has(id)) this.missing.add(id);
        continue;
      }
      if (current) this.stale.delete(id);
    }
  }

  value(id: string): T | undefined {
    return this.values.get(id);
  }

  state(id: string): ExamStatState {
    if (this.values.has(id)) return this.stale.has(id) ? "stale" : "fresh";
    if (this.missing.has(id)) return "missing";
    return "loading";
  }
}

export function chunkIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}
