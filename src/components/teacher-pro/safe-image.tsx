"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, ExternalLink, Copy, ImageOff } from "lucide-react";

/**
 * SafeImage — مكوّن موحد لعرض الصور بأمان.
 *
 * المميزات:
 * - lazy loading: لا يحمّل الصورة حتى تظهر في viewport (IntersectionObserver).
 * - timeout: 12 ثانية كحد أقصى لتحميل الصورة، بعدها تظهر واجهة الفشل المؤقت.
 * - retry محدود: أقصى 3 محاولات (المحاولة الأولى + 2 إعادة). بعدها تظهر
 *   واجهة الفشل الدائم بدون retry تلقائي.
 * - fallback UI: عند الفشل، تظهر واجهة بديلة فيها:
 *   - "تعذر تحميل الصورة"
 *   - زر إعادة المحاولة
 *   - زر فتح الصورة في تبويب جديد
 *   - زر نسخ الرابط
 * - لا console loop: كل أخطاء التحميل تُلتقط بصمت، بدون console.error متكرر.
 * - لا تكسر الصفحة: المكوّن معزول، فشل صورة لا يؤثر على غيرها.
 */

const MAX_RETRIES = 3; // المحاولة الأولى + 2 إعادة
const TIMEOUT_MS = 12000; // 12 ثانية

type SafeImageState = "idle" | "loading" | "loaded" | "failed";

export interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
  /** هل يجب استخدام lazy loading؟ افتراضياً true. */
  lazy?: boolean;
  /** نص بديل يظهر في واجهة الفشل (اختياري). */
  failureHint?: string;
  /** callback يُستدعى عند نجاح التحميل (اختياري). */
  onLoad?: () => void;
}

export function SafeImage({
  src,
  alt,
  className = "",
  lazy = true,
  failureHint,
  onLoad,
}: SafeImageProps) {
  const [state, setState] = useState<SafeImageState>("idle");
  const [retryCount, setRetryCount] = useState(0);
  const [inView, setInView] = useState(!lazy);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // --- IntersectionObserver for lazy loading ---
  useEffect(() => {
    if (!lazy || inView) return;
    const el = containerRef.current;
    if (!el) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observerRef.current?.disconnect();
            break;
          }
        }
      },
      { rootMargin: "200px" }, // ابدأ التحميل قبل الظهور بـ 200px
    );
    observerRef.current.observe(el);
    return () => {
      observerRef.current?.disconnect();
    };
  }, [lazy, inView]);

  // --- Cleanup timeout on unmount ---
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // --- Load image ---
  const startLoad = useCallback(() => {
    if (!src) {
      setState("failed");
      return;
    }
    setState("loading");

    // timeout: إذا لم تكتمل الصورة خلال 12 ثانية، اعتبرها فاشلة.
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setState("failed");
    }, TIMEOUT_MS);

    // إذا كانت <img> موجودة، ابدأ التحميل بإعادة تعيين src.
    if (imgRef.current) {
      // إعادة تعيين src لإجابة المتصفح على إعادة المحاولة.
      imgRef.current.src = "";
      imgRef.current.src = src;
    }
  }, [src]);

  // ابدأ التحميل عند الدخول للـ viewport
  useEffect(() => {
    if (inView && state === "idle") {
      startLoad();
    }
  }, [inView, state, startLoad]);

  // --- Handlers ---
  const handleImgLoad = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setState("loaded");
    onLoad?.();
  }, [onLoad]);

  const handleImgError = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // صمت تام — لا console.error لتجنب الإزعاج.
    setState("failed");
  }, []);

  const handleRetry = useCallback(() => {
    if (retryCount >= MAX_RETRIES) return;
    setRetryCount((c) => c + 1);
    setState("idle");
    // أعِد التحميل بعد تأخير قصير للسماح لـ React بإعادة الرسم.
    setTimeout(() => startLoad(), 50);
  }, [retryCount, startLoad]);

  const handleOpenInNewTab = useCallback(() => {
    if (src) window.open(src, "_blank", "noopener,noreferrer");
  }, [src]);

  const handleCopyLink = useCallback(async () => {
    if (!src) return;
    try {
      await navigator.clipboard.writeText(src);
    } catch {
      // قد يفشل clipboard API في بعض المتصفحات؛ تجاهل بصمت.
    }
  }, [src]);

  // --- Render ---
  const maxRetriesReached = retryCount >= MAX_RETRIES;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* الصورة المخفية أثناء التحميل */}
      {state !== "failed" && (
        <img
          ref={imgRef}
          src={inView ? src : undefined}
          alt={alt}
          loading={lazy ? "lazy" : "eager"}
          onLoad={handleImgLoad}
          onError={handleImgError}
          className={`w-full rounded-xl border object-contain bg-muted/30 transition-opacity duration-300 ${
            state === "loaded" ? "opacity-100" : "opacity-0"
          } ${state === "loading" ? "min-h-[200px]" : "max-h-[520px]"}`}
          style={{ display: state === "loaded" || state === "loading" ? "block" : "none" }}
        />
      )}

      {/* شريط التحميل */}
      {state === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/30 text-muted-foreground">
          <RefreshCw className="size-6 animate-spin" />
          <p className="text-xs">جاري تحميل الصورة…</p>
        </div>
      )}

      {/* واجهة الفشل */}
      {state === "failed" && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-6 text-center dark:border-amber-500/40 dark:bg-amber-950/10">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <ImageOff className="size-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
              تعذر تحميل الصورة
            </p>
            {failureHint && (
              <p className="text-xs text-muted-foreground">{failureHint}</p>
            )}
            {retryCount > 0 && (
              <p className="text-xs text-muted-foreground">
                المحاولات: {retryCount} / {MAX_RETRIES}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!maxRetriesReached && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetry}
                className="gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                إعادة المحاولة
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenInNewTab}
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              فتح في تبويب جديد
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyLink}
              className="gap-1.5"
            >
              <Copy className="size-3.5" />
              نسخ الرابط
            </Button>
          </div>
          {maxRetriesReached && (
            <p className="mt-1 text-xs text-muted-foreground">
              تم الوصول للحد الأقصى من المحاولات. حاول فتح الرابط في تبويب جديد.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ExamImageViewer — مكون مخصص لعرض صور الامتحانات والمرفقات.
 * يغلّف SafeImage مع إعدادات افتراضية مناسبة لصور الامتحانات.
 */
export function ExamImageViewer({
  src,
  alt,
  className,
  pageNumber,
}: {
  src: string;
  alt: string;
  className?: string;
  pageNumber?: number;
}) {
  return (
    <SafeImage
      src={src}
      alt={alt}
      className={className || "w-full max-h-[520px]"}
      lazy
      failureHint={
        pageNumber
          ? `صفحة ${pageNumber} — قد يكون المصدر غير متاح أو بطيء.`
          : "قد يكون المصدر غير متاح أو بطيء."
      }
    />
  );
}
