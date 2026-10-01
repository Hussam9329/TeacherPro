"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { logApi } from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLatestRequest } from "@/hooks/use-latest-request";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { ExportDialog, type ExportColumn } from "./export-dialog";
import { ListToolbar, type ListChipTone } from "./list-toolbar";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";
import { formatAppDate } from "@/lib/format";

type AuditLogDisplayItem = {
  label: string;
  value: string;
};

type AuditLogRow = {
  id: string;
  time: string;
  user?: string;
  userName?: string | null;
  module: string;
  action: string;
  details?: string | null;
  display?: {
    summary?: string;
    items?: AuditLogDisplayItem[];
    technicalDetails?: string | null;
    isStructured?: boolean;
  } | null;
};

const logExportColumns: ExportColumn<AuditLogRow>[] = [
  { key: "time", label: "الوقت", value: (log) => log.time || "" },
  { key: "userName", label: "المستخدم", value: (log) => log.userName || log.user || "" },
  { key: "module", label: "الوحدة", value: (log) => log.module || "" },
  { key: "action", label: "الإجراء", value: (log) => log.action || "" },
  {
    key: "details",
    label: "ملخص العملية",
    value: (log) => log.display?.summary || log.details || "",
  },
];

function formatLogTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { hour12: false });
}

const LOG_CHIP_LIMIT = 5;

/** A colour per section so the eye finds grades, opportunities or accounts. */
function moduleTone(module: string): ListChipTone | undefined {
  if (/مفصول|فصل/.test(module)) return "danger";
  if (/فرص/.test(module)) return "warning";
  if (/درج|امتحان/.test(module)) return "info";
  if (/طلاب|طالب|مكالم|متابعة|إجاز|سماح/.test(module)) return "success";
  return "muted";
}

function moduleInitial(module: string) {
  const word = String(module || "").replace(/^(ال|إدارة\s+|سجل\s+)/, "").replace(/^ال/, "");
  return word.charAt(0) || "•";
}

function formatLogClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** The page's records under «اليوم», «أمس» or their date, newest first. */
function groupLogsByDay(logs: AuditLogRow[]) {
  const now = new Date();
  const today = localDayKey(now);
  const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: Array<{ key: string; label: string; logs: AuditLogRow[] }> = [];
  for (const log of logs) {
    const date = new Date(log.time);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? localDayKey(date) : "unknown";
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = {
        key,
        label: !valid ? "بدون تاريخ" : key === today ? "اليوم" : key === yesterday ? "أمس" : formatAppDate(date),
        logs: [],
      };
      days.push(day);
    }
    day.logs.push(log);
  }
  return days;
}

