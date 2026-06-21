"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Download, FileSpreadsheet, FileCode } from "lucide-react";
import { toast } from "sonner";

export type ExportColumn<T = Record<string, unknown>> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
};

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((col) => escapeCsvCell(col.label)).join(",");
  const body = rows
    .map((row) => columns.map((col) => escapeCsvCell(col.value(row))).join(","))
    .join("\r\n");
  // BOM for Excel Arabic support
  return "\uFEFF" + header + "\r\n" + body;
}

function buildHtml<T>(rows: T[], columns: ExportColumn<T>[], title: string): string {
  const head = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title><style>
  body { font-family: 'Noto Sans SC', 'Segoe UI', Tahoma, sans-serif; padding: 24px; }
  h1 { font-size: 18px; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: right; }
  th { background: #f4f4f5; font-weight: 700; }
  tr:nth-child(even) { background: #fafafa; }
  </style></head><body><h1>${title}</h1><table><thead><tr>${columns
    .map((col) => `<th>${escapeHtml(col.label)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${columns
          .map((col) => `<td>${escapeHtml(String(col.value(row) ?? ""))}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></body></html>`;
  return head;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadBlob(content: string, fileName: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportDialog<T = Record<string, unknown>>({
  title,
  fileName,
  rows,
  columns,
  triggerLabel = "تصدير",
  description,
}: {
  title: string;
  fileName: string;
  rows: T[];
  columns: ExportColumn<T>[];
  triggerLabel?: string;
  description?: string;
}) {
  const [open, setOpen] = useState(false);

  const safeFileName = useMemo(() => {
    const base = String(fileName || "export").trim().replace(/[^\w\u0600-\u06FF-]+/g, "-");
    return base || "export";
  }, [fileName]);

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.error("لا توجد بيانات للتصدير");
      return;
    }
    const csv = buildCsv(rows, columns);
    downloadBlob(csv, `${safeFileName}.csv`, "text/csv;charset=utf-8");
    toast.success(`تم تصدير ${rows.length} صف بصيغة CSV`);
    setOpen(false);
  };

  const exportHtml = () => {
    if (rows.length === 0) {
      toast.error("لا توجد بيانات للتصدير");
      return;
    }
    const html = buildHtml(rows, columns, title);
    downloadBlob(html, `${safeFileName}.html`, "text/html;charset=utf-8");
    toast.success(`تم تصدير ${rows.length} صف بصيغة HTML`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            عدد الصفوف القابلة للتصدير: <b>{rows.length}</b>
          </p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="gap-2"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            تصدير CSV
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={exportHtml}
            disabled={rows.length === 0}
          >
            <FileCode className="h-4 w-4" />
            تصدير HTML
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
