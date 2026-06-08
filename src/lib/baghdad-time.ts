const BAGHDAD_OFFSET_HOURS = 3;
const BAGHDAD_OFFSET_MS = BAGHDAD_OFFSET_HOURS * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function hasExplicitOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

function matchDateTimeLocal(value: string) {
  return value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2})?)?/);
}

/**
 * Parse a scheduler value as Baghdad civil time when it has no explicit timezone.
 * datetime-local inputs like 2026-06-08T15:50 are Baghdad time, not server time.
 */
export function parseBaghdadDateTime(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;

  if (!hasExplicitOffset(raw)) {
    const match = matchDateTimeLocal(raw);
    if (match) {
      const [, year, month, day, hour = '00', minute = '00'] = match;
      const utc = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour) - BAGHDAD_OFFSET_HOURS,
        Number(minute),
        0,
        0,
      );
      const date = new Date(utc);
      return Number.isFinite(date.getTime()) ? date : null;
    }
  }

  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Convert any stored instant to a datetime-local value in Baghdad time. */
export function toBaghdadDateTimeLocal(value?: string | Date | null): string {
  if (!value) return '';
  const raw = value instanceof Date ? '' : String(value).trim();
  if (raw && !hasExplicitOffset(raw) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    return raw.slice(0, 16);
  }
  if (raw && !hasExplicitOffset(raw) && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00`;
  }

  const date = parseBaghdadDateTime(value);
  if (!date) return '';
  const baghdad = new Date(date.getTime() + BAGHDAD_OFFSET_MS);
  return `${baghdad.getUTCFullYear()}-${pad(baghdad.getUTCMonth() + 1)}-${pad(baghdad.getUTCDate())}T${pad(baghdad.getUTCHours())}:${pad(baghdad.getUTCMinutes())}`;
}

export function formatBaghdadDateTime(value?: string | Date | null): string {
  const local = toBaghdadDateTimeLocal(value);
  if (!local) return '—';
  const [date, time] = local.split('T');
  return `${date} ${time}`;
}
