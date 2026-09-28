"use client";

import type { ReactNode } from "react";
import { Phone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { callPhoneQrValue } from "@/lib/call-phone-qr";

type CallPhoneQrProps = {
  studentName: string;
  phoneLabel: string;
  phone: string | null | undefined;
  /** Optional icon before the label (the calls card's tiles use one). */
  icon?: ReactNode;
  /** Replaces the default look; the calls card styles its own tiles. */
  className?: string;
};

export function CallPhoneQr({
  studentName,
  phoneLabel,
  phone,
  icon,
  className,
}: CallPhoneQrProps) {
  const qrValue = callPhoneQrValue(phone);
  if (!qrValue) return null;

  const accessibleTitle = `رمز اتصال ${phoneLabel} للطالب ${studentName}`;

  return (
    <a
      href={qrValue}
      aria-label={accessibleTitle}
      className={className || "flex min-w-0 flex-col items-center gap-2 rounded-xl border bg-background p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold" data-part="label">{icon}{phoneLabel}</span>
      <QRCodeSVG
        value={qrValue}
        size={128}
        level="M"
        marginSize={4}
        fgColor="#0E1F36"
        bgColor="#FBF9EB"
        title={accessibleTitle}
        className="h-auto w-full max-w-32 rounded-lg bg-tp-bg"
      />
      <span className="inline-flex max-w-full items-center gap-1 break-all font-mono text-xs" data-part="phone" dir="ltr">
        {className ? <Phone aria-hidden="true" className="size-3.5 shrink-0" /> : null}
        {phone}
      </span>
    </a>
  );
}
