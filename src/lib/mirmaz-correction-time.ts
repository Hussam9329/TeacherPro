/** When the corrector sent the paper and how long the correction took; null = Mirmaz Pro did not say. */
export type MirmazCorrectionTime = { correctedAt: Date | null; correctionSeconds: number | null };

const MAX_CORRECTION_SECONDS = 6 * 60 * 60;
const CLOCK_SLACK_MS = 5 * 60 * 1000;

/** Reads `correctedAt` (ISO) and `durationSeconds` from the grade's body; anything not believable is left out. */
export function readCorrectionTime(body: Record<string, unknown> | null, now = new Date()): MirmazCorrectionTime {
  const at = typeof body?.correctedAt === "string" ? new Date(body.correctedAt) : null;
  const seconds = body?.durationSeconds;
  return {
    correctedAt: at && !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime() + CLOCK_SLACK_MS ? at : null,
    correctionSeconds: typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 0 && seconds <= MAX_CORRECTION_SECONDS ? seconds : null,
  };
}

/** The columns to write: a grade that comes without them keeps what an earlier arrival of the same paper said. */
export const correctionTimeData = (time: MirmazCorrectionTime) => ({
  ...(time.correctedAt ? { correctedAt: time.correctedAt } : {}),
  ...(time.correctionSeconds !== null ? { correctionSeconds: time.correctionSeconds } : {}),
});
