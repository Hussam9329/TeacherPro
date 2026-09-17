"use client";

import { QrCode, PhoneCall } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { callPhoneDialNumber, callPhoneQrValue } from "@/lib/call-phone-qr";

type CallPhoneQrDialogProps = {
  studentName: string;
  phoneLabel: string;
  phone: string | null | undefined;
};

export function CallPhoneQrDialog({
  studentName,
  phoneLabel,
  phone,
}: CallPhoneQrDialogProps) {
  const qrValue = callPhoneQrValue(phone);
  const dialNumber = callPhoneDialNumber(phone);
  if (!qrValue || !dialNumber) return null;

  const accessibleTitle = `رمز اتصال ${phoneLabel} للطالب ${studentName}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 rounded-xl px-3 text-xs"
          title={accessibleTitle}
        >
          <QrCode className="size-4" aria-hidden="true" />
          QR {phoneLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{accessibleTitle}</DialogTitle>
          <DialogDescription>
            امسح الرمز بكاميرا الهاتف لفتح تطبيق المكالمات والرقم مجهز
            للاتصال.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          <div className="max-w-full rounded-3xl border bg-white p-3 shadow-sm">
            <QRCodeSVG
              value={qrValue}
              size={256}
              level="M"
              marginSize={4}
              title={accessibleTitle}
              className="h-auto w-full max-w-64"
            />
          </div>
          <div className="w-full rounded-2xl border bg-muted/30 px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground">{phoneLabel}</p>
            <p className="mt-1 font-mono text-lg font-black" dir="ltr">
              {phone}
            </p>
          </div>
          <p className="text-center text-xs leading-5 text-muted-foreground">
            نظام الهاتف سيطلب تأكيدك قبل بدء المكالمة.
          </p>
        </div>

        <DialogFooter>
          <Button asChild className="w-full">
            <a href={qrValue}>
              <PhoneCall className="size-4" aria-hidden="true" />
              فتح تطبيق الهاتف على هذا الجهاز
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
