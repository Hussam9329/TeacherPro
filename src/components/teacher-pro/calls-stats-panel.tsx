"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { formatAppDate } from "@/lib/format";
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

const count = (value: number | null) => (value === null ? "—" : value);

/** The optional columns of «المطلوب والمنجز», remembered on this device. */
type ExtraColumns = { discounted: boolean; full: boolean };
const EXTRA_COLUMNS_KEY = "tp-cstats-extra-columns";
const EXTRA_COLUMNS_DEFAULT: ExtraColumns = { discounted: true, full: true };

function readExtraColumns(): ExtraColumns {
  try {
    const saved = JSON.parse(window.localStorage.getItem(EXTRA_COLUMNS_KEY) || "null") as Partial<ExtraColumns> | null;
    if (!saved || typeof saved !== "object") return EXTRA_COLUMNS_DEFAULT;
    return { discounted: saved.discounted !== false, full: saved.full !== false };
  } catch {
    return EXTRA_COLUMNS_DEFAULT;
  }
}

function saveExtraColumns(value: ExtraColumns) {
  try {
    window.localStorage.setItem(EXTRA_COLUMNS_KEY, JSON.stringify(value));
  } catch {
    // Private windows may refuse; the choice then lasts until the window closes.
  }
}

/**
 * «إحصائيات المكالمات»: the calls of the cumulative and final exams only, for
 * the admin and the supervisors — what each employee did on the day and on
 * which courses, and each course against its latest cumulative exam: one
 * required number for the exam (its «المخصومين»), and the work done on it up
 * to the end of the day.
 */
export function CallsStatsPanel() {
  const [day, setDay] = useState(() => baghdadTodayKey());
  const [data, setData] = useState<CallDailyStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extra, setExtra] = useState<ExtraColumns>(EXTRA_COLUMNS_DEFAULT);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setExtra(readExtraColumns());
  }, []);

  const toggleExtra = (key: keyof ExtraColumns) => {
    setExtra((value) => {
      const next = { ...value, [key]: !value[key] };
      saveExtraColumns(next);
      return next;
    });
  };
  // Name, the chosen extra columns, then required / done / left / rate.
  const columns = [
    "minmax(0, 1.5fr)",
    ...(extra.discounted ? ["minmax(0, 0.8fr)"] : []),
    ...(extra.full ? ["minmax(0, 0.8fr)"] : []),
    "minmax(0, 0.8fr)", "minmax(0, 0.8fr)", "minmax(0, 0.7fr)", "minmax(0, 1.2fr)",
  ].join(" ");

  const load = useCallback(async (wanted: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const result = await callDailyStatsApi.get(wanted, controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
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
              <small>مخصومين آخر امتحان تراكمي لكل دورة</small>
            </div>
            <div className="tp-cstats__kpi" data-tone="done">
              <dt>إجمالي المنجز</dt>
              <dd>{data.totals.done}</dd>
              <small>لحد هذا اليوم · منها اليوم {data.totals.doneToday}</small>
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
              <p>كل إجراء سجّله الموظف بهذا اليوم على مكالمة امتحان تراكمي (طالب وامتحان)، وعلى أي دورات. الامتحانات اليومية ما تنحسب هنا.</p>
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
                  <span className="tp-cstats__total">{data.totals.actions}</span>
                </li>
              </ul>
            )}
          </section>

          <section className="tp-cstats__card" aria-labelledby="tp-cstats-courses">
            <header className="tp-cstats__head" data-tools="true">
              <div>
                <h3 id="tp-cstats-courses">الدورات: المطلوب والمنجز</h3>
                <p>
                  المطلوب لكل دورة رقم واحد لآخر امتحان تراكمي إلها: عدد «المخصومين» بيه. يزيد إذا انضافت درجات متأخرة وما ينقص.
                  المنجز: كل طالب انسوى عليه إجراء بهذا الامتحان لحد هذا اليوم، مرة وحدة.
                </p>
              </div>
              <div role="group" aria-label="أعمدة إضافية" className="tp-cstats__extras">
                <button type="button" className="tp-cstats__extra" aria-pressed={extra.discounted} onClick={() => toggleExtra("discounted")}>
                  {extra.discounted ? <Check aria-hidden="true" /> : null}
                  المخصومين
                </button>
                <button type="button" className="tp-cstats__extra" aria-pressed={extra.full} onClick={() => toggleExtra("full")}>
                  {extra.full ? <Check aria-hidden="true" /> : null}
                  الدرجات الكاملة
                </button>
              </div>
            </header>
            {data.courses.length === 0 ? (
              <EmptyState compact title="لا توجد دورات فعّالة" />
            ) : (
              <div className="tp-cstats__table" style={{ "--tp-cstats-cols": columns } as CSSProperties}>
                <div className="tp-cstats__trow" data-head="true" aria-hidden="true">
                  <span>الدورة</span>
                  {extra.discounted ? <span>المخصومين</span> : null}
                  {extra.full ? <span>الدرجات الكاملة</span> : null}
                  <span>العدد المطلوب</span><span>المنجز</span><span>المتبقي</span><span>نسبة الإنجاز</span>
                </div>
                {data.courses.map((course) => {
                  const rate = course.rate === null ? 0 : Math.min(1, course.rate);
                  return (
                    <div key={course.id || "none"} className="tp-cstats__trow">
                      <span className="tp-cstats__cname">
                        {course.name}
                        <small>{course.examName ? `امتحان: ${course.examName}` : "ما كو امتحان تراكمي بعد"}</small>
                      </span>
                      {extra.discounted ? <span className="tp-cstats__num" data-label="المخصومين" data-tone={course.discounted === null ? undefined : "discounted"}>{count(course.discounted)}</span> : null}
                      {extra.full ? <span className="tp-cstats__num" data-label="الدرجات الكاملة" data-tone={course.full === null ? undefined : "full"}>{count(course.full)}</span> : null}
                      <span className="tp-cstats__num" data-label="العدد المطلوب">{count(course.target)}</span>
                      <span className="tp-cstats__num" data-label="المنجز">
                        {course.done}
                        {course.doneToday ? <small>اليوم {course.doneToday}</small> : null}
                      </span>
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
                  {extra.discounted ? <span className="tp-cstats__num" data-label="المخصومين" data-tone="discounted">{data.totals.discounted}</span> : null}
                  {extra.full ? <span className="tp-cstats__num" data-label="الدرجات الكاملة" data-tone="full">{data.totals.full}</span> : null}
                  <span className="tp-cstats__num" data-label="العدد المطلوب">{data.totals.target}</span>
                  <span className="tp-cstats__num" data-label="المنجز">
                    {data.totals.done}
                    {data.totals.doneToday ? <small>اليوم {data.totals.doneToday}</small> : null}
                  </span>
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
