"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { CalendarDays } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLatestRequest } from "@/hooks/use-latest-request";
import {
  STUDENT_TREND_RANGES,
  type StudentTrend,
  type StudentTrendDay,
  type StudentTrendRange,
} from "@/lib/student-trend";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function dayLabel(date: string, withYear = false) {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ""}`;
}

/** Round an axis maximum up to 1, 2, 2.5 or 5 × 10ⁿ, with four steps. */
function niceAxis(max: number, steps = 4): number[] {
  const raw = Math.max(1, max) / steps;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((value) => value >= raw) || raw;
  return Array.from({ length: steps + 1 }, (_, index) => Math.round(index * step * 100) / 100);
}

/** An axis around values that sit far from zero (the running active count). */
function bandAxis(min: number, max: number, steps = 4): number[] {
  const span = Math.max(steps, max - min);
  const raw = span / steps;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((value) => value >= raw) || raw;
  const start = Math.floor(min / step) * step;
  const ticks = Array.from({ length: steps + 1 }, (_, index) => start + index * step);
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Smooth line through the points without overshooting (monotone cubic). */
function smoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  const slopes = points.slice(0, -1).map(([x, y], index) => (points[index + 1][1] - y) / (points[index + 1][0] - x || 1));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];
    const [before, after] = [slopes[index - 1], slopes[index]];
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    const third = (x1 - x0) / 3;
    path += ` C${x0 + third},${y0 + tangents[index] * third} ${x1 - third},${y1 - tangents[index + 1] * third} ${x1},${y1}`;
  }
  return path;
}

const SERIES = [
  { key: "active", label: "نشطون", color: "var(--chart-2)", axis: "band" },
  { key: "dismissals", label: "مفصولون", color: "var(--chart-4)", axis: "daily" },
  { key: "archivals", label: "مؤرشفون", color: "var(--chart-archived)", axis: "daily" },
  { key: "registrations", label: "تسجيل جديد", color: "var(--chart-1)", axis: "daily" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

const HEIGHT = 280;
const PAD = { top: 16, right: 46, bottom: 34, left: 40 };

export function StudentTrendChart({ syncKey }: { syncKey?: string | number }) {
  const [range, setRange] = useState<StudentTrendRange>("month");
  const [trend, setTrend] = useState<StudentTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const beginRequest = useLatestRequest();
  const gradientId = useId().replace(/:/g, "");

  // Loading shows only before the first chart; after that a new one replaces
  // it in place, and a failed refresh keeps the chart that is there.
  const loadedRef = useRef(false);
  const load = useCallback(async () => {
    const request = beginRequest();
    const quiet = loadedRef.current;
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const res = await fetch(`/api/stats/trend?range=${range}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: request.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "تعذر تحميل إحصائيات الطلبة.");
      if (!request.isLatest()) return;
      setTrend(data as StudentTrend);
      loadedRef.current = true;
      setError("");
    } catch (cause) {
      if (!request.isLatest() || quiet) return;
      setError(cause instanceof Error ? cause.message : "تعذر تحميل إحصائيات الطلبة.");
    } finally {
      if (request.isLatest()) setLoading(false);
    }
  }, [beginRequest, range]);

  useEffect(() => {
    void load();
  }, [load, syncKey]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Older responses had no archivals: read them as none.
  const days = useMemo<StudentTrendDay[]>(
    () => (trend?.days || []).map((day) => ({ ...day, archivals: day.archivals ?? 0 })),
    [trend],
  );

  const chart = useMemo(() => {
    if (!width || days.length === 0) return null;
    const innerWidth = Math.max(1, width - PAD.left - PAD.right);
    const innerHeight = HEIGHT - PAD.top - PAD.bottom;
    const dailyTicks = niceAxis(Math.max(...days.map((day) => Math.max(day.registrations, day.dismissals, day.archivals))));
    const activeValues = days.map((day) => day.active);
    const bandTicks = bandAxis(Math.min(...activeValues), Math.max(...activeValues));
    const x = (index: number) => PAD.left + (days.length === 1 ? innerWidth / 2 : (index / (days.length - 1)) * innerWidth);
    const yDaily = (value: number) => PAD.top + innerHeight - (value / dailyTicks[dailyTicks.length - 1]) * innerHeight;
    const bandMin = bandTicks[0];
    const bandSpan = bandTicks[bandTicks.length - 1] - bandMin || 1;
    const yBand = (value: number) => PAD.top + innerHeight - ((value - bandMin) / bandSpan) * innerHeight;
    const y = (key: SeriesKey, value: number) => (key === "active" ? yBand(value) : yDaily(value));
    const lines = SERIES.map((series) => {
      const points = days.map((day, index) => [x(index), y(series.key, day[series.key])] as [number, number]);
      const line = smoothPath(points);
      const baseline = PAD.top + innerHeight;
      const area = `${line} L${points[points.length - 1][0]},${baseline} L${points[0][0]},${baseline} Z`;
      return { ...series, points, line, area };
    });
    // As many date labels as fit (about 70px each, at most six), always the
    // first and the last day.
    const fitting = Math.max(2, Math.min(6, Math.floor(innerWidth / 70)));
    const every = Math.max(1, Math.ceil(days.length / fitting));
    const labelIndexes = days.map((_, index) => index).filter((index) => index % every === 0 || index === days.length - 1);
    if (labelIndexes.length > 1 && labelIndexes[labelIndexes.length - 1] - labelIndexes[labelIndexes.length - 2] < every / 2) {
      labelIndexes.splice(labelIndexes.length - 2, 1);
    }
    return { innerWidth, innerHeight, dailyTicks, bandTicks, x, yDaily, yBand, lines, labelIndexes };
  }, [days, width]);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!chart || days.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientX - rect.left - PAD.left;
    const index = days.length === 1 ? 0 : Math.round((position / chart.innerWidth) * (days.length - 1));
    setHover(Math.min(days.length - 1, Math.max(0, index)));
  };

  const hovered = hover !== null && days[hover] ? days[hover] : null;
  const latest = days[days.length - 1];
  const totals = days.reduce(
    (sum, day) => ({
      registrations: sum.registrations + day.registrations,
      dismissals: sum.dismissals + day.dismissals,
      archivals: sum.archivals + day.archivals,
    }),
    { registrations: 0, dismissals: 0, archivals: 0 },
  );
  const rangeLabel = STUDENT_TREND_RANGES.find((item) => item.value === range)?.label || "";
  const summary = latest
    ? `${rangeLabel}: ${totals.registrations} تسجيل جديد، ${totals.dismissals} مفصول، ${totals.archivals} مؤرشف، و${latest.active} طالب نشط اليوم.`
    : "";

  return (
    <section className="tp-dashboard__panel tp-trend" aria-labelledby={`${gradientId}-title`}>
      <header className="tp-dashboard__panel-head">
        <h3 id={`${gradientId}-title`} className="tp-dashboard__panel-title">إحصائيات الطلبة</h3>
        <Select value={range} onValueChange={(value) => setRange(value as StudentTrendRange)}>
          <SelectTrigger className="tp-trend__range" aria-label="فترة الإحصائيات">
            <CalendarDays className="size-4 shrink-0 opacity-70" aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STUDENT_TREND_RANGES.map((item) => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <div ref={boxRef} className="tp-trend__plot" dir="ltr" aria-busy={loading}>
        {error && !trend ? (
          <div className="tp-trend__message" dir="rtl" role="alert">
            <p>{error}</p>
            <button type="button" className="tp-trend__retry" onClick={() => void load()}>إعادة المحاولة</button>
          </div>
        ) : chart ? (
          <>
            <svg
              width={width}
              height={HEIGHT}
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              aria-label={`إحصائيات الطلبة، ${summary}`}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
              className="tp-trend__svg"
              data-loading={loading || undefined}
            >
              <defs>
                {SERIES.map((series) => (
                  <linearGradient key={series.key} id={`${gradientId}-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={series.color} stopOpacity={series.key === "dismissals" || series.key === "archivals" ? 0.14 : 0.22} />
                    <stop offset="100%" stopColor={series.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>

              {chart.dailyTicks.map((tick) => (
                <g key={`d-${tick}`}>
                  <line className="tp-trend__grid" x1={PAD.left} x2={PAD.left + chart.innerWidth} y1={chart.yDaily(tick)} y2={chart.yDaily(tick)} />
                  <text className="tp-trend__tick" x={PAD.left - 8} y={chart.yDaily(tick)} textAnchor="end" dominantBaseline="middle">{tick}</text>
                </g>
              ))}
              {chart.bandTicks.map((tick) => (
                <text key={`b-${tick}`} className="tp-trend__tick tp-trend__tick--band" x={PAD.left + chart.innerWidth + 8} y={chart.yBand(tick)} textAnchor="start" dominantBaseline="middle">
                  {tick.toLocaleString("en-US")}
                </text>
              ))}
              {days.map((_, index) => (
                <line key={`v-${index}`} className="tp-trend__grid tp-trend__grid--v" x1={chart.x(index)} x2={chart.x(index)} y1={PAD.top} y2={PAD.top + chart.innerHeight} data-labelled={chart.labelIndexes.includes(index) || undefined} />
              ))}
              {chart.labelIndexes.map((index) => (
                <text key={`x-${index}`} className="tp-trend__tick tp-trend__tick--x" x={chart.x(index)} y={HEIGHT - 10} textAnchor="middle" direction="rtl">
                  {dayLabel(days[index].date)}
                </text>
              ))}

              {chart.lines.map((series) => (
                <g key={series.key} data-series={series.key}>
                  <path d={series.area} fill={`url(#${gradientId}-${series.key})`} />
                  <path d={series.line} fill="none" stroke={series.color} strokeWidth={series.key === "dismissals" || series.key === "archivals" ? 2.25 : 2.75} strokeLinecap="round" strokeLinejoin="round" />
                </g>
              ))}

              {hover !== null && hovered ? (
                <g className="tp-trend__cursor">
                  <line x1={chart.x(hover)} x2={chart.x(hover)} y1={PAD.top} y2={PAD.top + chart.innerHeight} />
                  {chart.lines.map((series) => (
                    <circle key={series.key} cx={series.points[hover][0]} cy={series.points[hover][1]} r={5} fill={series.color} />
                  ))}
                </g>
              ) : null}
            </svg>

            {hover !== null && hovered ? (
              <div
                className="tp-trend__tooltip"
                dir="rtl"
                style={{
                  left: Math.min(Math.max(chart.x(hover), 90), width - 90),
                  top: Math.max(4, Math.min(...chart.lines.map((series) => series.points[hover][1])) - 104),
                }}
                aria-hidden="true"
              >
                <p className="tp-trend__tooltip-date">{dayLabel(hovered.date, true)}</p>
                {SERIES.slice().reverse().map((series) => (
                  <p key={series.key} className="tp-trend__tooltip-row">
                    <span className="tp-trend__dot" style={{ background: series.color }} />
                    <span className="tp-trend__tooltip-value">{hovered[series.key].toLocaleString("en-US")}</span>
                    <span>{series.label}</span>
                  </p>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="tp-trend__message" dir="rtl">{loading ? "جاري تحميل الإحصائيات…" : "ماكو بيانات لهذه الفترة."}</div>
        )}
      </div>

      <ul className="tp-trend__legend">
        {SERIES.map((series) => (
          <li key={series.key}>
            <span className="tp-trend__dot" style={{ background: series.color }} aria-hidden="true" />
            {series.label}
            {series.key === "active" ? <span className="tp-trend__legend-note">(المحور الأيمن)</span> : null}
          </li>
        ))}
      </ul>

      {/* The same numbers for screen readers, day by day. */}
      {days.length > 0 ? (
        <ul className="sr-only" aria-label={`إحصائيات الطلبة يوماً بيوم، ${rangeLabel}`}>
          {days.map((day) => (
            <li key={day.date}>
              {dayLabel(day.date, true)}: {day.registrations} تسجيل جديد، {day.dismissals} مفصول، {day.archivals} مؤرشف، {day.active} نشط
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
