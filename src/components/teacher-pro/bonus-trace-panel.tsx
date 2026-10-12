"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { studentBonusTraceApi } from "@/lib/api";
import { formatAppDate } from "@/lib/format";
import { BONUS_START_DAY } from "@/lib/bonus-opportunity";
import type { AcademicBonusTrace, AcademicBonusTraceKind } from "@/lib/academic-types";

const KIND_LABELS: Record<AcademicBonusTraceKind, { text: string; tone: string }> = {
  first: { text: "نجاح محسوب", tone: "info" },
  earned: { text: "⭐ رجعت فرصة", tone: "good" },
  waiting: { text: "تنتظر درجة", tone: "warn" },
  break: { text: "قطع العدّ", tone: "bad" },
  neutral: { text: "ما يحسب ولا يقطع", tone: "muted" },
  "before-start": { text: "قبل بداية المكافأة", tone: "muted" },
  "before-opening": { text: "قبل بداية العدّ", tone: "muted" },
  full: { text: "ما ينحسب", tone: "warn" },
  limit: { text: "الحد الأعلى", tone: "warn" },
  dismissed: { text: "مفصول", tone: "bad" },
  summary: { text: "الخلاصة", tone: "info" },
};

/**
 * «ليش تكافأ أو ما تكافأ؟»: every «فرصة مكافأة» decision of the current
 * calculation, result by result, from the same replay a recalculation runs.
 */
export function BonusTracePanel({ studentId, refreshKey }: { studentId: string; refreshKey?: unknown }) {
  const [trace, setTrace] = useState<AcademicBonusTrace | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setLoading(true);
    studentBonusTraceApi.get(studentId)
      .then((result) => {
        if (cancelled) return;
        setTrace(result);
        setError("");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "تعذر شرح فرصة المكافأة.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, refreshKey]);

  const stale = trace && (trace.stored.opportunities !== trace.replay.opportunities ||
    trace.stored.bonuses !== trace.replay.bonuses || trace.stored.status !== trace.replay.status);

  return (
    <details className="tp-btrace">
      <summary className="tp-btrace__head">
        <strong>فرصة المكافأة: ليش تكافأ أو ما تكافأ؟</strong>
        {loading && !trace ? (
          <span className="tp-btrace__lead"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> جاري الحساب...</span>
        ) : error ? (
          <span className="tp-btrace__lead" role="alert">{error}</span>
        ) : trace?.summary ? (
          <span className="tp-btrace__lead">{trace.summary.detail}</span>
        ) : null}
      </summary>
      {trace ? (
        <div className="tp-btrace__body">
          <p className="tp-btrace__rule">
            القاعدة: من {formatAppDate(BONUS_START_DAY)}، نجاحين متتاليين بعد آخر غياب أو رسوب يرجّعون فرصة، إذا الرصيد ناقص بسبب الامتحانات (مو بسبب خصم يدوي)، وبحد أعلى فرصتين بالفصل.
          </p>
          <dl className="tp-btrace__facts">
            <div><dt>الفرص المتبقية</dt><dd>{trace.replay.opportunities} من {trace.summary?.cap ?? "—"}</dd></div>
            <div><dt>خصم يدوي ما يرجع</dt><dd>{trace.summary?.hold ?? 0}</dd></div>
            <div><dt>فرص مكافأة بهذا الفصل</dt><dd>{trace.replay.bonuses}</dd></div>
          </dl>
          {stale ? (
            <p className="tp-btrace__stale" role="status">
              المحفوظ ما يطابق الحساب: المحفوظ {trace.stored.opportunities} فرص و{trace.stored.bonuses} مكافأة ({trace.stored.status})،
              والحساب يطلع {trace.replay.opportunities} فرص و{trace.replay.bonuses} مكافأة ({trace.replay.status}). يحتاج إعادة احتساب الطالب.
            </p>
          ) : null}
          {trace.events.length === 0 ? (
            <p className="tp-btrace__rule">ما كو نتائج بهذا الفصل.</p>
          ) : (
            <ol className="tp-btrace__list">
              {trace.events.map((event, index) => {
                const label = KIND_LABELS[event.kind];
                return (
                  <li key={`${event.examId}-${event.kind}-${index}`} className="tp-btrace__row" data-tone={label.tone}>
                    <div className="tp-btrace__title">
                      <strong>{event.examName}</strong>
                      <time dateTime={event.examDate}>{formatAppDate(event.examDate)}</time>
                      <span className="tp-btrace__chip" data-tone={label.tone}>{label.text}</span>
                    </div>
                    <p className="tp-btrace__detail">{event.detail}</p>
                    <small className="tp-btrace__balance">الفرص بهاللحظة {event.balance} من {event.cap}{event.hold ? ` · خصم يدوي محجوز ${event.hold}` : ""}{event.bonusCount ? ` · مكافآت ${event.bonusCount}` : ""}</small>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </details>
  );
}
