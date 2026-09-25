"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatGracePeriod } from "@/lib/grace-periods";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { ownerHeaders } from "@/lib/outbox-session";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";

type Row = {
  id: string;
  name: string;
  code: string;
  status: string;
  periods: Array<{ startDate: string; endDate: string; note: string }>;
  uncertainReasons: string[];
  conflicts: string[];
  placeholdersToDelete: number;
  futurePlaceholders: number;
  balance: {
    before: { opportunities: number; status: string };
    after: { opportunities: number; status: string };
  } | null;
};

type Totals = {
  studentsWithPeriods: number;
  periods: number;
  origins: Record<"current-window" | "history" | "history-exam" | "placeholder", number>;
  placeholdersToDelete: number;
  futurePlaceholders: number;
  uncertainStudents: number;
  conflictStudents: number;
  balanceChanges: number;
  alreadyConverted: number;
};

type Batch = { scanned: number; nextCursor: string | null; hasMore: boolean; students: Row[]; totals: Totals };

type Status = {
  legacyPeriods: number;
  remainingPlaceholders: number;
  lastAppliedAt: string | null;
  lastAppliedBy: string | null;
};

type Report = { scanned: number; rows: Row[]; totals: Totals };

function addTotals(left: Totals, right: Totals): Totals {
  return {
    studentsWithPeriods: left.studentsWithPeriods + right.studentsWithPeriods,
    periods: left.periods + right.periods,
    origins: {
      "current-window": left.origins["current-window"] + right.origins["current-window"],
      history: left.origins.history + right.origins.history,
      "history-exam": left.origins["history-exam"] + right.origins["history-exam"],
      placeholder: left.origins.placeholder + right.origins.placeholder,
    },
    placeholdersToDelete: left.placeholdersToDelete + right.placeholdersToDelete,
    futurePlaceholders: left.futurePlaceholders + right.futurePlaceholders,
    uncertainStudents: left.uncertainStudents + right.uncertainStudents,
    conflictStudents: left.conflictStudents + right.conflictStudents,
    balanceChanges: left.balanceChanges + right.balanceChanges,
    alreadyConverted: left.alreadyConverted + right.alreadyConverted,
  };
}

const EMPTY_TOTALS: Totals = {
  studentsWithPeriods: 0,
  periods: 0,
  origins: { "current-window": 0, history: 0, "history-exam": 0, placeholder: 0 },
  placeholdersToDelete: 0,
  futurePlaceholders: 0,
  uncertainStudents: 0,
  conflictStudents: 0,
  balanceChanges: 0,
  alreadyConverted: 0,
};