export function LogsView() {
  const syncKey = useTeacherProSyncKey(["logs", "opportunity-logs"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const beginLogsRequest = useLatestRequest();
  const logsLoadedRef = useRef(false);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [moduleCounts, setModuleCounts] = useState<Array<{ module: string; count: number }>>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  // Wait for a pause in typing so a name is one request, not one per letter.
  const debouncedSearch = useDebouncedValue(search, 350);
  const [filterModule, setFilterModule] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [systemTotalCount, setSystemTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const request = beginLogsRequest();
    const background = isBackgroundSync() || logsLoadedRef.current;
    if (!background) setLoading(true);
    setError("");
    logApi
      .list(
        {
          q: debouncedSearch || undefined,
          module: filterModule || undefined,
          user: filterUser || undefined,
          page,
          pageSize,
        },
        { signal: request.signal, quietAbort: true },
      )
      .then((result) => {
        if (!request.isLatest()) return;
        if (!result) {
          if (!background) setLogs([]);
          setError("تعذر تحميل السجلات.");
          return;
        }
        const nextLogs = ((result.logs || []) as unknown as AuditLogRow[]).map((log) => ({
          ...log,
          module: humanizeTeacherProText(log.module || ""),
          action: humanizeTeacherProText(log.action || ""),
          details: log.details ? humanizeTeacherProText(log.details) : log.details,
          userName: log.userName || log.user || "النظام",
          display: log.display
            ? {
                ...log.display,
                summary: log.display.summary
                  ? humanizeTeacherProText(log.display.summary)
                  : log.display.summary,
                items: (log.display.items || []).map((item) => ({
                  ...item,
                  label: humanizeTeacherProText(item.label),
                  value: humanizeTeacherProText(item.value),
                })),
              }
            : log.display,
        }));
        setLogs(nextLogs);
        setModules((result.modules || []).filter(Boolean));
        setModuleCounts(
          (result.moduleCounts || [])
            .filter((item) => item.module)
            .map((item) => ({ module: item.module, count: Number(item.count) || 0 })),
        );
        setUsers((result.users || []).filter(Boolean));
        setTotalCount(Number(result.totalCount || nextLogs.length || 0));
        setSystemTotalCount(Number(result.systemTotalCount || result.totalCount || nextLogs.length || 0));
        setTotalPages(Math.max(1, Number(result.totalPages || 1)));
        logsLoadedRef.current = true;
      })
      .catch((err) => {
        if (!request.isLatest()) return;
        console.warn("[LogsView] failed to load logs", err);
        if (!background) setLogs([]);
        setError("تعذر تحميل السجلات.");
      })
      .finally(() => {
        if (request.isLatest()) setLoading(false);
      });
  }, [
    beginLogsRequest,
    debouncedSearch,
    filterModule,
    filterUser,
    isBackgroundSync,
    page,
    pageSize,
    refreshKey,
    syncKey,
  ]);

  const resetFilters = () => {
    setFilterUser("");
    setPage(1);
  };

  // The section buttons: the busiest sections first; a picked section that is
  // not among them still gets its own button so it can be cleared.
  const moduleChips = useMemo(() => {
    const top = moduleCounts.slice(0, LOG_CHIP_LIMIT);
    if (filterModule && !top.some((item) => item.module === filterModule)) {
      const picked = moduleCounts.find((item) => item.module === filterModule);
      top.push(picked || { module: filterModule, count: 0 });
    }
    return top;
  }, [filterModule, moduleCounts]);
  const moduleFreeTotal = moduleCounts.reduce((sum, item) => sum + item.count, 0);
  const logDays = useMemo(() => groupLogsByDay(logs), [logs]);

  return (
    <div className="tp-list tp-logs-page">
      <ListToolbar
        label="البحث والتصفية في السجلات"
        search={
          <Input
            id="logs-search"
            name="search"
            data-teacherpro-search="true"
            autoComplete="off"
            aria-label="بحث في السجلات"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="ابحث بالطالب أو الإجراء أو المستخدم"
          />
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="تحديث السجلات"
              title="تحديث"
              disabled={loading}
              onClick={() => {
                emitTeacherProDataChanged({ source: "manual", reason: "logs-refresh", scopes: ["logs"] });
                setRefreshKey((current) => current + 1);
              }}
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />
            </Button>
            <ExportDialog
              rows={logs}
              columns={logExportColumns}
              title="تصدير السجلات المعروضة"
              fileName="teacherpro-audit-logs"
              triggerLabel="تصدير"
            />
          </>
        }
        chips={[
          { key: "", label: "الكل", count: moduleCounts.length ? moduleFreeTotal : null },
          ...moduleChips.map((item) => ({
            key: item.module,
            label: humanizeTeacherProText(item.module),
            count: item.count,
            tone: moduleTone(item.module),
          })),
        ]}
        chipsLabel="القسم"
        activeChip={filterModule}
        onChipChange={(value) => {
          setFilterModule(value);
          setPage(1);
        }}
        activeFilterCount={Number(Boolean(filterUser))}
        activeFilters={
          filterUser
            ? [{ key: "user", label: `المستخدم: ${filterUser}`, onClear: () => { setFilterUser(""); setPage(1); } }]
            : []
        }
        onClearFilters={resetFilters}
        filters={
          <>
            <div className="space-y-1.5">
              <Label htmlFor="logs-module" className="text-xs font-bold">القسم</Label>
              <Select
                name="module"
                value={filterModule || "all"}
                onValueChange={(v) => {
                  setFilterModule(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="logs-module"><SelectValue placeholder="كل الأقسام" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأقسام</SelectItem>
                  {modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logs-user" className="text-xs font-bold">المستخدم</Label>
              <Select
                name="userId"
                value={filterUser || "all"}
                onValueChange={(v) => {
                  setFilterUser(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="logs-user"><SelectValue placeholder="كل المستخدمين" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المستخدمين</SelectItem>
                  {users.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logs-page-size" className="text-xs font-bold">عدد السجلات بالصفحة</Label>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger id="logs-page-size"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        }
        summary={
          <>
            المعروض <b>{logs.length}</b> من <b>{totalCount}</b>
            {totalCount !== systemTotalCount ? <> · بالنظام كله {systemTotalCount}</> : null}
            {loading ? <> · جارٍ التحميل…</> : null}
          </>
        }
      />

      {error ? (
        <div role="alert" className="rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="tp-logs-days" aria-busy={loading}>
        {logDays.map((day) => (
          <section key={day.key} className="tp-logs-day" aria-label={day.label}>
            <h3 className="tp-logs-day__title">{day.label}</h3>
            <ol className="tp-logs-list">
              {day.logs.map((log) => {
                const items = log.display?.items || [];
                const technical = log.display?.technicalDetails;
                const hasMore = items.length > 0 || Boolean(technical);
                const line = (
                  <>
                    <span className="tp-logs-row__icon" data-tone={moduleTone(log.module)} aria-hidden="true">
                      {moduleInitial(log.module)}
                    </span>
                    <span className="tp-logs-row__text">
                      <span className="tp-logs-row__summary">{log.display?.summary || log.details || log.action || "—"}</span>
                      <span className="tp-logs-row__meta">
                        {log.userName || log.user || "النظام"} · {log.module || "—"}
                        {log.action && log.display?.summary ? <> · {log.action}</> : null}
                      </span>
                    </span>
                    <time className="tp-logs-row__time" dateTime={log.time}>{formatLogClock(log.time)}</time>
                  </>
                );
                return (
                  <li key={log.id} className="tp-logs-row">
                    {hasMore ? (
                      <details>
                        <summary title="اضغط لعرض التفاصيل">{line}</summary>
                        <div className="tp-logs-row__details">
                          {items.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {items.map((item) => (
                                <span key={`${item.label}:${item.value}`} className="rounded-lg bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
                                  <span className="font-medium text-foreground">{item.label}:</span> {item.value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <p className="text-[11px] text-muted-foreground">الوقت الكامل: {formatLogTime(log.time)}</p>
                          {technical ? (
                            <details className="tp-logs-row__tech">
                              <summary>عرض التفاصيل التقنية</summary>
                              <pre dir="ltr">{technical}</pre>
                            </details>
                          ) : null}
                        </div>
                      </details>
                    ) : (
                      <div className="tp-logs-row__plain">{line}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        {!loading && logs.length === 0 ? (
          <p className="empty-state">لا توجد سجلات حسب الفلترة الحالية.</p>
        ) : null}
        {loading && logs.length === 0 ? (
          <p className="empty-state">جاري تحميل السجلات...</p>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">صفحة {page} من {totalPages}</span>
          <Button variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            التالي
          </Button>
        </div>
      ) : null}
    </div>
  );
}
