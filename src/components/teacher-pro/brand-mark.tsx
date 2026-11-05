import { cn } from "@/lib/utils";

const BRAND_NAME = "TeacherPro";
const PRO_AT = BRAND_NAME.length - 3;

/**
 * The TeacherPro logo: the name alone, «Teacher» then «Pro» in white on a
 * terracotta tile, over a soft green arc. There is no symbol; the browser tab
 * shows a plain green tile (public/logo.svg) beside the title «TeacherPro».
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("tp-wordmark", className)} dir="ltr">
      <span className="tp-wordmark__teacher">{BRAND_NAME.slice(0, PRO_AT)}</span>
      <span className="tp-wordmark__pro">{BRAND_NAME.slice(PRO_AT)}</span>
    </span>
  );
}
