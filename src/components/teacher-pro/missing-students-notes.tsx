"use client";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTeacherStore } from "@/lib/teacher-store";
import { missingStudentsNotesStatsApi, type MissingStudentsNotesStatsResponse } from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { formatAppDate } from "@/lib/format";
import { normalizeForSearch } from "@/lib/validation";
import type { GradeEntryMissingNote } from "@/lib/grade-entry-notes";
import { EmptyState, StatCard } from "./ui-kit";
import { AlertTriangle, ClipboardList, Database, FileText, Search } from "lucide-react";

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeNote(item: unknown): GradeEntryMissingNote | null {
  const raw = item as Partial<GradeEntryMissingNote> | null;
  if (!raw || typeof raw !== "object") return null;
  const examId = String(raw.examId || "").trim();
  const text = String(raw.text || "").trim();
  if (!examId || !text) return null;
  const now = new Date().toISOString();
  return {
    id: String(raw.id || `exam:${examId}`),
    examId,
    examName: String(raw.examName || "امتحان غير محدد"),
    examDate: String(raw.examDate || ""),
    text,
    userId: raw.userId ?? null,
    userName: raw.userName ?? null,
    createdAt: String(raw.createdAt || raw.updatedAt || now),
    updatedAt: String(raw.updatedAt || raw.createdAt || now),
  };
}

