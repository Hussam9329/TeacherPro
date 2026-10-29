"use client";

import { copyText, mzCodeActionUrl, mzPlatformPhone, type MzCodeAction } from "@/lib/code-closure-contact";
import { toast } from "@/lib/user-toast";

/**
 * ☢️ and its green twin: copy the student's phone, then open the platform
 * asking «أداة مرماز» to close or open the code. Copy first: the new tab takes
 * the focus the clipboard needs. The copy stays for whoever has no tool.
 */
export function openMzCodePage(
  student: { name: string; phone?: string | null },
  action: MzCodeAction,
  button: Element,
) {
  const phone = mzPlatformPhone(student.phone);
  const copying = phone ? copyText(phone, button) : Promise.resolve(false);
  window.open(mzCodeActionUrl(action, phone, student.name), "_blank", "noopener,noreferrer");
  if (!phone) {
    toast.error(`ماكو رقم هاتف صالح للطالب ${student.name}؛ ابحث عنه بالاسم في المنصة.`);
    return;
  }
  void copying.then((copied) => {
    if (copied) toast.success(`نُسخ رقم الطالب ${phone}`);
    else toast.error(`تعذر النسخ تلقائياً. رقم الطالب: ${phone}`);
  });
}
