'use client';

import React, { useState, useMemo } from 'react';
import { useTeacherStore } from '@/lib/teacher-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function LogsView() {
  const { logs } = useTeacherStore();

  const [search, setSearch] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Get unique modules and users
  const modules = useMemo(() => [...new Set(logs.map(l => l.module))], [logs]);
  const users = useMemo(() => [...new Set(logs.map(l => l.user))], [logs]);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (search && !l.action.includes(search) && !l.details.includes(search)) return false;
      if (filterModule && l.module !== filterModule) return false;
      if (filterUser && l.user !== filterUser) return false;
      return true;
    });
  }, [logs, search, filterModule, filterUser]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const exportLogs = () => {
    const headers = ['الوقت', 'المستخدم', 'الوحدة', 'الإجراء', 'التفاصيل'];
    const rows = filtered.map(l => [
      l.time, l.user, l.module, l.action, l.details
    ].map(v => `"${v}"`).join(','));
    const csv = '\ufeff' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label htmlFor="logs-search" className="text-xs">بحث</Label>
              <Input id="logs-search" name="search" autoComplete="off" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="إجراء / تفاصيل" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="logs-module" className="text-xs">الوحدة</Label>
              <Select value={filterModule} onValueChange={v => { setFilterModule(v === 'all' ? '' : v); setPage(1); }}>
                <SelectTrigger id="logs-module"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {modules.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="logs-user" className="text-xs">المستخدم</Label>
              <Select value={filterUser} onValueChange={v => { setFilterUser(v === 'all' ? '' : v); setPage(1); }}>
                <SelectTrigger id="logs-user"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {users.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="logs-pageSize" className="text-xs">حجم الصفحة</Label>
              <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
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
              <span className="text-xs font-medium">تصدير</span>
              <Button variant="outline" size="sm" className="w-full h-9" onClick={exportLogs}>تصدير CSV</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Count */}
      <div className="text-sm text-muted-foreground">
        عرض {paged.length} من {filtered.length} سجل
      </div>

      {/* Logs List */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {paged.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">لا توجد سجلات</div>
            ) : (
              paged.map(log => (
                <div key={log.id} className="flex items-start gap-4 p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">{log.module}</Badge>
                      <span className="font-medium text-sm">{log.action}</span>
                    </div>
                    {log.details && (
                      <p className="text-xs text-muted-foreground mt-1">{log.details}</p>
                    )}
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-xs text-muted-foreground">{log.user}</p>
                    <p className="text-[10px] text-muted-foreground">{log.time}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>التالي</Button>
        </div>
      )}
    </div>
  );
}
