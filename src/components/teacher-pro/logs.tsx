"use client";

import React, { useEffect, useMemo, useState } from "react";
import { logApi } from "@/lib/api";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { Card, CardContent } from "@/components/ui/card";
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
import { ExportDialog, type ExportColumn } from "./export-dialog";

type LogRow = {
  id: string;
  time: string;
  user: string;
  userName?: string;
  module: string;
  action: string;
  details: string;
};

type LogsResponse = {
  logs: LogRow[];
  modules?: string[];
  users?: string[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  source?: "database";
};

const logExportColumns: ExportColumn<LogRow>[] = [
  { key: "time", label: "الوقت", value: (log) => log.time || "" },
  { key: "user", label: "المستخدم", value: (log) => log.user || log.userName || "" },
  { key: "module", label: "الوحدة", value: (log) => log.module || "" },
  { key: "action", label: "الإجراء", value: (log) => log.action || "" },
  { key: "details", label: "التفاصيل", value: (log) => log.details || "" },
];

function buildQueryString(input: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

export function LogsView() {
  const syncKey = useTeacherProSyncKey(["logs", "accounts"]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterModule, setFilterModule] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    const query = buildQueryString({
      q: debouncedSearch,
      module: filterModule,
      user: filterUser,
      page,
      limit: pageSize,
    });

    logApi.list(query ? { queryString: query, signal: controller.signal, quietAbort: true } : { signal: controller.signal, quietAbort: true })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (!payload) {
          setLogs([]);
          setError("تعذر تحميل السجلات من قاعدة البيانات.");
          return;
        }
        const data = payload as unknown as LogsResponse;
        setLogs(data.logs || []);
        setModules(data.modules || []);
        setUsers(data.users || []);
        setTotalCount(Number(data.totalCount || 0));
        setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLogs([]);
          setError("تعذر تحميل السجلات من قاعدة البيانات.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [debouncedSearch, filterModule, filterUser, page, pageSize, syncKey]);

  const filteredExportRows = useMemo(() => logs, [logs]);

  return (
    <div className="space-y-4">
      <Card className="border-primary/15 bg-primary/5">
        <CardContent className="p-4 text-sm text-muted-foreground">
          السجلات هنا تُقرأ مباشرة من قاعدة البيانات وبفلاتر خادمية. لا يتم الاعتماد على كاش محلي حتى تبقى سجلات التدقيق حقيقية.
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <div className="space-y-1">
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
                  {modules.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="logs-user" className="text-xs">المستخدم</Label>
              <Select
                name="user"
                value={filterUser || "all"}
                onValueChange={(v) => {
                  setFilterUser(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="logs-user"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="logs-search" className="text-xs">بحث</Label>
              <Input
                id="logs-search"
                name="search"
                data-teacherpro-search="true"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="إجراء / تفاصيل / وحدة / مستخدم"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="logs-pageSize" className="text-xs">حجم الصفحة</Label>
              <Select
                name="pageSize"
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger id="logs-pageSize" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium">تصدير الصفحة الحالية</span>
              <ExportDialog
                title="تصدير السجلات"
                fileName="logs"
                rows={filteredExportRows}
                columns={logExportColumns}
                triggerLabel="تصدير"
                description="تصدير الصفحة الحالية من سجلات النظام حسب الفلاتر الخادمية"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>عرض {logs.length} من {totalCount} سجل</span>
        <Badge variant="outline">المصدر: قاعدة البيانات</Badge>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="space-y-3 p-6">
            <p className="font-semibold text-destructive">{error}</p>
            <Button variant="outline" onClick={() => setPage((value) => value)}>
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="space-y-2 p-4">
                    <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
                  </div>
                ))
              ) : logs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  لا توجد سجلات حسب الفلاتر الحالية
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-4 p-4 transition-colors hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{log.module}</Badge>
                        <span className="text-sm font-medium">{log.action}</span>
                      </div>
                      {log.details ? (
                        <p className="mt-1 text-xs text-muted-foreground">{log.details}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-left">
                      <p className="text-xs text-muted-foreground">{log.user || log.userName || "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{log.time}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحة {page} من {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            التالي
          </Button>
        </div>
      )}
    </div>
  );
}
