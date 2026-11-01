"use client";

import { copyText, mzCodeActionUrl, mzPlatformPhone, type MzCodeAction } from "@/lib/code-closure-contact";
import { toast } from "@/lib/user-toast";

/**
 * Asked of the «TeacherPro · مرماز بالخلفية» userscript (Tampermonkey): open
 * the platform in a background tab so the focus stays on TeacherPro. A page
 * cannot do that itself. The detail is the URL as a plain string, which
 * crosses into the userscript's world; the script cancels the event when it
 * opened the tab.
 */
export const MZ_BACKGROUND_TAB_EVENT = "teacherpro:open-background-tab";

function openInBackgroundTab(url: string): boolean {
  if (typeof document === "undefined" || typeof document.dispatchEvent !== "function" || typeof CustomEvent !== "function") {
    return false;
  }
  return !document.dispatchEvent(new CustomEvent(MZ_BACKGROUND_TAB_EVENT, { detail: url, cancelable: true }));
}

/**
 * ☢️ and its green twin: copy the student's phone, then open the platform
 * asking «أداة مرماز» to close or open the code. Copy first: the new tab takes
 * the focus the clipboard needs. The copy stays for whoever has no tool.
 * With the background-tab userscript the tab opens behind TeacherPro;
 * without it, as a normal new tab.
 */
export function openMzCodePage(
  student: { name: string; phone?: string | null },
  action: MzCodeAction,
  button: Element,
) {
  const phone = mzPlatformPhone(student.phone);
  const copying = phone ? copyText(phone, button) : Promise.resolve(false);
  const url = mzCodeActionUrl(action, phone, student.name);
  if (!openInBackgroundTab(url)) window.open(url, "_blank", "noopener,noreferrer");
  if (!phone) {
    toast.error(`ماكو رقم هاتف صالح للطالب ${student.name}؛ ابحث عنه بالاسم في المنصة.`);
    return;
  }
  void copying.then((copied) => {
    if (copied) toast.success(`نُسخ رقم الطالب ${phone}`);
    else toast.error(`تعذر النسخ تلقائياً. رقم الطالب: ${phone}`);
  });
}
