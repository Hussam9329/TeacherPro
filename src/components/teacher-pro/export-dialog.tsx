"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Download, FileCode, FileSpreadsheet, FileText, Printer, RotateCcw } from "lucide-react";
import { toast } from "@/lib/user-toast";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";
import { buildProfessionalXlsx } from "@/lib/xlsx-export";

export type ExportColumn<T = Record<string, unknown>> = {
  key: string;
  label: string;
  value: (row: T, index?: number) => string | number | null | undefined;
  defaultSelected?: boolean;
  locked?: boolean;
};

type ExportFormat = "csv" | "excel" | "html" | "pdf";
type PageOrientation = "portrait" | "landscape";

function normalizeExportValue(value: string | number | null | undefined): string | number {
  return typeof value === "string" ? humanizeTeacherProText(value) : value ?? "";
}

function protectSpreadsheetCell(value: string | number | null | undefined): string {
  const normalized = normalizeExportValue(value);
  const text = String(normalized);
  // Spreadsheet applications interpret these leading characters as formulas.
  // Prefix only string input so legitimate negative numeric values remain numeric.
  return typeof normalized === "string" && /^\s*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = protectSpreadsheetCell(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeJsString(value: string): string {
  return JSON.stringify(String(value ?? ""));
}

function sanitizeExportFileName(value: string): string {
  return (
    String(value || "export")
      .trim()
      .replace(/[\/:*?"<>|]+/g, "-")
      .replace(/[^\w؀-ۿ .-]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "export"
  );
}

function buildCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((col) => escapeCsvCell(col.label)).join(",");
  const body = rows
    .map((row, rowIndex) =>
      columns
        .map((col) => escapeCsvCell(col.value(row, rowIndex)))
        .join(","),
    )
    .join("\r\n");
  // BOM for Excel Arabic support
  return "\uFEFF" + header + "\r\n" + body;
}

function buildTableRows<T>(rows: T[], columns: ExportColumn<T>[]): string {
  return rows
    .map(
      (row, rowIndex) =>
        `<tr>${columns
          .map((col) => `<td>${escapeHtml(String(normalizeExportValue(col.value(row, rowIndex))))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
}

function buildHtml<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  title: string,
  options: {
    printable?: boolean;
    orientation?: PageOrientation;
    documentTitle?: string;
    safeUrlName?: string;
  } = {},
): string {
  const documentTitle = options.documentTitle || title;
  const safeUrlName = options.safeUrlName || sanitizeExportFileName(documentTitle);
  const printableToolbar = options.printable
    ? `<div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>`
    : "";
  const printableScript = options.printable
    ? `<script>document.title=${escapeJsString(documentTitle)};try{window.history.replaceState(null,document.title,'/${encodeURIComponent(safeUrlName)}.pdf');}catch(e){}</script>`
    : "";
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(humanizeTeacherProText(documentTitle))}</title><style>
  @page { size: A4 ${options.orientation || "portrait"}; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; padding: 16px; color: #111827; background: #eef2f7; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 8px; margin: -16px -16px 14px; padding: 10px 12px; background: #111827; color: white; z-index: 3; }
  .toolbar button { border: 0; border-radius: 10px; padding: 9px 14px; cursor: pointer; font-weight: 700; }
  .report { background: white; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
  .report-header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 8px; margin-bottom: 12px; border-bottom: 2px solid #111827; padding-bottom: 10px; }
  h1 { font-size: 20px; line-height: 1.5; margin: 0; }
  .meta { color: #475569; font-size: 12px; white-space: nowrap; }
  .table-wrap { width: 100%; overflow: visible; }
  table { border-collapse: collapse; width: 100%; table-layout: auto; font-size: 11px; }
  th, td { border: 1px solid #d1d5db; padding: 6px 7px; text-align: right; vertical-align: top; line-height: 1.45; word-break: break-word; }
  th { background: #f3f4f6; font-weight: 800; color: #111827; }
  tr:nth-child(even) { background: #fafafa; }
  a[href]::after { content: "" !important; }
  @media print {
    html, body { width: 100%; margin: 0 !important; padding: 0 !important; background: white !important; }
    .toolbar { display: none !important; }
    .report { box-shadow: none !important; border: 0 !important; border-radius: 0 !important; padding: 0 !important; }
    .report-header { margin-bottom: 8px; padding-bottom: 8px; }
    h1 { font-size: 18px; }
    .meta { font-size: 11px; }
    table { font-size: 10px; page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    thead { display: table-header-group; }
    th, td { padding: 4px 5px; }
  }
  </style>${printableScript}</head><body>${printableToolbar}<main class="report"><header class="report-header"><h1>${escapeHtml(humanizeTeacherProText(title))}</h1><div class="meta">عدد الصفوف: ${rows.length} | عدد الأعمدة: ${columns.length}</div></header><div class="table-wrap"><table><thead><tr>${columns
    .map((col) => `<th>${escapeHtml(humanizeTeacherProText(col.label))}</th>`)
    .join("")}</tr></thead><tbody>${buildTableRows(rows, columns)}</tbody></table></div></main></body></html>`;
}

function downloadBlob(content: BlobPart | Blob, fileName: string, mime: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function defaultColumnKeys<T>(columns: ExportColumn<T>[], preferredKeys?: string[]): string[] {
  const availableKeys = new Set(columns.map((column) => column.key));
  const lockedKeys = columns.filter((column) => column.locked).map((column) => column.key);
  const preferred = preferredKeys?.filter((key) => availableKeys.has(key)) || [];

  if (preferred.length > 0) {
    return Array.from(new Set([...lockedKeys, ...preferred]));
  }

  return columns
    .filter((column) => column.locked || column.defaultSelected !== false)
    .map((column) => column.key);
}

const exportFormatLabels: Record<ExportFormat, string> = {
  csv: "تصدير CSV",
  excel: "تصدير Excel",
  html: "تصدير HTML",
  pdf: "طباعة / PDF",
};

const exportFormatIcons: Record<ExportFormat, React.ElementType> = {
  csv: FileSpreadsheet,
  excel: FileText,
  html: FileCode,
  pdf: Printer,
};

export type ExportFetchContext = {
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
};

export function ExportDialog<T = Record<string, unknown>>({
  title,
  fileName,
  rows,
  columns,
  triggerLabel = "تصدير",
  description,
  formats = ["csv", "excel", "html", "pdf"],
  defaultSelectedColumnKeys,
  pageOrientation = "portrait",
  pdfTitle,
  pdfFileName,
  fetchRows,
  totalRowCount,
  disabled = false,
}: {
  title: string;
  fileName: string;
  rows: T[];
  columns: ExportColumn<T>[];
  triggerLabel?: string;
  description?: string;
  formats?: ExportFormat[];
  defaultSelectedColumnKeys?: string[];
  pageOrientation?: PageOrientation;
  pdfTitle?: string;
  pdfFileName?: string;
  fetchRows?: (context: ExportFetchContext) => Promise<T[]>;
  /** Exact number of rows that fetchRows will export (not the current page). */
  totalRowCount?: number | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<string[]>(() =>
    defaultColumnKeys(columns, defaultSelectedColumnKeys),
  );
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const exportAbortController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      exportAbortController.current?.abort();
    },
    [],
  );

  const safeFileName = useMemo(() => {
    const base = String(fileName || "export").trim().replace(/[^\w\u0600-\u06FF-]+/g, "-");
    return base || "export";
  }, [fileName]);

  const columnSignature = useMemo(
    () => columns.map((column) => `${column.key}:${column.defaultSelected}:${column.locked}`).join("|"),
    [columns],
  );

  useEffect(() => {
    setSelectedColumnKeys(defaultColumnKeys(columns, defaultSelectedColumnKeys));
  }, [columnSignature, columns, defaultSelectedColumnKeys]);

  const selectedColumns = useMemo(() => {
    const selected = new Set(selectedColumnKeys);
    return columns.filter((column) => selected.has(column.key));
  }, [columns, selectedColumnKeys]);

  const lockedKeys = useMemo(
    () => new Set(columns.filter((column) => column.locked).map((column) => column.key)),
    [columns],
  );

  const availableFormats: ExportFormat[] = formats.length > 0 ? formats : ["csv"];

  const ensureExportable = (exportRows: T[]) => {
    if (exportRows.length === 0) {
      toast.error("لا توجد بيانات للتصدير");
      return false;
    }
    if (selectedColumns.length === 0) {
      toast.error("اختر عموداً واحداً على الأقل قبل التصدير");
      return false;
    }
    return true;
  };

  const loadExportRows = async (): Promise<T[] | null> => {
    if (!fetchRows) return rows;
    exportAbortController.current?.abort();
    const controller = new AbortController();
    exportAbortController.current = controller;
    setExporting(true);
    setExportProgress({ loaded: 0, total: Math.max(0, totalRowCount || 0) });
    try {
      const loadedRows = await fetchRows({
        signal: controller.signal,
        onProgress: (loaded, total) => setExportProgress({ loaded, total }),
      });
      return loadedRows;
    } catch (error) {
      console.error("[ExportDialog] failed to fetch server export rows:", error);
      if (!(error instanceof Error && error.name === "AbortError")) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "تعذر تحميل بيانات التصدير الكاملة من النظام",
        );
      }
      return null;
    } finally {
      if (exportAbortController.current === controller) {
        exportAbortController.current = null;
      }
      setExporting(false);
      setExportProgress(null);
    }
  };

  const exportCsv = (exportRows: T[]) => {
    if (!ensureExportable(exportRows)) return;
    const csv = buildCsv(exportRows, selectedColumns);
    downloadBlob(csv, `${safeFileName}.csv`, "text/csv;charset=utf-8");
    toast.success(`تم تصدير ${exportRows.length} صف و ${selectedColumns.length} عمود بصيغة CSV`);
    setOpen(false);
  };

  const exportExcel = (exportRows: T[]) => {
    if (!ensureExportable(exportRows)) return;
    const workbook = buildProfessionalXlsx(
      exportRows,
      selectedColumns.map((column) => ({
        label: humanizeTeacherProText(column.label),
        value: (row: T, index?: number) => {
          const normalized = normalizeExportValue(column.value(row, index));
          return typeof normalized === "number"
            ? normalized
            : protectSpreadsheetCell(normalized);
        },
      })),
      {
        title: humanizeTeacherProText(title),
        orientation: pageOrientation,
      },
    );
    const workbookBlob = new Blob(
      [workbook.buffer as ArrayBuffer],
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );
    downloadBlob(
      workbookBlob,
      `${safeFileName}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    toast.success(`تم إنشاء ملف Excel احترافي يضم ${exportRows.length} طالباً`);
    setOpen(false);
  };

  const exportHtml = (exportRows: T[]) => {
    if (!ensureExportable(exportRows)) return;
    const html = buildHtml(exportRows, selectedColumns, title);
    downloadBlob(html, `${safeFileName}.html`, "text/html;charset=utf-8");
    toast.success(`تم تصدير ${exportRows.length} صف و ${selectedColumns.length} عمود بصيغة HTML`);
    setOpen(false);
  };

  const exportPdf = (exportRows: T[], pendingWindow?: Window | null) => {
    if (!ensureExportable(exportRows)) {
      pendingWindow?.close();
      return;
    }
    const printableTitle = String(pdfTitle || title || "تقرير").trim() || "تقرير";
    const printableFileName = sanitizeExportFileName(pdfFileName || printableTitle || safeFileName);
    const html = buildHtml(exportRows, selectedColumns, printableTitle, {
      printable: true,
      orientation: pageOrientation,
      documentTitle: printableTitle,
      safeUrlName: printableFileName,
    });
    const win = pendingWindow || window.open("", `${printableFileName}-pdf`);
    if (!win) {
      toast.error("المتصفح منع نافذة الطباعة");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.document.title = printableTitle;
    try {
      win.history.replaceState(null, printableTitle, `/${encodeURIComponent(printableFileName)}.pdf`);
    } catch {}
    win.focus();
    toast.success(`تم فتح تقرير PDF بـ ${exportRows.length} صف و ${selectedColumns.length} عمود`);
    setOpen(false);
  };

  const handleExport = async (format: ExportFormat) => {
    const pendingPdfWindow = format === "pdf" ? window.open("", `${safeFileName}-pdf`) : null;
    if (pendingPdfWindow) {
      pendingPdfWindow.document.write("<p dir='rtl' style='font-family:sans-serif;padding:16px'>جاري تجهيز التقرير...</p>");
      pendingPdfWindow.document.close();
    }
    const exportRows = await loadExportRows();
    if (!exportRows) {
      pendingPdfWindow?.close();
      return;
    }
    if (format === "csv") exportCsv(exportRows);
    if (format === "excel") exportExcel(exportRows);
    if (format === "html") exportHtml(exportRows);
    if (format === "pdf") exportPdf(exportRows, pendingPdfWindow);
  };

  const toggleColumn = (key: string, checked: boolean) => {
    if (lockedKeys.has(key)) return;
    setSelectedColumnKeys((current) => {
      if (checked) return Array.from(new Set([...current, key]));
      return current.filter((item) => item !== key);
    });
  };

  const selectAllColumns = () => setSelectedColumnKeys(columns.map((column) => column.key));
  const clearOptionalColumns = () => setSelectedColumnKeys(columns.filter((column) => column.locked).map((column) => column.key));
  const resetColumns = () => setSelectedColumnKeys(defaultColumnKeys(columns, defaultSelectedColumnKeys));

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) exportAbortController.current?.abort();
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={disabled}>
          <Download className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-2 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <p className="text-muted-foreground">
              عدد النتائج التي ستُصدّر:{" "}
              <b>{totalRowCount ?? (fetchRows ? "يُحسب عند التصدير" : rows.length)}</b>
            </p>
            <p className="text-muted-foreground">
              الأعمدة المختارة: <b>{selectedColumns.length}</b> من <b>{columns.length}</b>
            </p>
          </div>

          {exporting && exportProgress ? (
            <div
              className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <strong>جاري تحميل جميع الطلاب…</strong>
                <span>
                  {exportProgress.loaded} / {exportProgress.total || "…"}
                </span>
              </div>
              <progress
                className="h-2 w-full accent-primary"
                max={Math.max(1, exportProgress.total)}
                value={exportProgress.loaded}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => exportAbortController.current?.abort()}
              >
                إلغاء التصدير
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm font-bold">اختر الأعمدة المطلوبة في التصدير</Label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={selectAllColumns}>تحديد الكل</Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearOptionalColumns}>مسح الاختيار</Button>
                <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={resetColumns}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  الافتراضي
                </Button>
              </div>
            </div>
            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
              {columns.map((column) => {
                const checked = selectedColumnKeys.includes(column.key);
                const locked = lockedKeys.has(column.key);
                return (
                  <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background/70 px-3 py-2 text-sm hover:bg-muted/40">
                    <Checkbox
                      checked={checked}
                      disabled={locked}
                      onCheckedChange={(value) => toggleColumn(column.key, Boolean(value))}
                    />
                    <span className="flex-1">{column.label}</span>
                    {locked ? <span className="text-[10px] text-muted-foreground">ثابت</span> : null}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              سيتم تصدير الأعمدة المختارة فقط وبنفس ترتيبها الظاهر في هذه القائمة.
            </p>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
          {availableFormats.map((format) => {
            const Icon = exportFormatIcons[format];
            return (
              <Button
                key={format}
                variant="outline"
                className="gap-2"
                onClick={() => handleExport(format)}
                disabled={exporting || (!fetchRows && rows.length === 0) || selectedColumns.length === 0}
              >
                <Icon className="h-4 w-4" />
                {exporting ? "جاري التحضير..." : exportFormatLabels[format]}
              </Button>
            );
          })}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
