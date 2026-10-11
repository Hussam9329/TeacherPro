"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { formatAppDate, toLatinDigits } from "@/lib/format";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { callDailyStatsApi, type CallDailyStatsResponse } from "@/lib/call-daily-stats-client";
import { EmptyState, LoadingState } from "./ui-kit";

/** «YYYY-MM-DD» moved by whole days. */
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return next.toISOString().slice(0, 10);
}

function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

type SaveState = { saving?: boolean; error?: string; saved?: boolean };

/**
 * «إحصائيات المكالمات»: one day of calls for the admin and the supervisors —
 * what each employee did and on which courses, and each course against the
 * number it needed that day (entered here, saved on its own).
 */
export function CallsStatsPanel() {
  const [day, setDay] = useState(() => baghdadTodayKey());
  const [data, setData] = useState<CallDailyStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (wanted: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const result = await callDailyStatsApi.get(wanted, controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setDrafts({});
      setSaveState({});
      setError("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "تعذر تحميل إحصائيات المكالمات.");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(day);
    return () => requestRef.current?.abort();
  }, [day, load]);

  const today = data?.today || baghdadTodayKey();

  const saveTarget = async (courseId: string) => {
    if (!data || drafts[courseId] === undefined) return;
    const raw = toLatinDigits(drafts[courseId]).trim();
    const target = raw === "" ? null : Number(raw);
    if (target !== null && (!Number.isInteger(target) || target < 0)) {
      setSaveState((current) => ({ ...current, [courseId]: { error: "اكتب رقم صحيح من 0 فما فوق." } }));
      return;
    }
    const before = data.courses.find((course) => course.id === courseId)?.target ?? null;
    if (target === before) {
      setDrafts(({ [courseId]: _, ...rest }) => rest);
      return;
    }
    setSaveState((current) => ({ ...current, [courseId]: { saving: true } }));
    try {
      const saved = await callDailyStatsApi.setTarget(data.day, courseId, target);
      setData((current) => {
        if (!current) return current;
        const courses = current.courses.map((course) => course.id !== courseId ? course : {
          ...course,
          target: saved.target,
          remaining: Math.max(0, (saved.target || 0) - course.done),
          rate: saved.target ? course.done / saved.target : null,
        });
        const total = courses.reduce((sum, course) => sum + (course.target || 0), 0);
        return {
          ...current,
          courses,
          totals: { ...current.totals, target: total, remaining: Math.max(0, total - current.totals.done), rate: total ? current.totals.done / total : null },
        };
      });
      setDrafts(({ [courseId]: _, ...rest }) => rest);
      setSaveState((current) => ({ ...current, [courseId]: { saved: true } }));
    } catch (cause) {
      setSaveState((current) => ({ ...current, [courseId]: { error: cause instanceof Error ? cause.message : "تعذر الحفظ." } }));
    }
  };

  return (
    <section className="tp-cstats" aria-label="إحصائيات المكالمات">
      <div className="tp-cstats__datebar">
        <button type="button" className="tp-cstats__nav" onClick={() => setDay((value) => shiftDay(value, -1))}>
          <ChevronRight aria-hidden="true" />
          اليوم السابق
        </button>
        <span className="tp-cstats__date">
          <DateInput
            aria-label="التاريخ"
            value={day}
            onChange={(value) => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDay(value); }}
          />
        </span>
        <button type="button" className="tp-cstats__nav" disabled={day >= today} onClick={() => setDay((value) => shiftDay(value, 1))}>
          اليوم التالي
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="tp-cstats__nav" data-primary={day === today || undefined} onClick={() => setDay(baghdadTodayKey())}>
          اليوم
        </button>
        <button type="button" className="tp-cstats__nav" onClick={() => void load(day)} aria-label="تحديث الإحصائيات" title="تحديث">
          {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        </button>
      </div>
      <p className="tp-cstats__day">{formatAppDate(day)}{day === today ? " · اليوم" : ""}</p>

      {error ? (
        <div role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" /><p>{error}</p></div>
      ) : null}

      {!data ? (
        loading ? <LoadingState title="جاري تحميل الإحصائيات..." /> : null
      ) : (
        <>
          <dl className="tp-cstats__kpis">
            <div className="tp-cstats__kpi">
              <dt>إجمالي المطلوب</dt>
              <dd>{data.totals.target}</dd>
              <small>مجموع المطلوب من الدورات</small>
            </div>
            <div className="tp-cstats__kpi" data-tone="done">
              <dt>إجمالي المنجز</dt>
              <dd>{data.totals.done}</dd>
              <small>مجموع إجراءات الموظفين</small>
            </div>
            <div className="tp-cstats__kpi" data-tone={data.totals.remaining > 0 ? "left" : undefined}>
              <dt>إجمالي المتبقي</dt>
              <dd>{data.totals.remaining}</dd>
              <small>المطلوب − المنجز</small>
            </div>
            <div className="tp-cstats__kpi">
              <dt>نسبة الإنجاز</dt>
              <dd>{percent(data.totals.rate)}</dd>
              <small>المنجز من المطلوب</small>
            </div>
          </dl>

          <section className="tp-cstats__card" aria-labelledby="tp-cstats-employees">
            <header className="tp-cstats__head">
              <h3 id="tp-cstats-employees">إنجاز الموظفين</h3>
              <p>كل إجراء على مكالمة (طالب وامتحان) سجّله الموظف بهذا اليوم، وعلى أي دورات.</p>
            </header>
            {data.employees.length === 0 ? (
              <EmptyState compact title="ما سجّل أي موظف إجراء بهذا اليوم" />
            ) : (
              <ul className="tp-cstats__rows">
                {data.employees.map((employee) => (
                  <li key={employee.key} className="tp-cstats__employee">
                    <div className="tp-cstats__who">
                      <strong>{employee.name}</strong>
                      <span className="tp-cstats__statuses">
                        {employee.statuses.map((item) => (
                          <span key={item.status} className="tp-modal__chip">{item.status} {item.count}</span>
                        ))}
                      </span>
                    </div>
                    <div className="tp-cstats__courses">
                      {employee.courses.map((course) => (
                        <span key={course.id || "none"} className="tp-cstats__course-chip">
                          {course.name} <b>{course.count}</b>
                        </span>
                      ))}
                    </div>
                    <span className="tp-cstats__total" aria-label={`إجمالي إجراءات ${employee.name}`}>{employee.total}</span>
                  </li>
                ))}
                <li className="tp-cstats__employee" data-sum="true">
                  <div className="tp-cstats__who"><strong>مجموع إنجاز الفريق</strong></div>
                  <div className="tp-cstats__courses" />
                  <span className="tp-cstats__total">{data.totals.done}</span>
                </li>
              </ul>
            )}
          </section>

          <section className="tp-cstats__card" aria-labelledby="tp-cstats-courses">
            <header className="tp-cstats__head">
              <h3 id="tp-cstats-courses">الدورات: المطلوب والمنجز</h3>
              <p>أدخل العدد المطلوب لكل دورة بهذا اليوم؛ يُحفظ تلقائياً. المنجز يُحسب من إجراءات الموظفين.</p>
            </header>
            {data.courses.length === 0 ? (
              <EmptyState compact title="لا توجد دورات فعّالة" />
            ) : (
              <div className="tp-cstats__table">
                <div className="tp-cstats__trow" data-head="true" aria-hidden="true">
                  <span>الدورة</span><span>العدد المطلوب</span><span>المنجز</span><span>المتبقي</span><span>نسبة الإنجاز</span>
                </div>
                {data.courses.map((course) => {
                  const state = saveState[course.id] || {};
                  const draft = drafts[course.id];
                  const rate = course.rate === null ? 0 : Math.min(1, course.rate);
                  return (
                    <div key={course.id || "none"} className="tp-cstats__trow">
                      <span className="tp-cstats__cname">{course.name}</span>
                      <span className="tp-cstats__target">
                        {course.id ? (
                          <>
                            <input
                              type="text"
                              inputMode="numeric"
                              dir="ltr"
                              aria-label={`العدد المطلوب لدورة ${course.name}`}
                              placeholder="—"
                              value={draft ?? (course.target === null ? "" : String(course.target))}
                              onChange={(event) => {
                                const value = event.target.value;
                                setDrafts((current) => ({ ...current, [course.id]: value }));
                                setSaveState((current) => ({ ...current, [course.id]: {} }));
                              }}
                              onBlur={() => void saveTarget(course.id)}
                              onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                              aria-invalid={state.error ? true : undefined}
                            />
                            {state.saving ? <Loader2 className="tp-cstats__state animate-spin motion-reduce:animate-none" aria-label="جاري الحفظ" /> : null}
                            {state.saved ? <span className="tp-cstats__saved" role="status">انحفظ</span> : null}
                            {state.error ? <span className="tp-cstats__error" role="alert">{state.error}</span> : null}
                          </>
                        ) : "—"}
                      </span>
                      <span className="tp-cstats__num" data-label="المنجز">{course.done}</span>
                      <span className="tp-cstats__num" data-label="المتبقي">{course.target === null ? "—" : course.remaining}</span>
                      <span className="tp-cstats__rate" data-label="نسبة الإنجاز">
                        <span className="tp-cstats__bar" aria-hidden="true"><i style={{ inlineSize: `${rate * 100}%` }} data-full={rate >= 1 || undefined} /></span>
                        {percent(course.rate)}
                      </span>
                    </div>
                  );
                })}
                <div className="tp-cstats__trow" data-sum="true">
                  <span className="tp-cstats__cname">المجموع</span>
                  <span className="tp-cstats__num" data-label="العدد المطلوب">{data.totals.target}</span>
                  <span className="tp-cstats__num" data-label="المنجز">{data.totals.done}</span>
                  <span className="tp-cstats__num" data-label="المتبقي">{data.totals.remaining}</span>
                  <span className="tp-cstats__num" data-label="نسبة الإنجاز">{percent(data.totals.rate)}</span>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