export function MissingStudentsNotesView() {
  const syncKey = useTeacherProSyncKey(["grade-entry-notes", "grades", "exams"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const { exams, setSection } = useTeacherStore();
  const [notes, setNotes] = useState<GradeEntryMissingNote[]>([]);
  const [search, setSearch] = useState("");
  const [deleteDialogNote, setDeleteDialogNote] = useState<GradeEntryMissingNote | null>(null);
  const [databaseStats, setDatabaseStats] = useState<MissingStudentsNotesStatsResponse | null>(null);
  const [databaseStatsLoading, setDatabaseStatsLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [deletingNote, setDeletingNote] = useState(false);

  const refreshDatabaseStats = (signal?: AbortSignal, silent = false) => {
    if (!silent) setDatabaseStatsLoading(true);
    missingStudentsNotesStatsApi
      .get(signal ? { signal, quietAbort: true } : undefined)
      .then((result) => {
        if (!signal?.aborted) setDatabaseStats(result);
      })
      .catch(() => {
        if (!signal?.aborted) setDatabaseStats(null);
      })
      .finally(() => {
        if (!signal?.aborted) setDatabaseStatsLoading(false);
      });
  };

  const refreshNotesFromDatabase = (signal: AbortSignal, silent = false) => {
    if (!silent) setNotesLoading(true);
    if (!silent) setNotesError("");
    fetch("/api/grade-entry-missing-notes", {
      credentials: "same-origin",
      signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as { notes?: unknown[] };
        return (payload.notes || [])
          .map(normalizeNote)
          .filter((note): note is GradeEntryMissingNote => Boolean(note));
      })
      .then((nextNotes) => {
        if (!signal.aborted) setNotes(nextNotes);
      })
      .catch(() => {
        if (!signal.aborted && !silent) {
          setNotes([]);
          setNotesError("تعذر تحميل ملاحظات الطلاب غير الموجودين من قاعدة البيانات. تم تعطيل الحذف حتى يرجع الاتصال.");
        }
      })
      .finally(() => {
        if (!signal.aborted) setNotesLoading(false);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    const silent = isBackgroundSync();
    refreshNotesFromDatabase(controller.signal, silent);
    refreshDatabaseStats(controller.signal, silent);

    const refreshAfterExternalChange = () => {
      if (!controller.signal.aborted) {
        refreshNotesFromDatabase(controller.signal, true);
        refreshDatabaseStats(controller.signal, true);
      }
    };

    window.addEventListener("teacherpro:grade-entry-missing-notes-updated", refreshAfterExternalChange);
    return () => {
      controller.abort();
      window.removeEventListener("teacherpro:grade-entry-missing-notes-updated", refreshAfterExternalChange);
    };
  }, [syncKey, isBackgroundSync]);

  const normalizedSearch = useMemo(() => normalizeForSearch(search), [search]);
  const filteredNotes = useMemo(() => {
    if (!normalizedSearch) return notes;
    return notes.filter((note) =>
      normalizeForSearch(
        `${note.examName} ${note.examDate} ${note.text} ${note.userName || ""}`,
      ).includes(normalizedSearch),
    );
  }, [normalizedSearch, notes]);

  const statValue = (value: number | undefined) =>
    databaseStatsLoading && !databaseStats ? "…" : value ?? "—";

  const handleDeleteNote = (note: GradeEntryMissingNote) => {
    if (notesError || notesLoading) {
      return;
    }
    setDeleteDialogNote(note);
  };

  const confirmDeleteNote = async () => {
    if (!deleteDialogNote) return;
    setDeletingNote(true);
    const params = new URLSearchParams();
    if (deleteDialogNote.id) params.set("id", deleteDialogNote.id);
    else params.set("examId", deleteDialogNote.examId);

    try {
      const response = await fetch(`/api/grade-entry-missing-notes?${params.toString()}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setNotes((current) => current.filter((note) => note.id !== deleteDialogNote.id));
      refreshDatabaseStats();
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "missing-students-notes-delete",
        scopes: ["grade-entry-notes", "grades", "exams", "dashboard"],
      });
    } catch {
      setNotesError("تعذر حذف الملاحظة من قاعدة البيانات. تحقق من الصلاحيات أو الاتصال ثم حاول مجدداً.");
    } finally {
      setDeletingNote(false);
      setDeleteDialogNote(null);
    }
  };

  return (
    <div className="section-stack">
      <AlertDialog open={Boolean(deleteDialogNote)} onOpenChange={(open) => !open && setDeleteDialogNote(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الملاحظة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف ملاحظات امتحان {deleteDialogNote?.examName || "هذا الامتحان"} من قاعدة البيانات. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingNote}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDeleteNote()}
              disabled={deletingNote}
            >
              {deletingNote ? "جاري الحذف..." : "حذف من قاعدة البيانات"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight">الطلاب الغير موجودين</h2>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">
            هنا تظهر كل الملاحظات التي يكتبها مدخل الدرجات من صفحة تسجيل الدرجات لكل امتحان.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setSection("grade-entry")}>فتح تسجيل الدرجات</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard
          label="عدد الملاحظات"
          value={statValue(databaseStats?.total)}
          icon={ClipboardList}
          tone="info"
          hint="عدّ مباشر من قاعدة البيانات"
        />
        <StatCard
          label="امتحانات تحتوي ملاحظات"
          value={statValue(databaseStats?.examsWithNotes)}
          icon={FileText}
          tone="warning"
          hint="عدّ مباشر من قاعدة البيانات"
        />
        <StatCard
          label="إجمالي الأحرف"
          value={statValue(databaseStats?.totalCharacters)}
          icon={AlertTriangle}
          tone="danger"
          hint="مجموع النصوص من قاعدة البيانات"
        />
        <StatCard
          label="مصدر الصفحة"
          value="DB"
          icon={Database}
          tone="success"
          hint="لا تعتمد على localStorage للعرض"
        />
      </div>

      {notesLoading ? (
        <div className="rounded-2xl border bg-muted/40 p-3 text-sm text-muted-foreground">
          جاري تحميل ملاحظات الطلاب غير الموجودين من قاعدة البيانات...
        </div>
      ) : null}

      {notesError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {notesError}
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          القائمة والإحصائيات من قاعدة البيانات، والحذف لا يتم إلا بعد موافقة الخادم.
        </div>
      )}

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle>سجل ملاحظات مدخلي الدرجات</CardTitle>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                استخدم البحث للوصول إلى اسم طالب أو امتحان بسرعة.
              </p>
            </div>
            <div className="w-full space-y-2 lg:max-w-sm">
              <Label htmlFor="missing-students-notes-search">بحث</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="missing-students-notes-search"
                  name="search"
                  data-teacherpro-search="true"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث باسم الطالب، نص الملاحظة، أو اسم الامتحان"
                  className="pr-9"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredNotes.length === 0 ? (
            <EmptyState
              title={notes.length === 0 ? "لا توجد ملاحظات بعد" : "لا توجد نتائج مطابقة"}
              description={
                notes.length === 0
                  ? "عند كتابة ملاحظات في صفحة تسجيل الدرجات ستظهر هنا تلقائياً."
                  : "غيّر كلمات البحث لعرض ملاحظات أخرى."
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredNotes.map((note) => {
                const currentExam = exams.find((exam) => exam.id === note.examId);
                const examDate = note.examDate || currentExam?.date || "";
                return (
                  <div
                    key={note.id}
                    className="rounded-3xl border bg-card p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{currentExam?.type || "امتحان"}</Badge>
                          <h3 className="text-base font-black">{currentExam?.name || note.examName}</h3>
                          {note.userName ? <Badge variant="outline">المدخل: {note.userName}</Badge> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>تاريخ الامتحان: {examDate ? formatAppDate(examDate, examDate) : "غير محدد"}</span>
                          <span>آخر تحديث: {formatDateTime(note.updatedAt)}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteNote(note)}
                        disabled={Boolean(notesError) || notesLoading}
                      >
                        حذف الملاحظة
                      </Button>
                    </div>
                    <div className="mt-4 whitespace-pre-wrap rounded-2xl border bg-muted/30 p-4 text-sm leading-8">
                      {note.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
