/**
 * Phone matching for the student app login, a line-for-line port of the
 * Telegram bot's `phone_digits`, `normalize_phone`, `phone_match_ranks` and
 * `find_students_by_phone` (TeleBot bot.py). Both clients must resolve the
 * same student for the same typed number.
 */

export type StudentPhoneMatch = {
  id: string;
  name: string;
  code: string;
  status: string;
  phone: string | null;
  phoneKey: string | null;
  parentPhone: string | null;
};

export type PhoneMatchClient = {
  student: {
    findMany(args: {
      where: Record<string, { in: string[] }>;
      orderBy: Array<Record<string, "asc" | "desc">>;
      select: Record<keyof StudentPhoneMatch, true>;
    }): Promise<StudentPhoneMatch[]>;
  };
};

const DIGIT_MAP: Record<string, string> = {};
for (const [index, ch] of [..."٠١٢٣٤٥٦٧٨٩"].entries()) DIGIT_MAP[ch] = String(index);
for (const [index, ch] of [..."۰۱۲۳۴۵۶۷۸۹"].entries()) DIGIT_MAP[ch] = String(index);

const STRIP = /[\s().\-؜‎‏‪-‮⁦-⁩]/g;

export function phoneDigits(phone: string): string {
  const translated = [...String(phone ?? "")].map((ch) => DIGIT_MAP[ch] ?? ch).join("");
  const clean = translated.replace(STRIP, "");
  return /^\+?[0-9]+$/.test(clean) ? clean.replace(/^\+/, "") : "";
}

export function normalizeIraqiPhone(phone: string): string {
  const clean = phoneDigits(phone);
  const iraqi = /^(?:00964|964|0)?(7[0-9]{9})$/.exec(clean);
  return iraqi ? `0${iraqi[1]}` : clean;
}

export function phoneMatchRanks(phone: string): Map<string, number> {
  const digits = phoneDigits(phone);
  const ranks = new Map<string, number>();
  if (!digits) return ranks;
  const groups: Set<string>[] = [new Set([digits, `+${digits}`, String(phone ?? "").trim()])];
  if (digits.startsWith("00") && digits.length > 2) {
    groups.push(new Set([digits.slice(2), `+${digits.slice(2)}`]));
  } else if (!digits.startsWith("0")) {
    groups.push(new Set([`00${digits}`]));
  }
  const iraqi = normalizeIraqiPhone(phone);
  if (/^07[0-9]{9}$/.test(iraqi)) {
    const local = iraqi.slice(1);
    groups.push(new Set([iraqi, local, `964${local}`, `+964${local}`, `00964${local}`]));
  }
  groups.forEach((values, rank) => {
    for (const value of [...values].sort()) {
      if (!ranks.has(value)) ranks.set(value, rank);
    }
  });
  return ranks;
}

const SELECT = {
  id: true, name: true, code: true, status: true, phone: true, phoneKey: true, parentPhone: true,
} as const;

export async function findStudentsByPhone(
  client: PhoneMatchClient,
  ranks: Map<string, number>,
): Promise<StudentPhoneMatch[]> {
  const values = [...ranks.keys()];
  if (values.length === 0) return [];
  const query = (field: "phoneKey" | "phone" | "parentPhone") =>
    client.student.findMany({
      where: { [field]: { in: values } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: SELECT,
    });
  const rankOf = (value: string | null) => ranks.get(value ?? "") ?? Number.POSITIVE_INFINITY;

  const keyed = await query("phoneKey");
  const exact = keyed.filter((s) => rankOf(s.phoneKey) === 0);
  if (exact.length) return exact;

  const raw = await query("phone");
  const matches = [
    ...keyed.map((s) => ({ rank: rankOf(s.phoneKey), source: 0, student: s })),
    ...raw.map((s) => ({ rank: rankOf(s.phone), source: 1, student: s })),
  ];
  if (matches.length) {
    const best = matches.reduce((acc, m) =>
      m.rank < acc.rank || (m.rank === acc.rank && m.source < acc.source) ? m : acc);
    return matches
      .filter((m) => m.rank === best.rank && m.source === best.source)
      .map((m) => m.student);
  }

  const parents = await query("parentPhone");
  if (!parents.length) return [];
  const bestRank = Math.min(...parents.map((s) => rankOf(s.parentPhone)));
  return parents.filter((s) => rankOf(s.parentPhone) === bestRank);
}
