"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { logApi } from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { CountScopeSummary } from "./ui-kit";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";

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

export function LogsView() {
  const syncKey = useTeacherProSyncKey(["logs", "opportunity-logs"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const beginLogsRequest = useLatestRequest();
  const logsLoadedRef = useRef(false);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
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
          setError("تعذر تحميل السجلات من بيانات النظام.");
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
        setError("تعذر تحميل السجلات من بيانات النظام.");
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

  const currentRangeLabel = useMemo(() => {
    if (totalCount === 0) return "0";
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(totalCount, page * pageSize);
    return `${from}-${to} من ${totalCount}`;
  }, [page, pageSize, totalCount]);

  const resetFilters = () => {
    setSearch("");
    setFilterModule("");
    setFilterUser("");
    setPage(1);
  };

  return (
    <div className="space-y-4 tp-logs-page">
      <Card className="tp-filter-card tp-logs-page__filters">
        <CardHeader className="pb-2">
          <CardTitle>السجلات</CardTitle>
          <p className="text-sm text-muted-foreground">
            سجل واضح يشرح ما حدث ومن نفّذه. المعرّفات والبيانات البرمجية مخفية افتراضياً، ويمكن فتحها للتدقيق التقني فقط.
          </p>
        </CardHeader>
        <CardContent className="tp-filter-content space-y-3">
          <div className="tp-filter-grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6">
            <div className="tp-filter-field tp-filter-primary">
              <Label htmlFor="logs-module" className="text-xs">الوحدة</Label>
              <Select
                name="module"
                value={filterModule || "all"}
                onValueChange={(v) => {
                  setFilterModule(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="logs-module"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-secondary">
              <Label htmlFor="logs-user" className="text-xs">المستخدم</Label>
              <Select
                name="userId"
                value={filterUser || "all"}
                onValueChange={(v) => {
                  setFilterUser(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="logs-user"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {users.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-search md:col-span-2">
              <Label htmlFor="logs-search" className="text-xs">بحث</Label>
              <Input
                id="logs-search"
                name="search"
                data-teacherpro-search="true"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="بحث بالإجراء، التفاصيل، الوحدة، المستخدم"
              />
            </div>
            <div className="tp-filter-field tp-filter-meta">
              <Label htmlFor="logs-page-size" className="text-xs">عدد الصفوف</Label>
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
            <div className="tp-filter-actions">
              <Button variant="outline" onClick={resetFilters}>مسح</Button>
              <ExportDialog
                rows={logs}
                columns={logExportColumns}
                title="تصدير السجلات المعروضة"
                fileName="teacherpro-audit-logs"
                triggerLabel="تصدير"
              />
            </div>
          </div>

          <CountScopeSummary
            systemTotal={systemTotalCount}
            filteredTotal={totalCount}
            pageCount={logs.length}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">نطاق النتائج: {currentRangeLabel}</span>
              {loading ? <Badge variant="outline">جارٍ تحميل البيانات...</Badge> : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                emitTeacherProDataChanged({ source: "manual", reason: "logs-refresh", scopes: ["logs"] });
                setRefreshKey((current) => current + 1);
              }}
            >
              تحديث
            </Button>
          </div>

          {error ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="table-wrap">
            <table className="responsive-table text-sm">
              <thead>
                <tr>
                  <th className="p-3 text-right">الوقت</th>
                  <th className="p-3 text-right">المستخدم</th>
                  <th className="p-3 text-right">الوحدة</th>
                  <th className="p-3 text-right">الإجراء</th>
                  <th className="p-3 text-right">ملخص العملية</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t">
                    <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">{formatLogTime(log.time)}</td>
                    <td className="p-3">{log.userName || log.user || "النظام"}</td>
                    <td className="p-3"><Badge variant="outline">{log.module || "—"}</Badge></td>
                    <td className="p-3 font-medium">{log.action || "—"}</td>
                    <td className="max-w-2xl p-3 align-top">
                      <div className="space-y-2">
                        <p className="text-sm leading-7 text-foreground">
                          {log.display?.summary || log.details || "—"}
                        </p>
                        {(log.display?.items || []).length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {(log.display?.items || []).slice(0, 6).map((item) => (
                              <span
                                key={`${item.label}:${item.value}`}
                                className="rounded-lg border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
                              >
                                <span className="font-medium text-foreground">{item.label}:</span>{" "}
                                {item.value}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {log.display?.technicalDetails ? (
                          <details className="group rounded-xl border border-dashed bg-muted/20 px-3 py-2">
                            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                              عرض التفاصيل التقنية
                            </summary>
                            <pre
                              dir="ltr"
                              className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-2 text-left font-mono text-[10px] leading-5 text-muted-foreground"
                            >
                              {log.display.technicalDetails}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && logs.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا توجد سجلات حسب الفلترة الحالية.</td></tr>
                ) : null}
                {loading && logs.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">جاري تحميل السجلات من بيانات النظام...</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          السابق
        </Button>
        <span className="text-sm text-muted-foreground">صفحة {page} من {totalPages}</span>
        <Button variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
          التالي
        </Button>
      </div>
    </div>
  );
}
