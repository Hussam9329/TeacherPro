import { useId } from "react";

const BRAND_NAME = "TeacherPro";

/** «TeacherPro» with «Pro» in the logo's gold. */
export function BrandName({ teacherClassName }: { teacherClassName?: string }) {
  const split = BRAND_NAME.length - 3;
  return (
    <>
      <span className={teacherClassName}>{BRAND_NAME.slice(0, split)}</span>
      <span className="tp-brand-gold">{BRAND_NAME.slice(split)}</span>
    </>
  );
}

/**
 * The TeacherPro mark: a gold graduation cap over a folded gold «T», in a
 * gold-rimmed green-black tile. public/logo.svg is the same drawing (tab icon).
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-tile`} cx="50%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#173a31" />
          <stop offset="100%" stopColor="#071411" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbe6ab" />
          <stop offset="45%" stopColor="#d9ad5c" />
          <stop offset="100%" stopColor="#8f6426" />
        </linearGradient>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fdeebd" />
          <stop offset="55%" stopColor="#e2bb6a" />
          <stop offset="100%" stopColor="#b98536" />
        </linearGradient>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3d185" />
          <stop offset="100%" stopColor="#c08a38" />
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b68134" />
          <stop offset="100%" stopColor="#7e5520" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="14" fill={`url(#${id}-tile)`} stroke={`url(#${id}-rim)`} strokeWidth="2.4" />
      {/* «T»: front face and folded side */}
      <path d="M26 31.2 L33.2 33.4 L33.2 53 L26 50.4 Z" fill={`url(#${id}-front)`} />
      <path d="M33.2 33.4 L39.4 30.8 L39.4 48.6 L33.2 53 Z" fill={`url(#${id}-side)`} />
      {/* cap band */}
      <path d="M20.5 24.6 L20.5 28.6 C20.5 30.6 25.6 32.4 32 32.4 C38.4 32.4 43.5 30.6 43.5 28.6 L43.5 24.6 L32 29 Z" fill={`url(#${id}-side)`} />
      {/* cap board */}
      <path d="M32 12.6 L53 20.6 L32 28.6 L11 20.6 Z" fill={`url(#${id}-top)`} />
      <path d="M32 12.6 L53 20.6" stroke="#fff6d8" strokeOpacity="0.65" strokeWidth="0.8" strokeLinecap="round" />
      {/* tassel */}
      <path d="M14.2 21.6 L14.2 31.2" stroke={`url(#${id}-rim)`} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="14.2" cy="32.6" r="2.1" fill={`url(#${id}-rim)`} />
    </svg>
  );
}
