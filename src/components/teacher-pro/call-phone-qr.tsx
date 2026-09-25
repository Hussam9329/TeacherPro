"use client";

import { QRCodeSVG } from "qrcode.react";
import { callPhoneQrValue } from "@/lib/call-phone-qr";

type CallPhoneQrProps = {
  studentName: string;
  phoneLabel: string;
  phone: string | null | undefined;
};

export function CallPhoneQr({
  studentName,
  phoneLabel,
  phone,
}: CallPhoneQrProps) {
  const qrValue = callPhoneQrValue(phone);
  if (!qrValue) return null;

  const accessibleTitle = `رمز اتصال ${phoneLabel} للطالب ${studentName}`;

  return (
    <a
      href={qrValue}
      aria-label={accessibleTitle}
      className="flex min-w-0 flex-col items-center gap-2 rounded-xl border bg-background p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-xs font-semibold">{phoneLabel}</span>
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
      <span className="max-w-full break-all font-mono text-xs" dir="ltr">{phone}</span>
    </a>
  );
}
