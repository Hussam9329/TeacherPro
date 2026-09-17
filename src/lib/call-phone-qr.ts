import { toLatinDigits } from "@/lib/format";

/**
 * Return the international Iraqi number used by phone dialers.
 * Student phone inputs are validated elsewhere as 11-digit numbers beginning
 * with 07, but this stays defensive for historical rows.
 */
export function callPhoneDialNumber(phone: string | null | undefined): string {
  const digits = toLatinDigits(String(phone || "")).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00964")) return `+${digits.slice(2)}`;
  if (digits.startsWith("07")) return `+964${digits.slice(1)}`;
  if (digits.startsWith("964")) return `+${digits}`;
  return digits;
}

/** Encode a phone handoff that opens the scanner device's dialer. */
export function callPhoneQrValue(phone: string | null | undefined): string {
  const dialNumber = callPhoneDialNumber(phone);
  return dialNumber ? `tel:${dialNumber}` : "";
}
