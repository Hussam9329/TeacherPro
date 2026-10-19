import type { Prisma } from "@prisma/client";
import { normalizePhoneQuery, toLatinDigits } from "@/lib/format";
import { normalizeArabicText } from "@/lib/route-helpers";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";

/**
 * How every page finds a student by what the user types: name (also through
 * its normalized key, so ة/ه, أ/إ/آ/ا, ى/ي and tashkeel never decide it), code
 * (Arabic or English digits, «7» finds BIO-007), school, Telegram username,
 * and the student's or parent's phone (a number pasted as +964 / 00964 finds
 * the stored 07…). One list of conditions, so a student found on one page is
 * found on all of them.
 */
export function studentIdentitySearchConditions(
  rawQuery: string,
): Prisma.StudentWhereInput[] | null {
  const query = rawQuery.trim();
  if (!query) return null;
  // Codes and usernames are stored in English digits; «٤٥» finds «45».
  const latin = toLatinDigits(query);
  const normalized = normalizeArabicText(query);
  const phone = normalizePhoneQuery(query);
  // Telegram is searched by the recovered username («@ali» finds «ali»),
  // never by the numeric Telegram id.
  const username = normalizeTelegramIdentifier(query);

  const or: Prisma.StudentWhereInput[] = [
    { name: { contains: query, mode: "insensitive" } },
    { code: { startsWith: latin, mode: "insensitive" } },
    { school: { contains: query, mode: "insensitive" } },
  ];
  if (username) or.push({ username: { contains: username, mode: "insensitive" } });
  if (normalized) or.push({ nameKey: { contains: normalized, mode: "insensitive" } });

  // The number alone finds the code: «٩٠٠١» or «9001» → BIO-9001, «7» → BIO-007.
  if (/^\d{1,9}$/.test(latin)) {
    or.push({ code: { endsWith: `-${latin.padStart(3, "0")}`, mode: "insensitive" } });
  }

  // Phones from three digits on: «0» or «07» alone would match everyone.
  if (phone.length >= 3) {
    or.push(
      { phone: { startsWith: phone } },
      { phoneKey: { startsWith: phone } },
      { parentPhone: { startsWith: phone } },
    );
    if (phone.length >= 7) {
      or.push(
        { phone: { contains: phone } },
        { phoneKey: { contains: phone } },
        { parentPhone: { contains: phone } },
      );
    }
  }

  return or;
}