async function callLegacy(body?: Record<string, unknown>) {
  const response = await fetch("/api/grace-periods/legacy", {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "تعذر تنفيذ نقل فترات السماح القديمة.");
  return data;
}

/**
 * One-time transfer of the retired grace data into GracePeriod rows: a full
 * dry run first (no writes), then an explicit, resumable apply.
 */
export function LegacyGraceConversionPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [applied, setApplied] = useState<Report | null>(null);
  const [running, setRunning] = useState<"dry-run" | "apply" | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await callLegacy());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة حالة النقل.");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function run(mode: "dry-run" | "apply") {
    setRunning(mode);
    setProgress(0);
    setError("");
    let cursor: string | null = null;
    let scanned = 0;
    let totals = EMPTY_TOTALS;
    const rows: Row[] = [];
    try {
      for (;;) {
        const batch: Batch = await callLegacy({ mode, cursor });
        scanned += batch.scanned;
        totals = addTotals(totals, batch.totals);
        rows.push(...batch.students);
        setProgress(scanned);
        if (!batch.hasMore || !batch.nextCursor) break;
        cursor = batch.nextCursor;
      }
      if (mode === "dry-run") {
        setReport({ scanned, rows, totals });
        setReviewed(false);
      } else {
        setApplied({ scanned, rows, totals });
        setReport(null);
        emitTeacherProDataChanged({
          source: "local-mutation",
          reason: "نقل فترات السماح القديمة",
          scopes: ["students", "grades", "opportunities", "dashboard", "logs"],
        });
      }
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "تعذر إكمال العملية."}${mode === "apply" ? " يمكن إعادة التطبيق بأمان؛ الطلاب الذين نُقلوا لا يتكررون." : ""}`,
      );
    } finally {
      setRunning(null);
      void loadStatus();
    }
  }

  const uncertain = report?.rows.filter((row) => row.uncertainReasons.length) || [];
  const conflicts = report?.rows.filter((row) => row.conflicts.length) || [];
  const balanceRows = report?.rows.filter((row) => row.balance) || [];

  return (
    <section className="tp-grace__editor" aria-label="نقل فترات السماح من النظام القديم">
      <h3>نقل فترات السماح من النظام القديم</h3>
      <p className="tp-grace__muted">
        يقرأ النقل بيانات السماح القديمة ويحولها إلى فترات واضحة. التشغيل التجريبي لا يغيّر أي شيء.
        بيانات النظام القديم تبقى محفوظة كما هي حتى التأكد من النقل.
      </p>
      {status && (
        <p className="tp-grace__muted">
          فترات منقولة حتى الآن: {status.legacyPeriods} · علامات «ضمن فترة السماح» القديمة المتبقية: {status.remainingPlaceholders}
          {status.lastAppliedAt ? ` · آخر تطبيق: ${formatBaghdadDateTime(status.lastAppliedAt)}${status.lastAppliedBy ? ` (${status.lastAppliedBy})` : ""}` : ""}
        </p>
      )}
      {error && <p role="alert" className="tp-grace__error"><AlertCircle aria-hidden="true" />{error}</p>}
      {running && (
        <p role="status" className="tp-grace__muted">
          <Loader2 className="inline size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{" "}
          {running === "dry-run" ? "جاري التشغيل التجريبي" : "جاري التطبيق"}… تمت قراءة {progress} طالب
        </p>
      )}

      <div className="tp-grace__editor-actions">
        <Button type="button" variant="outline" onClick={() => void run("dry-run")} disabled={Boolean(running)}>
          تشغيل تجريبي (Dry Run)
        </Button>
      </div>

      {report && (
        <div className="tp-grace__preview">
          <p className="tp-grace__summary">نتيجة التشغيل التجريبي لـ {report.scanned} طالب</p>
          <ul className="tp-grace__impact">
            <li><span className="tp-grace__impact-name">فترات ستُنقل بنجاح: {report.totals.periods} فترة لـ {report.totals.studentsWithPeriods} طالب</span>
              <span className="tp-grace__muted">
                من نافذة السماح القديمة: {report.totals.origins["current-window"]} · من سجل السماح: {report.totals.origins.history + report.totals.origins["history-exam"]} · من علامات قديمة فقط: {report.totals.origins.placeholder}
              </span>
            </li>
            <li data-change="leaves"><span className="tp-grace__impact-name">حالات فيها تعارض: {report.totals.conflictStudents}</span></li>
            <li data-change="leaves"><span className="tp-grace__impact-name">طلاب لم تُحدد فترتهم بشكل مؤكد: {report.totals.uncertainStudents}</span></li>
            <li data-change="leaves"><span className="tp-grace__impact-name">اختلاف متوقع في الأرصدة: {report.totals.balanceChanges} طالب</span></li>
            <li><span className="tp-grace__impact-name">علامات «ضمن فترة السماح» القديمة التي ستُحذف: {report.totals.placeholdersToDelete}</span>
              <span className="tp-grace__muted">منها {report.totals.futurePlaceholders} لامتحانات قادمة لا تغطيها أي فترة (سيُحاسب الطالب عليها طبيعياً)</span>
            </li>
            {report.totals.alreadyConverted > 0 && (
              <li><span className="tp-grace__impact-name">طلاب نُقلوا سابقاً ولن يتكرر نقلهم: {report.totals.alreadyConverted}</span></li>
            )}
          </ul>

          {balanceRows.length > 0 && (
            <details open>
              <summary>الطلاب الذين سيتغير رصيدهم أو حالتهم ({balanceRows.length})</summary>
              <div className="table-wrap tp-grace__table-wrap" tabIndex={0} aria-label="جدول الطلاب الذين سيتغير رصيدهم؛ يمكن تمريره أفقياً عند الحاجة">
                <table className="tp-grace__table">
                  <thead><tr><th>الطالب</th><th>الفرص</th><th>الحالة</th><th>الفترات</th></tr></thead>
                  <tbody>
                    {balanceRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name} <span dir="ltr" className="tp-grace__muted">{row.code}</span></td>
                        <td>{row.balance!.before.opportunities} ← {row.balance!.after.opportunities}</td>
                        <td>{row.balance!.before.status} ← {row.balance!.after.status}</td>
                        <td dir="ltr">{row.periods.map((period) => formatGracePeriod(period)).join(" | ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {conflicts.length > 0 && (
            <details>
              <summary>حالات التعارض ({conflicts.length})</summary>
              <ul className="tp-grace__impact">
                {conflicts.map((row) => (
                  <li key={row.id} data-change="leaves">
                    <span className="tp-grace__impact-name">{row.name} <span dir="ltr">{row.code}</span></span>
                    {row.conflicts.map((text) => <span key={text} className="tp-grace__muted">{text}</span>)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {uncertain.length > 0 && (
            <details>
              <summary>طلاب لم تُحدد فترتهم بشكل مؤكد ({uncertain.length})</summary>
              <ul className="tp-grace__impact">
                {uncertain.map((row) => (
                  <li key={row.id} data-change="leaves">
                    <span className="tp-grace__impact-name">{row.name} <span dir="ltr">{row.code}</span></span>
                    {row.uncertainReasons.slice(0, 5).map((text) => <span key={text} className="tp-grace__muted">{text}</span>)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <label className="tp-grace__field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
            <Checkbox checked={reviewed} onCheckedChange={(value) => setReviewed(value === true)} aria-label="راجعت التقرير" />
            <span>راجعت التقرير وأوافق على تطبيق النقل</span>
          </label>
          <div className="tp-grace__editor-actions">
            <Button type="button" onClick={() => void run("apply")} disabled={!reviewed || Boolean(running)}>
              تطبيق النقل
            </Button>
          </div>
        </div>
      )}

      {applied && (
        <p className="tp-grace__summary">
          <CheckCircle2 className="inline size-4" aria-hidden="true" /> اكتمل النقل: {applied.totals.periods} فترة لـ {applied.totals.studentsWithPeriods} طالب،
          وحُذفت {applied.totals.placeholdersToDelete} علامة قديمة، وأُعيد حساب الطلاب المتأثرين.
        </p>
      )}
    </section>
  );
}
