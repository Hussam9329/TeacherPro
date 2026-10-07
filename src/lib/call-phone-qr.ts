import { toLatinDigits } from "@/lib/format";

/**
 * The number the scanning phone dials, in the local form the system stores
 * (07XXXXXXXXX). An international +964 number made Android dialers show
 * «+964» in front, which read as extra digits; every phone in Iraq dials the
 * local form. Older rows saved as 00964 / 964 / +964 / without the 0 are
 * brought to the same form.
 */
export function callPhoneDialNumber(phone: string | null | undefined): string {
  const digits = toLatinDigits(String(phone || "")).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00964")) return `0${digits.slice(5)}`;
  if (digits.startsWith("964")) return `0${digits.slice(3)}`;
  if (digits.startsWith("7") && digits.length === 10) return `0${digits}`;
  return digits;
}

/** Encode a phone handoff that opens the scanner device's dialer. */
export function callPhoneQrValue(phone: string | null | undefined): string {
  const dialNumber = callPhoneDialNumber(phone);
  return dialNumber ? `tel:${dialNumber}` : "";
}
