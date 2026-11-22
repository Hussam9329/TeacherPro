import { toBaghdadDateTimeLocal } from "./baghdad-time";

/** A «من / إلى» range as the datetime-local inputs give it (Baghdad wall time, "YYYY-MM-DDTHH:mm"); "" = open. */
export type BaghdadTimeRange = { from: string; to: string };

/**
 * Whether a stored moment falls inside a «من / إلى» range read on Baghdad's
 * clock, to the minute and with both ends included. An open end is not a limit.
 */
export function withinBaghdadRange(moment: string | Date | null | undefined, range: BaghdadTimeRange): boolean {
  if (!range.from && !range.to) return true;
  const local = toBaghdadDateTimeLocal(moment);
  if (!local) return false;
  if (range.from && local < range.from.slice(0, 16)) return false;
  if (range.to && local > range.to.slice(0, 16)) return false;
  return true;
}
